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
import { mockObjectionReply, mockOfferEmail, type ContactCtx } from "./mock-brain";
import { checkMessage } from "./guards";
import { loadPolicy } from "@/features/settings/policy-repo";

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

async function primaryContact(db: Db, customerId: string): Promise<{ id: string; email: string | null; ctx: ContactCtx } | null> {
  const r = await db.query<{ id: string; email: string | null; salutation: string | null; first_name: string | null; last_name: string | null }>(
    `select c.id, c.email, c.salutation, c.first_name, c.last_name from customer_contacts cc join contacts c on c.id = cc.contact_id
     where cc.customer_id = $1 and cc.can_receive_offers order by cc.is_primary desc, c.created_at limit 1`,
    [customerId],
  );
  const c = r.rows[0];
  return c ? { id: c.id, email: c.email, ctx: { salutation: c.salutation, firstName: c.first_name, lastName: c.last_name } } : null;
}

/** Rédige l'email d'accompagnement d'une offre → message en attente de validation. */
export async function draftOfferEmail(db: Db, orgId: string, offerId: string, actor: Actor) {
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

  let conv = (await db.query<{ id: string }>(`select id from conversations where offer_id = $1 and channel = 'email' limit 1`, [offerId])).rows[0];
  if (!conv) {
    conv = (await db.query<{ id: string }>(
      `insert into conversations (organization_id, customer_id, contact_id, channel, subject, status, assigned_user_id, offer_id, last_message_at)
       values ($1,$2,$3,'email',$4,'open',$5,$6, now()) returning id`,
      [orgId, offer.customer_id, contact?.id ?? null, draft.subject, actor.userId, offerId])).rows[0]!;
  }
  const msg = await db.query<{ id: string }>(
    `insert into messages (organization_id, conversation_id, direction, channel, to_address, subject, body, status, ai_generated, ai_analysis, created_by)
     values ($1,$2,'outbound','email',$3,$4,$5,'pending_approval', true, $6, $7) returning id`,
    [orgId, conv.id, contact?.email ?? null, draft.subject, draft.body, { personalizationBasis: draft.personalizationBasis, arguments: draft.arguments, simulatedAi: res.simulated, guardNotes, runId }, actor.userId],
  );
  await db.query(
    `insert into approvals (organization_id, subject_type, subject_id, summary, payload, requested_by_agent, requested_by)
     values ($1,'message',$2,$3,$4,true,$5)
     on conflict (organization_id, subject_type, subject_id) where status = 'pending' do nothing`,
    [orgId, msg.rows[0]!.id, `Email « ${draft.subject} » à ${offer.customer_name}`, { offerId, conversationId: conv.id }, actor.userId],
  );
  await db.query(`insert into agent_decisions (organization_id, run_id, customer_id, decision_type, rationale, payload, requires_approval) values ($1,$2,$3,'draft_message',$4,$5,true)`,
    [orgId, runId, offer.customer_id, draft.personalizationBasis === "purchase_history" ? `Email personnalisé sur la base de ${history} factures.` : "Email générique : historique insuffisant pour personnaliser.", { messageId: msg.rows[0]!.id }]);
  await audit(db, orgId, actor.userId ? { type: "user", userId: actor.userId } : { type: "agent" }, "lea.message_drafted", { type: "message", id: msg.rows[0]!.id }, { offerId, simulatedAi: res.simulated });
  return { messageId: msg.rows[0]!.id, conversationId: conv.id, simulated: res.simulated, guardNotes };
}

/** Analyse une réponse client entrante, met à jour la mémoire et prépare la réponse. */
export async function analyzeInbound(db: Db, orgId: string, messageId: string, actor: Actor) {
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
    await db.query(`insert into suppression_entries (organization_id, channel, address, reason) values ($1,'email',$2,'unsubscribe') on conflict do nothing`, [orgId, m.from_address.trim().toLowerCase()]);
    await db.query(`update messages set handled = true where id = $1`, [messageId]);
    await audit(db, orgId, { type: "agent" }, "suppression.added", { type: "message", id: messageId });
    return { analysis, replyMessageId: null, runId };
  }
  if (analysis.intent === "out_of_office") return { analysis, replyMessageId: null, runId };
  if (m.offer_id && ["sent", "approved"].includes((await db.query<{ status: string }>(`select status from offers where id = $1`, [m.offer_id])).rows[0]?.status ?? ""))
    await db.query(`update offers set status = 'negotiation' where id = $1 and status = 'sent' and $2`, [m.offer_id, analysis.intent === "objection"]);
  const reply = await draftReply(db, orgId, messageId, analysis, actor);
  return { analysis, replyMessageId: reply.messageId, runId, escalated: reply.escalated };
}

/** Prépare la réponse à une réponse client (objection, question, accord) — jamais envoyée sans validation. */
export async function draftReply(db: Db, orgId: string, inboundId: string, analysis: ReplyAnalysis, actor: Actor) {
  const llm = getLlm();
  const policy: CommercialPolicy = await loadPolicy(db, orgId);
  const m = (await db.query<{ conversation_id: string; from_address: string | null; customer_id: string | null; customer_name: string | null; offer_id: string | null; subject: string | null }>(
    `select m.conversation_id, m.from_address, c.customer_id, coalesce(cu.trade_name, cu.legal_name) as customer_name, c.offer_id, m.subject
     from messages m join conversations c on c.id = m.conversation_id left join customers cu on cu.id = c.customer_id where m.id = $1`, [inboundId])).rows[0]!;
  const offer = m.offer_id ? (await db.query<{ number: string; total_ht: string; valid_until: string | null }>(`select number, total_ht, valid_until from offers where id = $1`, [m.offer_id])).rows[0] ?? null : null;
  const contact = m.customer_id ? await primaryContact(db, m.customer_id) : null;
  const sender = await senderInfo(db, orgId, actor.userId);

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
  };
  const input = `Rédige la réponse au client. Décision du système sur la remise (à respecter strictement) : ${decisionText}
Remise maximale utilisable dans ce message : ${allowed ?? 0} %. ${escalate ? "Le dossier est transféré au commercial : annonce-le sans rien promettre." : ""}
Données du système :
${wrapUntrusted("system_data", JSON.stringify({ customerName: context.customerName, contact: context.contact, offer: context.offer, analysis }, null, 2))}`;
  const res = await llm.structured({ task: "draft_objection_reply", system: LEA_SYSTEM, input, schema: objectionReplySchema, context });
  let reply = res.data;
  const guard = checkMessage(reply.body, { allowedDiscountPct: allowed, personalizedAllowed: true });
  const guardNotes: string[] = [];
  if (!guard.ok || (reply.proposedDiscountPct ?? 0) > (allowed ?? 0)) {
    guardNotes.push(...(guard.ok ? ["Remise proposée par l'IA supérieure à la décision du système."] : guard.reasons));
    reply = mockObjectionReply(context);
  }
  const runId = await recordRun(db, orgId, "message_draft", actor, llm, { inboundId, task: "draft_objection_reply" }, { reply, decisionText, guardNotes }, res.usage);
  const msg = await db.query<{ id: string }>(
    `insert into messages (organization_id, conversation_id, direction, channel, to_address, subject, body, status, ai_generated, ai_analysis, reply_to_message_id, created_by)
     values ($1,$2,'outbound','email',$3,$4,$5,'pending_approval',true,$6,$7,$8) returning id`,
    [orgId, m.conversation_id, m.from_address, reply.subject, reply.body, { rationale: reply.rationale, discountPct: reply.proposedDiscountPct, decisionText, escalate, guardNotes, simulatedAi: res.simulated, runId }, inboundId, actor.userId],
  );
  await db.query(
    `insert into approvals (organization_id, subject_type, subject_id, summary, payload, requested_by_agent, requested_by)
     values ($1, $2, $3, $4, $5, true, $6)`,
    [orgId, reply.proposedDiscountPct ? "discount" : "message", msg.rows[0]!.id,
      reply.proposedDiscountPct ? `Réponse avec remise de ${reply.proposedDiscountPct} % — ${m.customer_name}` : `Réponse à ${m.customer_name ?? "client"}`,
      { conversationId: m.conversation_id, discountPct: reply.proposedDiscountPct, decisionText }, actor.userId],
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
  if (analysis.intent === "accept" && m.customer_id) {
    await db.query(
      `insert into followup_tasks (organization_id, customer_id, conversation_id, offer_id, kind, title, due_at, idempotency_key, created_by_agent)
       values ($1,$2,$3,$4,'order',$5, now(), $6, true) on conflict (organization_id, idempotency_key) do nothing`,
      [orgId, m.customer_id, m.conversation_id, m.offer_id, `Préparer la commande — ${m.customer_name}`, `order:${inboundId}`],
    );
  }
  await db.query(`insert into agent_decisions (organization_id, run_id, customer_id, decision_type, rationale, payload, requires_approval) values ($1,$2,$3,'draft_reply',$4,$5,true)`,
    [orgId, runId, m.customer_id, reply.rationale, { messageId: msg.rows[0]!.id, escalate, decisionText }]);
  return { messageId: msg.rows[0]!.id, escalated: escalate, simulated: res.simulated };
}
