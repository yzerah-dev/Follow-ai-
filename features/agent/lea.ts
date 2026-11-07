/**
 * LÉA — orchestration des tâches IA (rédaction, analyse, réponse aux objections).
 * Couches : perception (lecture des données autorisées via RLS) → mémoire → raisonnement (LLM, sortie structurée)
 * → garde-fous déterministes → exécution contrôlée (brouillons + demandes d'approbation).
 */
import type { Db } from "@/lib/database/client";
import { getLlm } from "@/lib/ai";
import { estimateCostUsd } from "@/lib/ai/anthropic";
import type { LlmProvider } from "@/lib/ai/types";
import { detectInjection, wrapUntrusted } from "@/lib/security/untrusted";
import { audit } from "@/lib/security/audit";
import { evaluateDiscount, type CommercialPolicy } from "@/features/offers/policy";
import { ANALYST_SYSTEM, LEA_SYSTEM } from "./prompts";
import { emailDraftSchema, objectionReplySchema, replyAnalysisSchema, type ReplyAnalysis } from "./schemas";
import { mockFollowup, mockObjectionReply, mockOfferEmail, type ContactCtx } from "./mock-brain";
import { answerFromFacts, detectTopics, type Facts } from "./answers";
import { buildTemplate } from "@/features/conversations/templates";
import { toE164, isMobileFr } from "@/lib/phone";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { checkMessage } from "./guards";
import { loadPolicy, loadAutonomy } from "@/features/settings/policy-repo";
import { decideAutonomy, type AutonomyDecision } from "./autonomy";
import { dispatchMessage, type DispatchResult } from "@/features/conversations/dispatch";
import { acceptOfferAndPrepareOrder } from "@/features/offers/service";

type Actor = { userId: string | null };

async function recordRun(db: Db, orgId: string, kind: string, actor: Actor, llm: LlmProvider, input: unknown, output: unknown, usage: { inputTokens: number; outputTokens: number }) {
  const r = await db.query<{ id: string }>(
    `insert into agent_runs (organization_id, kind, status, input, output, provider, model, tokens_in, tokens_out, cost_usd, triggered_by, started_at, finished_at)
     values ($1,$2,'succeeded',$3,$4,$5,$6,$7,$8,$9,$10, now(), now()) returning id`,
    [orgId, kind, input, output, llm.name, llm.model, usage.inputTokens, usage.outputTokens, estimateCostUsd(llm.model, usage), actor.userId],
  );
  return r.rows[0]!.id;
}

async function senderInfo(db: Db, orgId: string, userId: string | null) {
  const org = (await db.query<{ name: string; brand: { companyName?: string } }>(
    `select o.name, s.brand from organizations o left join organization_settings s on s.organization_id = o.id where o.id = $1`, [orgId])).rows[0];
  const me = userId
    ? (await db.query<{ display_name: string | null }>(`select display_name from organization_members where organization_id = $1 and user_id = $2`, [orgId, userId])).rows[0]
    : undefined;
  return { senderName: me?.display_name ?? "LÉA — assistante commerciale", companyName: org?.brand?.companyName ?? org?.name ?? "" };
}

type ContactInfo = { id: string; email: string | null; mobile: string | null; channel: "email" | "whatsapp" | null; ctx: ContactCtx };

/** Contact joignable du client et canal à utiliser : email si consentement, sinon WhatsApp (mobile + consentement). */
async function primaryContact(db: Db, customerId: string): Promise<ContactInfo | null> {
  const r = await db.query<{ id: string; email: string | null; phone: string | null; consent_email: boolean; consent_whatsapp: boolean; salutation: string | null; first_name: string | null; last_name: string | null }>(
    `select c.id, c.email, coalesce(c.mobile, c.phone) as phone, c.consent_email, c.consent_whatsapp, c.salutation, c.first_name, c.last_name
     from customer_contacts cc join contacts c on c.id = cc.contact_id
     where cc.customer_id = $1 and cc.can_receive_offers
     order by ((c.email is not null and c.consent_email) or (c.consent_whatsapp and coalesce(c.mobile, c.phone) is not null)) desc,
              (c.email is not null and c.consent_email) desc, cc.is_primary desc, c.created_at limit 1`,
    [customerId],
  );
  const c = r.rows[0];
  if (!c) return null;
  const mobile = toE164(c.phone);
  const channel = c.email && c.consent_email ? "email" : c.consent_whatsapp && isMobileFr(mobile) ? "whatsapp" : null;
  return { id: c.id, email: c.email, mobile: isMobileFr(mobile) ? mobile : null, channel, ctx: { salutation: c.salutation, firstName: c.first_name, lastName: c.last_name } };
}

/** Faits vérifiés pour répondre aux questions (offre en cours, conditions du compte, disponibilités connues). */
async function loadFacts(db: Db, customerId: string | null, offerId: string | null): Promise<Facts> {
  const cu = customerId
    ? (await db.query<{ franco_amount: string | null; min_order_amount: string | null; payment_terms: string | null }>(`select franco_amount, min_order_amount, payment_terms from customers where id = $1`, [customerId])).rows[0]
    : undefined;
  let offer: Facts["offer"] = null;
  if (offerId) {
    const o = (await db.query<{ number: string; valid_until: string | null; total_ht: string; total_ttc: string }>(`select number, valid_until, total_ht, total_ttc from offers where id = $1`, [offerId])).rows[0];
    const lines = (await db.query<{ reference: string; description: string; quantity: string; unit_price_ht: string; units_per_case: number | null; availability: string; available_from: string | null; qty_available: string | null }>(
      `select p.reference, l.description, l.quantity, l.unit_price_ht, p.units_per_case, p.availability, p.available_from,
              (select s.qty_available from inventory_snapshots s where s.product_id = p.id order by s.captured_at desc limit 1) as qty_available
       from offer_lines l join products p on p.id = l.product_id where l.offer_id = $1 order by l.line_no`, [offerId])).rows;
    if (o)
      offer = {
        number: o.number, validUntil: o.valid_until, totalHt: o.total_ht, totalTtc: o.total_ttc,
        lines: lines.map((l) => ({ reference: l.reference, description: l.description, quantity: l.quantity, unitPriceHt: l.unit_price_ht, unitsPerCase: l.units_per_case, availability: l.availability, qtyAvailable: l.qty_available, availableFrom: l.available_from })),
      };
  }
  return { offer, customer: { francoAmount: cu?.franco_amount ?? null, minOrderAmount: cu?.min_order_amount ?? null, paymentTerms: cu?.payment_terms ?? null } };
}

/** Rédige l'email d'accompagnement d'une offre → message en attente de validation. */
export async function draftOfferEmail(db: Db, orgId: string, offerId: string, actor: Actor, opts: { autonomous?: boolean; now?: Date } = {}) {
  const llm = getLlm();
  const offer = (await db.query<{ id: string; number: string; customer_id: string; valid_until: string | null; total_ht: string; customer_name: string; discount_total_ht: string }>(
    `select o.id, o.number, o.customer_id, o.valid_until, o.total_ht, o.discount_total_ht, coalesce(c.trade_name, c.legal_name) as customer_name
     from offers o join customers c on c.id = o.customer_id where o.id = $1 and o.organization_id = $2`, [offerId, orgId])).rows[0];
  if (!offer) throw new Error("Offre introuvable.");
  const lines = (await db.query<{ reference: string; description: string; quantity: string; product_id: string; is_new: boolean; discount_pct: string }>(
    `select p.reference, l.description, l.quantity, l.product_id, p.is_new, l.discount_pct from offer_lines l join products p on p.id = l.product_id where l.offer_id = $1 order by l.line_no`, [offerId])).rows;
  const history = (await db.query<{ n: number }>(`select count(*)::int as n from invoices where customer_id = $1 and doc_type = 'invoice' and status = 'issued'`, [offer.customer_id])).rows[0]!.n;
  const usual = (await db.query<{ reference: string }>(
    `select p.reference from invoice_lines l join invoices i on i.id = l.invoice_id join products p on p.id = l.product_id
     where i.customer_id = $1 and i.status = 'issued' and i.doc_type = 'invoice' group by p.reference having count(distinct i.id) >= 3 limit 20`, [offer.customer_id])).rows.map((r) => r.reference);
  const contact = await primaryContact(db, offer.customer_id);
  const sender = await senderInfo(db, orgId, actor.userId);
  const maxLineDiscount = Math.max(0, ...lines.map((l) => Number(l.discount_pct)));
  const context = {
    customerName: offer.customer_name,
    contact: contact?.ctx ?? null,
    offer: { number: offer.number, validUntil: offer.valid_until, totalHt: offer.total_ht, lines: lines.map((l) => ({ reference: l.reference, description: l.description, quantity: l.quantity })) },
    history: { invoiceCount: history, usualReferences: usual },
    newProductNames: lines.filter((l) => l.is_new && !usual.includes(l.reference)).map((l) => l.description).slice(0, 3),
    ...sender,
  };
  const input = `Rédige l'email d'accompagnement de l'offre ci-dessous. Objectif : obtenir la commande ou un rendez-vous.
Données vérifiées du système (seules sources autorisées) :
${wrapUntrusted("system_data", JSON.stringify(context, null, 2))}`;
  const res = await llm.structured({ task: "draft_offer_email", system: LEA_SYSTEM, input, schema: emailDraftSchema, context });
  let draft = res.data;
  const guard = checkMessage(draft.body, { allowedDiscountPct: maxLineDiscount > 0 ? maxLineDiscount : null, personalizedAllowed: history >= 3 && usual.length > 0 });
  const guardNotes: string[] = [];
  if (!guard.ok) {
    // Repli sûr : gabarit déterministe, et on garde la trace du rejet.
    guardNotes.push(...guard.reasons);
    draft = mockOfferEmail(context);
  }
  const runId = await recordRun(db, orgId, "message_draft", actor, llm, { offerId, task: "draft_offer_email" }, { draft, guardNotes }, res.usage);

  // Canal : email (offre complète + pièces jointes) ou WhatsApp (modèle approuvé + PDF) si c'est le seul canal autorisé.
  const channel: "email" | "whatsapp" = contact?.channel ?? "email";
  let body = draft.body;
  let subject: string | null = draft.subject;
  let template: ReturnType<typeof buildTemplate>["template"] | null = null;
  if (channel === "whatsapp") {
    const name = [contact?.ctx?.salutation === "Mme" ? "Madame" : contact?.ctx?.salutation === "M." ? "Monsieur" : null, contact?.ctx?.lastName ?? contact?.ctx?.firstName].filter(Boolean).join(" ") || offer.customer_name;
    const t = buildTemplate("offre_disponible", [name, offer.number, formatMoney(offer.total_ht), offer.valid_until ? formatDate(offer.valid_until, { day: "numeric", month: "long", year: "numeric" }) : "nouvel ordre", sender.companyName]);
    body = t.text;
    subject = null;
    template = t.template;
  }
  const to = channel === "whatsapp" ? contact?.mobile ?? null : contact?.email ?? null;
  let conv = (await db.query<{ id: string }>(`select id from conversations where offer_id = $1 and channel = $2 limit 1`, [offerId, channel])).rows[0];
  if (!conv) {
    conv = (await db.query<{ id: string }>(
      `insert into conversations (organization_id, customer_id, contact_id, channel, subject, status, assigned_user_id, offer_id, last_message_at)
       values ($1,$2,$3,$7,$4,'open',$5,$6, now()) returning id`,
      [orgId, offer.customer_id, contact?.id ?? null, draft.subject, actor.userId, offerId, channel])).rows[0]!;
  }
  // Autonomie : uniquement pour les envois initiés par LÉA (un humain qui demande un brouillon garde la main).
  const decision: AutonomyDecision | null = opts.autonomous
    ? decideAutonomy(await loadAutonomy(db, orgId), { kind: "offer_email", offerTotalHt: offer.total_ht, discountPct: maxLineDiscount, guardNotes, identityVerified: !!to })
    : null;
  const automatic = decision?.mode === "auto";
  const msg = await db.query<{ id: string }>(
    `insert into messages (organization_id, conversation_id, direction, channel, to_address, subject, body, status, ai_generated, ai_analysis, created_by)
     values ($1,$2,'outbound',$9,$3,$4,$5,$8, true, $6, $7) returning id`,
    [orgId, conv.id, to, subject, body, { personalizationBasis: draft.personalizationBasis, arguments: draft.arguments, simulatedAi: res.simulated, guardNotes, runId, autonomy: decision, template, emailDraft: channel === "whatsapp" ? draft.body : undefined }, actor.userId, automatic ? "approved" : "pending_approval", channel],
  );
  const messageId = msg.rows[0]!.id;
  if (!automatic)
    await db.query(
      `insert into approvals (organization_id, subject_type, subject_id, summary, payload, requested_by_agent, requested_by)
       values ($1,'message',$2,$3,$4,true,$5)
       on conflict (organization_id, subject_type, subject_id) where status = 'pending' do nothing`,
      [orgId, messageId, `${channel === "whatsapp" ? "WhatsApp" : "Email"} « ${subject ?? offer.number} » à ${offer.customer_name}`, { offerId, conversationId: conv.id, reason: decision?.reason ?? null }, actor.userId],
    );
  await db.query(`insert into agent_decisions (organization_id, run_id, customer_id, decision_type, rationale, payload, requires_approval) values ($1,$2,$3,$4,$5,$6,$7)`,
    [orgId, runId, offer.customer_id, automatic ? "auto_send" : "draft_message",
      `${draft.personalizationBasis === "purchase_history" ? `Email personnalisé sur la base de ${history} factures.` : "Email générique : historique insuffisant pour personnaliser."}${decision ? ` ${decision.reason}` : ""}`,
      { messageId, offerId }, !automatic]);
  await audit(db, orgId, actor.userId ? { type: "user", userId: actor.userId } : { type: "agent" }, "lea.message_drafted", { type: "message", id: messageId }, { offerId, simulatedAi: res.simulated, autonomous: automatic });
  const dispatch: DispatchResult | null = automatic ? await dispatchMessage(db, orgId, messageId, { type: "agent" }, { autonomous: true, now: opts.now }) : null;
  return { messageId, conversationId: conv.id, simulated: res.simulated, guardNotes, decision, dispatch };
}

/** Analyse une réponse client entrante, met à jour la mémoire et prépare la réponse. */
export async function analyzeInbound(db: Db, orgId: string, messageId: string, actor: Actor, opts: { now?: Date } = {}) {
  const llm = getLlm();
  const m = (await db.query<{ id: string; body: string; conversation_id: string; from_address: string | null; customer_id: string | null; offer_id: string | null }>(
    `select m.id, m.body, m.conversation_id, m.from_address, c.customer_id, c.offer_id from messages m join conversations c on c.id = m.conversation_id
     where m.id = $1 and m.organization_id = $2 and m.direction = 'inbound'`, [messageId, orgId])).rows[0];
  if (!m) throw new Error("Message introuvable.");
  const flags = detectInjection(m.body);
  const input = `Analyse la réponse client suivante.\n${wrapUntrusted("email_inbound", m.body)}`;
  const res = await llm.structured({ task: "analyze_reply", system: ANALYST_SYSTEM, input, schema: replyAnalysisSchema, context: { text: m.body } });
  const analysis = res.data;
  const runId = await recordRun(db, orgId, "reply_analysis", actor, llm, { messageId }, { analysis, injectionFlags: flags }, res.usage);
  await db.query(`update messages set ai_analysis = $2 where id = $1`, [messageId, { ...analysis, injectionFlags: flags, simulatedAi: res.simulated, runId }]);
  await db.query(`update conversations set status = 'waiting_us', last_message_at = now(), next_action = $2 where id = $1`, [m.conversation_id, analysis.nextAction]);

  if (m.customer_id) {
    if (analysis.objection)
      await db.query(`insert into agent_memory (organization_id, customer_id, kind, certainty, content, data, source) values ($1,$2,'objection','declared',$3,$4,'email entrant')`,
        [orgId, m.customer_id, analysis.summary, { objection: analysis.objection, requestedDiscountPct: analysis.requestedDiscountPct, messageId }]);
    if (analysis.requestedDiscountPct !== null || analysis.targetPrice || analysis.requestedQuantity)
      await db.query(`insert into agent_memory (organization_id, customer_id, kind, certainty, content, data, source) values ($1,$2,'negotiation','declared',$3,$4,'email entrant')`,
        [orgId, m.customer_id, `Demande client : ${[analysis.requestedDiscountPct !== null && `remise ${analysis.requestedDiscountPct} %`, analysis.requestedQuantity && `quantité ${analysis.requestedQuantity}`, analysis.targetPrice && `prix cible ${analysis.targetPrice}`].filter(Boolean).join(", ")}`, { messageId }]);
  }
  if (analysis.intent === "unsubscribe" && m.from_address) {
    const ch = (await db.query<{ channel: "email" | "whatsapp" }>(`select channel from conversations where id = $1`, [m.conversation_id])).rows[0]!.channel;
    await db.query(`insert into suppression_entries (organization_id, channel, address, reason) values ($1,$2,$3,'unsubscribe') on conflict do nothing`,
      [orgId, ch, ch === "email" ? m.from_address.trim().toLowerCase() : (toE164(m.from_address) ?? m.from_address)]);
    await db.query(`update messages set handled = true where id = $1`, [messageId]);
    await audit(db, orgId, { type: "agent" }, "suppression.added", { type: "message", id: messageId });
    return { analysis, replyMessageId: null, runId };
  }
  if (analysis.intent === "out_of_office") return { analysis, replyMessageId: null, runId };
  if (m.offer_id && ["sent", "approved"].includes((await db.query<{ status: string }>(`select status from offers where id = $1`, [m.offer_id])).rows[0]?.status ?? ""))
    await db.query(`update offers set status = 'negotiation' where id = $1 and status = 'sent' and $2`, [m.offer_id, analysis.intent === "objection"]);
  const reply = await draftReply(db, orgId, messageId, analysis, actor, { injectionSuspected: flags.length > 0, now: opts.now });
  return { analysis, replyMessageId: reply.messageId, runId, escalated: reply.escalated, decision: reply.decision, dispatch: reply.dispatch, orderNumber: reply.orderNumber };
}

/**
 * Prépare la réponse à un client (objection, question, accord).
 * Mode supervisé : validation humaine. Mode autonome : envoi direct si les règles déterministes l'autorisent.
 */
export async function draftReply(db: Db, orgId: string, inboundId: string, analysis: ReplyAnalysis, actor: Actor, opts: { injectionSuspected?: boolean; now?: Date } = {}) {
  const llm = getLlm();
  const policy: CommercialPolicy = await loadPolicy(db, orgId);
  const m = (await db.query<{ conversation_id: string; from_address: string | null; customer_id: string | null; customer_name: string | null; offer_id: string | null; subject: string | null; identity_confidence: string }>(
    `select m.conversation_id, m.from_address, c.customer_id, coalesce(cu.trade_name, cu.legal_name) as customer_name, c.offer_id, m.subject, c.identity_confidence
     from messages m join conversations c on c.id = m.conversation_id left join customers cu on cu.id = c.customer_id where m.id = $1`, [inboundId])).rows[0]!;
  const offer = m.offer_id ? (await db.query<{ number: string; total_ht: string; valid_until: string | null }>(`select number, total_ht, valid_until from offers where id = $1`, [m.offer_id])).rows[0] ?? null : null;
  const contact = m.customer_id ? await primaryContact(db, m.customer_id) : null;
  const sender = await senderInfo(db, orgId, actor.userId);
  // Discussion : canal de la conversation, historique, et réponses factuelles calculées à partir des données.
  const inbound = (await db.query<{ body: string }>(`select body from messages where id = $1`, [inboundId])).rows[0]!;
  const channel = (await db.query<{ channel: "email" | "whatsapp" }>(`select channel from conversations where id = $1`, [m.conversation_id])).rows[0]!.channel;
  const history = (await db.query<{ direction: string; body: string }>(
    `select direction, body from messages where conversation_id = $1 and id <> $2 and status not in ('draft','pending_approval') order by created_at desc limit 12`, [m.conversation_id, inboundId])).rows.reverse();
  const turn = history.filter((h) => h.direction === "outbound").length;
  const facts = await loadFacts(db, m.customer_id, m.offer_id);
  const topics = detectTopics(inbound.body);
  const { answers, unknown, unknownLabels } = answerFromFacts(topics, facts, inbound.body);

  // Décision de remise : 100 % déterministe
  let escalate = false;
  let allowed: number | null = null;
  let decisionText = "Aucune remise demandée.";
  if (analysis.requestedDiscountPct !== null) {
    const d = evaluateDiscount(policy, analysis.requestedDiscountPct);
    decisionText = d.explanation;
    if (d.kind === "escalate") escalate = true;
    else allowed = Number(d.pct);
  } else if (analysis.objection === "competition" || analysis.objection === "refusal") {
    escalate = analysis.objection === "competition";
    decisionText = escalate ? "Concurrence évoquée : transfert au commercial avec les éléments collectés." : decisionText;
  }

  const context = {
    analysis,
    customerName: m.customer_name ?? "",
    contact: contact?.ctx ?? null,
    offer: offer ? { number: offer.number, totalHt: offer.total_ht, validUntil: offer.valid_until } : null,
    allowedDiscountPct: allowed,
    escalate,
    ...sender,
    channel,
    answers,
    unknownLabels,
    turn,
  };
  const input = `Rédige la réponse au client. Décision du système sur la remise (à respecter strictement) : ${decisionText}
Remise maximale utilisable dans ce message : ${allowed ?? 0} %. ${escalate ? "Le dossier est transféré au commercial : annonce-le sans rien promettre." : ""}
Canal : ${channel === "whatsapp" ? "WhatsApp — messages courts, ton de messagerie, pas d'objet" : "email"}.
Réponses factuelles autorisées (n'en invente aucune autre) : ${answers.length ? answers.join(" | ") : "aucune"}.
${unknownLabels.length ? `Sujets SANS donnée fiable (annonce que le commercial confirme, ne réponds pas toi-même) : ${unknownLabels.join(", ")}.` : ""}
Données du système :
${wrapUntrusted("system_data", JSON.stringify({ customerName: context.customerName, contact: context.contact, offer: context.offer, analysis }, null, 2))}
Historique de la conversation (du plus ancien au plus récent) :
${wrapUntrusted("conversation_history", history.map((h) => `${h.direction === "inbound" ? "CLIENT" : "NOUS"} : ${h.body}`).join("\n---\n"), 6000)}`;
  const res = await llm.structured({ task: "draft_objection_reply", system: LEA_SYSTEM, input, schema: objectionReplySchema, context });
  let reply = res.data;
  const guard = checkMessage(reply.body, { allowedDiscountPct: allowed, personalizedAllowed: true });
  const guardNotes: string[] = [];
  if (!guard.ok || (reply.proposedDiscountPct ?? 0) > (allowed ?? 0)) {
    guardNotes.push(...(guard.ok ? ["Remise proposée par l'IA supérieure à la décision du système."] : guard.reasons));
    reply = mockObjectionReply(context);
  }
  const runId = await recordRun(db, orgId, "message_draft", actor, llm, { inboundId, task: "draft_objection_reply" }, { reply, decisionText, guardNotes }, res.usage);
  const decision = decideAutonomy(await loadAutonomy(db, orgId), {
    kind: "reply",
    intent: analysis.intent,
    objection: analysis.objection,
    escalate,
    discountPct: reply.proposedDiscountPct,
    answered: answers.length,
    unanswered: unknown.length,
    guardNotes,
    identityVerified: m.identity_confidence === "verified" && !!m.customer_id,
    injectionSuspected: !!opts.injectionSuspected,
  });
  const automatic = decision.mode === "auto";
  const msg = await db.query<{ id: string }>(
    `insert into messages (organization_id, conversation_id, direction, channel, to_address, subject, body, status, ai_generated, ai_analysis, reply_to_message_id, created_by)
     values ($1,$2,'outbound',$10,$3,$4,$5,$9,true,$6,$7,$8) returning id`,
    [orgId, m.conversation_id, m.from_address, channel === "whatsapp" ? null : reply.subject, reply.body, { rationale: reply.rationale, discountPct: reply.proposedDiscountPct, decisionText, escalate, guardNotes, simulatedAi: res.simulated, runId, autonomy: decision, answers, unknown: unknownLabels }, inboundId, actor.userId, automatic ? "approved" : "pending_approval", channel],
  );
  if (!automatic)
    await db.query(
      `insert into approvals (organization_id, subject_type, subject_id, summary, payload, requested_by_agent, requested_by)
       values ($1, $2, $3, $4, $5, true, $6)`,
      [orgId, reply.proposedDiscountPct ? "discount" : "message", msg.rows[0]!.id,
        reply.proposedDiscountPct ? `Réponse avec remise de ${reply.proposedDiscountPct} % — ${m.customer_name}` : `Réponse à ${m.customer_name ?? "client"}`,
        { conversationId: m.conversation_id, discountPct: reply.proposedDiscountPct, decisionText, reason: decision.reason }, actor.userId],
    );
  await db.query(`update messages set handled = true where id = $1`, [inboundId]);
  if (escalate && m.customer_id) {
    await db.query(
      `insert into followup_tasks (organization_id, customer_id, conversation_id, offer_id, kind, title, due_at, assigned_user_id, idempotency_key, notes, created_by_agent)
       select $1, $2, $3, $4, 'escalation', $5, now() + interval '1 day', cu.owner_user_id, $6, $7, true from customers cu where cu.id = $2
       on conflict (organization_id, idempotency_key) do nothing`,
      [orgId, m.customer_id, m.conversation_id, m.offer_id, `Négociation à reprendre — ${m.customer_name}`, `escalation:${inboundId}`, decisionText],
    );
  }
  if (unknown.length && m.customer_id) {
    // Points sans donnée fiable : le commercial complète, LÉA a prévenu le client.
    await db.query(
      `insert into followup_tasks (organization_id, customer_id, conversation_id, offer_id, kind, title, due_at, assigned_user_id, idempotency_key, notes, created_by_agent)
       select $1, $2, $3, $4, 'reply', $5, now() + interval '4 hours', cu.owner_user_id, $6, $7, true from customers cu where cu.id = $2
       on conflict (organization_id, idempotency_key) do nothing`,
      [orgId, m.customer_id, m.conversation_id, m.offer_id, `Répondre au client — ${unknownLabels.join(", ")} (${m.customer_name})`, `reply:${inboundId}`, inbound.body.slice(0, 500)],
    );
  }
  if (analysis.intent === "meeting_request" && m.customer_id) {
    await db.query(
      `insert into followup_tasks (organization_id, customer_id, conversation_id, offer_id, kind, title, due_at, assigned_user_id, idempotency_key, created_by_agent)
       select $1, $2, $3, $4, 'meeting', $5, now() + interval '1 day', cu.owner_user_id, $6, true from customers cu where cu.id = $2
       on conflict (organization_id, idempotency_key) do nothing`,
      [orgId, m.customer_id, m.conversation_id, m.offer_id, `Fixer un rendez-vous — ${m.customer_name}`, `meeting:${inboundId}`],
    );
  }
  let orderNumber: string | null = null;
  if (analysis.intent === "accept" && m.customer_id && automatic && m.offer_id) {
    // Mode autonome : le client a accepté → LÉA prépare elle-même la demande de commande.
    orderNumber = (await acceptOfferAndPrepareOrder(db, orgId, null, m.offer_id)).number;
  } else if (analysis.intent === "accept" && m.customer_id) {
    await db.query(
      `insert into followup_tasks (organization_id, customer_id, conversation_id, offer_id, kind, title, due_at, idempotency_key, created_by_agent)
       values ($1,$2,$3,$4,'order',$5, now(), $6, true) on conflict (organization_id, idempotency_key) do nothing`,
      [orgId, m.customer_id, m.conversation_id, m.offer_id, `Préparer la commande — ${m.customer_name}`, `order:${inboundId}`],
    );
  }
  await db.query(`insert into agent_decisions (organization_id, run_id, customer_id, decision_type, rationale, payload, requires_approval) values ($1,$2,$3,$4,$5,$6,$7)`,
    [orgId, runId, m.customer_id, automatic ? "auto_reply" : escalate ? "escalation" : "draft_reply", `${reply.rationale} ${decision.reason}`, { messageId: msg.rows[0]!.id, escalate, decisionText, orderNumber }, !automatic]);
  const dispatch: DispatchResult | null = automatic ? await dispatchMessage(db, orgId, msg.rows[0]!.id, { type: "agent" }, { autonomous: true, now: opts.now }) : null;
  return { messageId: msg.rows[0]!.id, escalated: escalate, simulated: res.simulated, decision, dispatch, orderNumber };
}

/** Relance d'une offre restée sans réponse (déclenchée par une tâche de relance échue). */
export async function draftFollowup(db: Db, orgId: string, taskId: string, opts: { now?: Date } = {}) {
  const llm = getLlm();
  const t = (await db.query<{ id: string; conversation_id: string | null; customer_id: string | null; offer_id: string | null; attempt: number }>(
    `select id, conversation_id, customer_id, offer_id, attempt from followup_tasks where id = $1 and organization_id = $2 and kind = 'followup' and status = 'pending'`, [taskId, orgId])).rows[0];
  if (!t?.conversation_id || !t.customer_id) return null;
  // Le client a répondu depuis : pas de relance.
  const conv = (await db.query<{ status: string }>(`select status from conversations where id = $1`, [t.conversation_id])).rows[0];
  const offer = t.offer_id ? (await db.query<{ number: string; total_ht: string; valid_until: string | null; status: string }>(`select number, total_ht, valid_until, status from offers where id = $1`, [t.offer_id])).rows[0] ?? null : null;
  if (conv?.status !== "waiting_customer" || (offer && !["sent", "negotiation"].includes(offer.status))) {
    await db.query(`update followup_tasks set status = 'cancelled', notes = 'Relance inutile : réponse reçue ou offre close.' where id = $1`, [taskId]);
    return null;
  }
  const contact = await primaryContact(db, t.customer_id);
  const sender = await senderInfo(db, orgId, null);
  const cfg = await loadAutonomy(db, orgId);
  const context = { contact: contact?.ctx ?? null, offer: offer ? { number: offer.number, totalHt: offer.total_ht, validUntil: offer.valid_until } : null, attempt: t.attempt, ...sender };
  const res = await llm.structured({
    task: "draft_followup",
    system: LEA_SYSTEM,
    input: `Rédige une relance courte et polie (relance n° ${t.attempt}) pour une proposition restée sans réponse. N'ajoute aucune remise ni promesse.\nDonnées :\n${wrapUntrusted("system_data", JSON.stringify(context))}`,
    schema: emailDraftSchema,
    context,
  });
  let draft = res.data;
  const guardNotes: string[] = [];
  const guard = checkMessage(draft.body, { allowedDiscountPct: null, personalizedAllowed: false });
  if (!guard.ok) {
    guardNotes.push(...guard.reasons);
    draft = mockFollowup(context);
  }
  // WhatsApp : la relance arrive hors fenêtre de 24 h → modèle approuvé « relance_offre ».
  const fchannel = (await db.query<{ channel: "email" | "whatsapp" }>(`select channel from conversations where id = $1`, [t.conversation_id])).rows[0]!.channel;
  let ftemplate: ReturnType<typeof buildTemplate>["template"] | null = null;
  if (fchannel === "whatsapp") {
    const name = [contact?.ctx?.salutation === "Mme" ? "Madame" : contact?.ctx?.salutation === "M." ? "Monsieur" : null, contact?.ctx?.lastName ?? contact?.ctx?.firstName].filter(Boolean).join(" ") || "";
    const tpl = buildTemplate("relance_offre", [name || "et merci", offer?.number ?? "", sender.companyName]);
    draft = { ...draft, subject: draft.subject, body: tpl.text };
    ftemplate = tpl.template;
  }
  const decision = decideAutonomy(cfg, { kind: "followup", attempt: t.attempt, maxFollowups: cfg.maxFollowups, guardNotes });
  const automatic = decision.mode === "auto";
  const runId = await recordRun(db, orgId, "followup", { userId: null }, llm, { taskId }, { draft, decision }, res.usage);
  const msg = await db.query<{ id: string }>(
    `insert into messages (organization_id, conversation_id, direction, channel, to_address, subject, body, status, ai_generated, ai_analysis)
     values ($1,$2,'outbound',$8,$3,$4,$5,$6,true,$7) returning id`,
    [orgId, t.conversation_id, fchannel === "whatsapp" ? contact?.mobile ?? null : contact?.email ?? null, fchannel === "whatsapp" ? null : draft.subject, draft.body, automatic ? "approved" : "pending_approval",
      { kind: "followup", attempt: t.attempt, simulatedAi: res.simulated, guardNotes, runId, autonomy: decision, template: ftemplate }, fchannel],
  );
  await db.query(`update followup_tasks set status = 'done' where id = $1`, [taskId]);
  if (!automatic)
    await db.query(`insert into approvals (organization_id, subject_type, subject_id, summary, payload, requested_by_agent) values ($1,'message',$2,$3,$4,true)`,
      [orgId, msg.rows[0]!.id, `Relance n° ${t.attempt}${offer ? ` — offre ${offer.number}` : ""}`, { conversationId: t.conversation_id, reason: decision.reason }]);
  await db.query(`insert into agent_decisions (organization_id, run_id, customer_id, decision_type, rationale, payload, requires_approval) values ($1,$2,$3,$4,$5,$6,$7)`,
    [orgId, runId, t.customer_id, automatic ? "auto_followup" : "draft_followup", decision.reason, { messageId: msg.rows[0]!.id }, !automatic]);
  const dispatch = automatic ? await dispatchMessage(db, orgId, msg.rows[0]!.id, { type: "agent" }, { autonomous: true, now: opts.now }) : null;
  return { messageId: msg.rows[0]!.id, decision, dispatch };
}
