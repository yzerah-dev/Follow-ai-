/**
 * Le client renvoie l'Excel de sa sélection avec ses quantités : LÉA met l'offre à jour et répond.
 *
 * - Seules la référence (ou l'EAN) et la quantité du fichier sont lues ; les prix viennent du catalogue (jamais du fichier).
 * - Quantités arrondies au colisage / minimum de commande par le moteur d'offre (signalé au client).
 * - Une offre envoyée n'est pas modifiée : une offre révisée la remplace (lien supersedes_offer_id, comme en négociation).
 * - Références inconnues ou quantités illisibles : signalées au client et transmises au commercial (tâche).
 * - L'envoi de la réponse suit les règles d'autonomie (plafond d'offre, mode supervisé…).
 */
import type { Db } from "@/lib/database/client";
import { dec, formatMoney } from "@/lib/money";
import { audit } from "@/lib/security/audit";
import { putFile, storagePath } from "@/lib/storage";
import { toIsoDate } from "@/lib/utils";
import { createOfferDraft, OfferNotBuildable } from "@/features/offers/service";
import { generateOfferAssets, autoApproveAssets } from "@/features/creative-studio/service";
import { parseClientOfferExcel, ClientExcelUnreadable, type ClientExcel } from "@/features/offers/client-excel";
import { loadAutonomy } from "@/features/settings/policy-repo";
import { dispatchMessage, type DispatchResult } from "@/features/conversations/dispatch";
import { decideAutonomy, type AutonomyDecision } from "./autonomy";
import { greeting } from "./mock-brain";
import { parseVoice, signoff } from "./voice";

export type ExcelReturnStatus = "revised" | "unchanged" | "unreadable" | "empty" | "not_applicable";
export type ExcelReturnResult = { status: ExcelReturnStatus; summary: string; replyMessageId: string | null; revisedOfferId: string | null; decision: AutonomyDecision | null; dispatch: DispatchResult | null };

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const isExcelFile = (filename: string, mime?: string | null) => /\.xlsx$/i.test(filename) || mime === XLSX_MIME;

const list = (names: string[], max = 5) => (names.length > max ? `${names.slice(0, max).join(", ")} et ${names.length - max} autre(s)` : names.join(", "));

type Change = { added: string[]; removed: string[]; rounded: { name: string; asked: string; final: string }[]; excluded: string[]; unknown: string[]; invalid: string[] };

/** Texte de la réponse (déterministe : uniquement des faits calculés). Pas de signature WhatsApp dans une discussion. */
export function excelReplyText(args: {
  status: ExcelReturnStatus; channel: "email" | "whatsapp"; hello: string; lineCount?: number; totalHt?: string; change?: Change; companyName: string; voice: unknown;
}): string {
  const wa = args.channel === "whatsapp";
  const c = args.change;
  const name = args.hello.replace(/^Bonjour /, "").replace(/,$/, "");
  const parts: (string | null)[] = [];
  if (args.status === "unreadable") {
    parts.push(wa ? `${args.hello.replace(/,$/, " !")}` : args.hello, wa ? null : "",
      "Merci pour votre fichier ! Je n'arrive pas à le lire : pouvez-vous me renvoyer l'Excel que je vous ai transmis, en modifiant seulement la colonne des quantités ?");
  } else if (args.status === "unchanged") {
    parts.push(`Merci ${name}, c'est noté ! Vos quantités correspondent à la sélection que je vous ai envoyée.`, "Souhaitez-vous que je la valide ? Un simple « OK » suffit.");
  } else if (args.status === "empty") {
    parts.push(`Merci ${name}, c'est bien noté. Vous n'avez gardé aucune quantité dans le fichier : je transmets à votre commercial, qui revient vers vous pour voir ce qui vous conviendrait.`);
  } else {
    parts.push(`Merci ${name}, c'est noté ! J'ai mis à jour votre commande avec vos quantités : ${args.lineCount} référence${args.lineCount! > 1 ? "s" : ""} pour ${formatMoney(args.totalHt!)} HT. Je vous joins le récapitulatif.`);
    if (c?.rounded.length) parts.push(`Quantités arrondies au colisage : ${c.rounded.slice(0, 5).map((r) => `${r.name} ${Number(r.asked)} → ${Number(r.final)}`).join(", ")}${c.rounded.length > 5 ? "…" : ""}.`);
    if (c?.removed.length) parts.push(`Retiré à votre demande : ${list(c.removed)}.`);
    if (c?.added.length) parts.push(`Ajouté : ${list(c.added)}.`);
    if (c?.excluded.length) parts.push(`Non disponible pour le moment : ${list(c.excluded)}.`);
    if (c && (c.unknown.length || c.invalid.length))
      parts.push(`${[c.unknown.length ? `je n'ai pas reconnu ${c.unknown.length > 1 ? "les références" : "la référence"} ${list(c.unknown)}` : null, c.invalid.length ? `la quantité de ${list(c.invalid)} n'est pas lisible` : null].filter(Boolean).join(" et ").replace(/^./, (x) => x.toUpperCase())} : je vérifie avec votre commercial.`);
    parts.push("Souhaitez-vous que je la valide ? Un simple « OK » suffit.");
  }
  if (!wa) {
    const v = parseVoice(args.voice);
    const body = args.status === "unreadable" ? parts : [args.hello, "", ...parts];
    return [...body, ...signoff(v, "", args.companyName, "email")].filter((x): x is string => x !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  return parts.filter((x): x is string => x !== null).join("\n");
}

/** Traite un Excel reçu dans une conversation (simulation ou webhook). L'appelant a déjà enregistré le message entrant. */
export async function handleClientExcel(db: Db, orgId: string, inboundId: string, file: { filename: string; buffer: Buffer }, opts: { now?: Date } = {}): Promise<ExcelReturnResult> {
  const now = opts.now ?? new Date();
  const today = toIsoDate(now);
  const m = (await db.query<{ conversation_id: string; from_address: string | null; channel: "email" | "whatsapp"; offer_id: string | null; customer_id: string | null; identity: string; salutation: string | null; first_name: string | null; last_name: string | null; customer_name: string | null }>(
    `select m.conversation_id, m.from_address, c.channel, c.offer_id, c.customer_id, c.identity_confidence as identity, ct.salutation, ct.first_name, ct.last_name, coalesce(cu.trade_name, cu.legal_name) as customer_name
     from messages m join conversations c on c.id = m.conversation_id left join contacts ct on ct.id = c.contact_id left join customers cu on cu.id = c.customer_id
     where m.id = $1 and m.organization_id = $2 and m.direction = 'inbound'`, [inboundId, orgId])).rows[0];
  if (!m) throw new Error("Message introuvable.");

  // Pièce jointe conservée (traçabilité), sans être interprétée au-delà des quantités.
  const safeName = file.filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "fichier.xlsx";
  const path = storagePath(orgId, "inbound", inboundId, safeName);
  await putFile(path, file.buffer);
  await db.query(`update messages set attachments = $2 where id = $1`, [inboundId, JSON.stringify([{ filename: safeName, mimeType: XLSX_MIME, storagePath: path }])]);

  const settings = (await db.query<{ brand_voice: unknown; company: string | null; name: string }>(
    `select s.brand_voice, s.brand->>'companyName' as company, o.name from organization_settings s join organizations o on o.id = s.organization_id where s.organization_id = $1`, [orgId])).rows[0];
  const companyName = settings?.company ?? settings?.name ?? "";
  const hello = greeting({ salutation: m.salutation, firstName: m.first_name, lastName: m.last_name });
  const task = async (title: string, notes: string) => {
    if (!m.customer_id) return;
    await db.query(
      `insert into followup_tasks (organization_id, customer_id, conversation_id, offer_id, kind, title, due_at, assigned_user_id, idempotency_key, notes, created_by_agent)
       select $1, $2, $3, $4, 'reply', $5, now() + interval '4 hours', cu.owner_user_id, $6, $7, true from customers cu where cu.id = $2
       on conflict (organization_id, idempotency_key) do nothing`,
      [orgId, m.customer_id, m.conversation_id, m.offer_id, `${title} — ${m.customer_name ?? ""}`, `excel:${inboundId}`, notes]);
  };

  const offer = m.offer_id
    ? (await db.query<{ id: string; status: string; opportunity_id: string | null; number: string }>(`select id, status, opportunity_id, number from offers where id = $1`, [m.offer_id])).rows[0]
    : undefined;
  if (!offer || !["approved", "sent", "negotiation", "pending_approval"].includes(offer.status) || !m.customer_id) {
    await task("Excel reçu à traiter", "Le client a envoyé un fichier Excel sans offre en cours modifiable : à traiter par le commercial.");
    return { status: "not_applicable", summary: "Excel reçu sans offre en cours modifiable : transmis au commercial.", replyMessageId: null, revisedOfferId: null, decision: null, dispatch: null };
  }

  const cfg = await loadAutonomy(db, orgId);
  const reply = async (status: ExcelReturnStatus, text: string, extra: { totalHt?: string; revisedOfferId?: string | null; guardNotes?: string[] } = {}) => {
    const decision = extra.totalHt
      ? decideAutonomy(cfg, { kind: "offer_email", offerTotalHt: extra.totalHt, discountPct: 0, guardNotes: extra.guardNotes ?? [], identityVerified: m.identity === "verified" })
      : decideAutonomy(cfg, { kind: "reply", intent: "question", objection: null, escalate: status === "empty", discountPct: null, answered: 1, unanswered: 0, guardNotes: [], identityVerified: m.identity === "verified", injectionSuspected: false });
    const automatic = decision.mode === "auto";
    const id = (await db.query<{ id: string }>(
      `insert into messages (organization_id, conversation_id, direction, channel, to_address, subject, body, status, ai_generated, ai_analysis)
       values ($1,$2,'outbound',$3,$8,$4,$5,$6,true,$7) returning id`,
      [orgId, m.conversation_id, m.channel, m.channel === "email" ? "RE: Votre sélection" : null, text, automatic ? "approved" : "pending_approval",
        { kind: "excel_return", status, autonomy: decision, attachOffer: status === "revised", revisedOfferId: extra.revisedOfferId ?? null }, m.from_address])).rows[0]!.id;
    if (!automatic)
      await db.query(`insert into approvals (organization_id, subject_type, subject_id, summary, payload, requested_by_agent) values ($1,'message',$2,$3,$4,true)
                      on conflict (organization_id, subject_type, subject_id) where status = 'pending' do nothing`,
        [orgId, id, `Réponse à l'Excel de ${m.customer_name ?? "client"}`, { conversationId: m.conversation_id, reason: decision.reason }]);
    const dispatch = automatic ? await dispatchMessage(db, orgId, id, { type: "agent" }, { autonomous: true, now }) : null;
    return { id, decision, dispatch };
  };

  let parsed: ClientExcel;
  try {
    parsed = await parseClientOfferExcel(file.buffer);
  } catch (e) {
    if (!(e instanceof ClientExcelUnreadable)) throw e;
    const r = await reply("unreadable", excelReplyText({ status: "unreadable", channel: m.channel, hello, companyName, voice: settings?.brand_voice }));
    return { status: "unreadable", summary: `Excel illisible (${e.message}) : LÉA demande le fichier d'origine.`, replyMessageId: r.id, revisedOfferId: null, decision: r.decision, dispatch: r.dispatch };
  }

  // Correspondance : référence puis EAN, d'abord dans l'offre, sinon dans le catalogue de l'organisation.
  const lines = (await db.query<{ product_id: string; reference: string; ean: string | null; name: string; quantity: string }>(
    `select ol.product_id, p.reference, p.ean, p.name, ol.quantity::text from offer_lines ol join products p on p.id = ol.product_id where ol.offer_id = $1`, [offer.id])).rows;
  const refs = [...new Set(parsed.rows.map((r) => r.reference?.toUpperCase()).filter((x): x is string => !!x))];
  const eans = [...new Set(parsed.rows.map((r) => r.ean).filter((x): x is string => !!x))];
  const catalog = (await db.query<{ id: string; reference: string; ean: string | null; name: string }>(
    `select id, reference, ean, name from products where organization_id = $1 and (upper(reference) = any($2::text[]) or ean = any($3::text[]))`, [orgId, refs, eans])).rows;
  const byRef = new Map([...catalog, ...lines.map((l) => ({ id: l.product_id, reference: l.reference, ean: l.ean, name: l.name }))].map((p) => [p.reference.toUpperCase(), p]));
  const byEan = new Map([...catalog, ...lines.map((l) => ({ id: l.product_id, reference: l.reference, ean: l.ean, name: l.name }))].filter((p) => p.ean).map((p) => [p.ean!, p]));
  const wanted = new Map<string, { qty: string | null; name: string }>();
  const unknown: string[] = [];
  for (const r of parsed.rows) {
    const p = (r.reference && byRef.get(r.reference.toUpperCase())) || (r.ean && byEan.get(r.ean)) || null;
    if (!p) { unknown.push(r.reference ?? r.ean ?? `ligne ${r.row}`); continue; }
    const prev = wanted.get(p.id);
    wanted.set(p.id, { name: p.name, qty: prev?.qty && r.quantity ? String(Number(prev.qty) + Number(r.quantity)) : r.quantity ?? prev?.qty ?? null });
  }
  const invalid = parsed.invalid.map((i) => i.reference || `ligne ${i.row}`);
  const current = new Map(lines.map((l) => [l.product_id, l]));
  const removed = lines.filter((l) => { const w = wanted.get(l.product_id); return !w || !w.qty || Number(w.qty) === 0; }).map((l) => l.name);
  const added = [...wanted.entries()].filter(([id, w]) => !current.has(id) && w.qty && Number(w.qty) > 0).map(([, w]) => w.name);
  const items = [...wanted.entries()].filter(([, w]) => w.qty && Number(w.qty) > 0).map(([productId, w]) => ({ productId, suggestedQty: w.qty!, rationale: "Quantité demandée par le client (Excel renvoyé)." }));
  const changed = removed.length > 0 || added.length > 0 || items.some((i) => !current.has(i.productId) || !dec(current.get(i.productId)!.quantity).eq(dec(i.suggestedQty)));
  const problems = [...unknown.map((u) => `Référence non reconnue : ${u}`), ...invalid.map((i) => `Quantité illisible : ${i}`)];
  if (problems.length) await task("Excel client : points à vérifier", problems.join("\n"));

  if (!items.length && !unknown.length && !invalid.length) {
    const r = await reply("empty", excelReplyText({ status: "empty", channel: m.channel, hello, companyName, voice: settings?.brand_voice }));
    await task("Excel renvoyé sans quantité", "Le client a renvoyé l'Excel sans aucune quantité : reprendre contact.");
    return { status: "empty", summary: "Excel renvoyé sans quantité : transmis au commercial.", replyMessageId: r.id, revisedOfferId: null, decision: r.decision, dispatch: r.dispatch };
  }
  if (!changed) {
    const r = await reply("unchanged", excelReplyText({ status: "unchanged", channel: m.channel, hello, companyName, voice: settings?.brand_voice }));
    return { status: "unchanged", summary: "Excel renvoyé sans modification de quantité.", replyMessageId: r.id, revisedOfferId: null, decision: r.decision, dispatch: r.dispatch };
  }

  let created: Awaited<ReturnType<typeof createOfferDraft>>;
  try {
    created = await createOfferDraft(db, orgId, null, {
      customerId: m.customer_id, source: "lea", opportunityId: offer.opportunity_id, today, items,
      arguments: ["Quantités adaptées par le client (Excel renvoyé)."],
      autoApprove: cfg.level !== "supervised" && !cfg.paused ? { reason: "Offre mise à jour avec les quantités du client.", maxTotalHt: cfg.maxOfferHt } : undefined,
    });
  } catch (e) {
    if (!(e instanceof OfferNotBuildable)) throw e;
    await task("Excel client : offre impossible à reconstruire", e.message);
    const r = await reply("empty", excelReplyText({ status: "empty", channel: m.channel, hello, companyName, voice: settings?.brand_voice }));
    return { status: "empty", summary: `Offre impossible à reconstruire (${e.message}) : transmis au commercial.`, replyMessageId: r.id, revisedOfferId: null, decision: r.decision, dispatch: r.dispatch };
  }
  await db.query(`update offers set supersedes_offer_id = $2 where id = $1`, [created.offerId, offer.id]);
  await db.query(`update offers set status = 'superseded' where id = $1`, [offer.id]);
  await db.query(`update conversations set offer_id = $2 where organization_id = $3 and offer_id = $1`, [offer.id, created.offerId, orgId]);
  await generateOfferAssets(db, orgId, null, created.offerId, ["offer_pdf", "offer_excel"]);
  if (created.autoApproved) await autoApproveAssets(db, orgId, created.offerId);
  await audit(db, orgId, { type: "agent" }, "offer.revised_from_client_excel", { type: "offer", id: created.offerId }, { previous: offer.number, lines: created.draft.lines.length, totalHt: created.draft.totalHt });

  const asked = new Map(items.map((i) => [i.productId, i.suggestedQty]));
  const names = new Map([...wanted.entries()].map(([id, w]) => [id, w.name]));
  const change: Change = {
    added, removed, unknown, invalid,
    rounded: created.draft.lines.filter((l) => asked.has(l.productId) && !dec(l.quantity).eq(dec(asked.get(l.productId)!))).map((l) => ({ name: l.description, asked: asked.get(l.productId)!, final: l.quantity })),
    excluded: created.draft.excluded.map((x) => (x.productId ? names.get(x.productId) : null) ?? x.message),
  };
  const r = await reply("revised", excelReplyText({ status: "revised", channel: m.channel, hello, lineCount: created.draft.lines.length, totalHt: created.draft.totalHt, change, companyName, voice: settings?.brand_voice }),
    { totalHt: created.draft.totalHt, revisedOfferId: created.offerId, guardNotes: created.autoApproved ? [] : ["Offre mise à jour à valider avant envoi."] });
  return {
    status: "revised", replyMessageId: r.id, revisedOfferId: created.offerId, decision: r.decision, dispatch: r.dispatch,
    summary: `Excel du client lu : ${created.draft.lines.length} ligne(s), ${formatMoney(created.draft.totalHt)} HT${problems.length ? `, ${problems.length} point(s) transmis au commercial` : ""}.`,
  };
}
