import type { Db } from "@/lib/database/client";
import { audit, type AuditActor } from "@/lib/security/audit";
import { addDays, toIsoDate } from "@/lib/utils";
import { dec, computeTotals, lineTotal, formatMoney } from "@/lib/money";
import { productHabits } from "@/features/invoices/analytics";
import { loadPolicy } from "@/features/settings/policy-repo";
import { buildOfferDraft, type BuilderItem, type BuilderProduct } from "./builder";
import type { PriceRow } from "./pricing";
import { clampDiscount } from "./policy";

export type OfferActor = { userId: string };

/** Aucune ligne vendable (prix inconnu, rupture sans date…) : ce n'est pas une panne, l'offre n'est simplement pas constructible. */
export class OfferNotBuildable extends Error {}

async function loadBuilderData(db: Db, orgId: string, customerId: string, productIds: string[]) {
  const customer = (await db.query<{ id: string; min_order_amount: string | null; franco_amount: string | null }>(
    `select id, min_order_amount, franco_amount from customers where id = $1 and organization_id = $2`, [customerId, orgId])).rows[0];
  if (!customer) throw new Error("Client introuvable.");
  const products = (await db.query<{ id: string; reference: string; name: string; sale_price_ht: string | null; vat_rate: string; units_per_case: number | null; min_order_qty: number | null; availability: BuilderProduct["availability"]; available_from: string | null; qty_available: string | null }>(
    `select p.id, p.reference, p.name, p.sale_price_ht, p.vat_rate, p.units_per_case, p.min_order_qty, p.availability, p.available_from,
            (select s.qty_available from inventory_snapshots s where s.product_id = p.id order by s.captured_at desc limit 1) as qty_available
     from products p where p.organization_id = $1 and p.id = any($2::uuid[])`, [orgId, productIds])).rows;
  const prices = (await db.query<{ product_id: string; customer_id: string | null; unit_price_ht: string; min_qty: number; valid_from: string | null; valid_to: string | null }>(
    `select product_id, customer_id, unit_price_ht, min_qty, valid_from, valid_to from product_prices
     where organization_id = $1 and product_id = any($2::uuid[]) and (customer_id is null or customer_id = $3)`, [orgId, productIds, customerId])).rows;
  return {
    customer: { id: customer.id, minOrderAmount: customer.min_order_amount, francoAmount: customer.franco_amount },
    products: products.map<BuilderProduct>((p) => ({
      id: p.id, reference: p.reference, name: p.name, salePriceHt: p.sale_price_ht, vatRate: p.vat_rate, unitsPerCase: p.units_per_case,
      minOrderQty: p.min_order_qty, availability: p.availability, availableFrom: p.available_from, qtyAvailable: p.qty_available,
    })),
    prices: prices.map<PriceRow>((p) => ({ productId: p.product_id, customerId: p.customer_id, unitPriceHt: p.unit_price_ht, minQty: p.min_qty, validFrom: p.valid_from, validTo: p.valid_to })),
  };
}

/** Crée une offre brouillon à partir d'items, la soumet à validation. */
export async function createOfferDraft(
  db: Db,
  orgId: string,
  actor: OfferActor | null,
  args: { customerId: string; items: BuilderItem[]; source: "manual" | "opportunity" | "campaign" | "lea"; opportunityId?: string | null; campaignId?: string | null; arguments?: string[]; today?: string; autoApprove?: { reason: string; maxTotalHt?: string | null } },
) {
  const today = args.today ?? toIsoDate(new Date());
  const policy = await loadPolicy(db, orgId);
  const data = await loadBuilderData(db, orgId, args.customerId, args.items.map((i) => i.productId));
  const draft = buildOfferDraft({ ...data, items: args.items, policy, date: today });
  if (!draft.lines.length) throw new OfferNotBuildable(draft.excluded.map((e) => e.message).join(" ") || "Aucune ligne valide.");
  // Plafond d'autonomie : au-delà, l'offre repasse en validation humaine.
  const autoApprove = args.autoApprove && (!args.autoApprove.maxTotalHt || dec(draft.totalHt).lte(dec(args.autoApprove.maxTotalHt))) ? args.autoApprove : undefined;
  const number = (await db.query<{ n: string }>(`select app.next_document_number($1, 'offer', 'OF') as n`, [orgId])).rows[0]!.n;
  const contact = (await db.query<{ contact_id: string }>(
    `select cc.contact_id from customer_contacts cc join contacts ct on ct.id = cc.contact_id
     where cc.customer_id = $1 and cc.can_receive_offers
     order by (ct.email is not null and ct.consent_email) desc, cc.is_primary desc limit 1`, [args.customerId])).rows[0];
  const offer = await db.query<{ id: string }>(
    `insert into offers (organization_id, number, customer_id, contact_id, owner_user_id, offer_date, valid_until, status, source, opportunity_id, campaign_id,
       conditions, subtotal_ht, discount_total_ht, total_ht, total_vat, total_ttc, warnings, arguments, created_by_agent)
     values ($1,$2,$3,$4,$5,$6,$7,$20,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning id`,
    [
      orgId, number, args.customerId, contact?.contact_id ?? null,
      actor?.userId ?? (await db.query<{ owner_user_id: string | null }>(`select owner_user_id from customers where id = $1`, [args.customerId])).rows[0]?.owner_user_id ?? null,
      today, toIsoDate(addDays(today, policy.offerValidityDays)), args.source, args.opportunityId ?? null, args.campaignId ?? null,
      "Prix HT en euros. Offre valable dans la limite des stocks disponibles. Conditions de paiement selon votre compte.",
      draft.subtotalHt, draft.discountTotalHt, draft.totalHt, draft.totalVat, draft.totalTtc,
      JSON.stringify([...draft.warnings, ...draft.excluded]), JSON.stringify(args.arguments ?? []), args.source !== "manual",
      autoApprove ? "approved" : "pending_approval",
    ],
  );
  const offerId = offer.rows[0]!.id;
  for (const l of draft.lines) {
    await db.query(
      `insert into offer_lines (organization_id, offer_id, line_no, product_id, description, quantity, unit_price_ht, price_source, discount_pct, vat_rate, line_total_ht, rationale)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [orgId, offerId, l.lineNo, l.productId, l.description, l.quantity, l.unitPriceHt, l.priceSource, l.discountPct, l.vatRate, l.lineTotalHt, [l.rationale, ...l.notes].filter(Boolean).join(" ") || null],
    );
  }
  if (!autoApprove)
    await db.query(
      `insert into approvals (organization_id, subject_type, subject_id, summary, payload, requested_by_agent, requested_by)
       values ($1,'offer',$2,$3,$4,$5,$6)`,
      [orgId, offerId, `Offre ${number} — ${formatMoney(draft.totalHt)} HT`, { warnings: draft.warnings.length, excluded: draft.excluded.length }, args.source !== "manual", actor?.userId ?? null],
    );
  else
    await db.query(`insert into agent_decisions (organization_id, decision_type, rationale, payload) values ($1,'auto_offer',$2,$3)`, [orgId, autoApprove.reason, { offerId, number }]);
  if (args.opportunityId) await db.query(`update opportunities set status = 'in_progress', offer_id = $2 where id = $1`, [args.opportunityId, offerId]);
  await audit(db, orgId, actor ? { type: "user", userId: actor.userId } : { type: "agent" }, "offer.created", { type: "offer", id: offerId }, { number, source: args.source, totalHt: draft.totalHt });
  return { offerId, number, draft, autoApproved: !!autoApprove };
}

/** Offre depuis une opportunité détectée par LÉA (réassort, dormant, nouveautés…). */
export async function createOfferFromOpportunity(db: Db, orgId: string, actor: OfferActor | null, opportunityId: string, today?: string, autoApprove?: { reason: string; maxTotalHt?: string | null }) {
  const opp = (await db.query<{ id: string; customer_id: string; type: string; product_ids: string[]; details: { items?: { productId: string; avgQty: string }[] }; justification: string; status: string; offer_id: string | null }>(
    `select id, customer_id, type, product_ids, details, justification, status, offer_id from opportunities where id = $1 and organization_id = $2`, [opportunityId, orgId])).rows[0];
  if (!opp) throw new Error("Opportunité introuvable.");
  if (opp.offer_id) return { offerId: opp.offer_id, number: null, draft: null, autoApproved: false, existing: true as const };
  let items: BuilderItem[];
  if (opp.details.items?.length) {
    items = opp.details.items.map((i) => ({ productId: i.productId, suggestedQty: i.avgQty, rationale: "Quantité moyenne habituelle du client." }));
  } else {
    items = await suggestItemsForCustomer(db, opp.customer_id, opp.product_ids, today);
  }
  const res = await createOfferDraft(db, orgId, actor, { customerId: opp.customer_id, items, source: "opportunity", opportunityId, arguments: [opp.justification], today, autoApprove });
  return { ...res, existing: false as const };
}

/** Quantités suggérées : moyenne habituelle si le produit est déjà acheté, sinon le minimum (colisage). */
export async function suggestItemsForCustomer(db: Db, customerId: string, productIds: string[] | null, today = toIsoDate(new Date())): Promise<BuilderItem[]> {
  const inv = (await db.query<{ id: string; invoice_date: string; doc_type: "invoice" | "credit_note"; status: "issued" | "cancelled"; total_ht: string }>(
    `select id, invoice_date, doc_type, status, total_ht from invoices where customer_id = $1`, [customerId])).rows;
  const lines = (await db.query<{ invoice_id: string; product_id: string | null; quantity: string; unit_price_ht: string; line_total_ht: string }>(
    `select l.invoice_id, l.product_id, l.quantity, l.unit_price_ht, l.line_total_ht from invoice_lines l join invoices i on i.id = l.invoice_id where i.customer_id = $1`, [customerId])).rows;
  const habits = productHabits(
    inv.map((i) => ({ id: i.id, date: i.invoice_date, docType: i.doc_type, status: i.status, totalHt: i.total_ht })),
    lines.map((l) => ({ invoiceId: l.invoice_id, productId: l.product_id, quantity: l.quantity, unitPriceHt: l.unit_price_ht, lineTotalHt: l.line_total_ht })),
    today,
  );
  const ids = productIds?.length ? productIds : habits.slice(0, 6).map((h) => h.productId);
  return ids.map((id) => {
    const h = habits.find((x) => x.productId === id);
    return h
      ? { productId: id, suggestedQty: h.avgQtyPerOrder, rationale: `Acheté ${h.orders} fois, quantité moyenne ${Number(h.avgQtyPerOrder).toFixed(0)}.` }
      : { productId: id, suggestedQty: "1", rationale: "Nouvelle référence suggérée : quantité minimale de découverte." };
  });
}

export async function decideOffer(db: Db, orgId: string, userId: string, offerId: string, decision: "approved" | "rejected", note?: string) {
  const offer = (await db.query<{ status: string; number: string }>(`select status, number from offers where id = $1 and organization_id = $2`, [offerId, orgId])).rows[0];
  if (!offer) throw new Error("Offre introuvable.");
  if (offer.status !== "pending_approval" && offer.status !== "draft") throw new Error("Cette offre n'est pas en attente de validation.");
  await db.query(`update approvals set status = $3, decided_by = $4, decided_at = now(), decision_note = $5
                  where organization_id = $1 and subject_type = 'offer' and subject_id = $2 and status = 'pending'`, [orgId, offerId, decision, userId, note ?? null]);
  await db.query(`update offers set status = $2 where id = $1`, [offerId, decision === "approved" ? "approved" : "draft"]);
  await audit(db, orgId, { type: "user", userId }, `offer.${decision}`, { type: "offer", id: offerId }, { number: offer.number });
}

/** Le client accepte : prépare une demande de commande (≠ facture, ≠ encaissement). */
export async function acceptOfferAndPrepareOrder(db: Db, orgId: string, userId: string | null, offerId: string) {
  const offer = (await db.query<{ id: string; number: string; customer_id: string; status: string; opportunity_id: string | null; total_ht: string; total_ttc: string }>(
    `select id, number, customer_id, status, opportunity_id, total_ht, total_ttc from offers where id = $1 and organization_id = $2`, [offerId, orgId])).rows[0];
  if (!offer) throw new Error("Offre introuvable.");
  if (!["sent", "negotiation", "approved", "accepted"].includes(offer.status)) throw new Error("L'offre doit avoir été envoyée pour être acceptée.");
  const existing = (await db.query<{ id: string; number: string }>(`select id, number from order_requests where offer_id = $1`, [offerId])).rows[0];
  if (existing) return existing;
  const lines = (await db.query<{ product_id: string; description: string; quantity: string; unit_price_ht: string; discount_pct: string; vat_rate: string; line_total_ht: string; reference: string }>(
    `select l.product_id, l.description, l.quantity, l.unit_price_ht, l.discount_pct, l.vat_rate, l.line_total_ht, p.reference
     from offer_lines l join products p on p.id = l.product_id where l.offer_id = $1 order by l.line_no`, [offerId])).rows;
  const totals = computeTotals(lines.map((l) => ({ totalHt: l.line_total_ht, vatRate: l.vat_rate })));
  const number = (await db.query<{ n: string }>(`select app.next_document_number($1, 'order', 'CMD') as n`, [orgId])).rows[0]!.n;
  const order = await db.query<{ id: string; number: string }>(
    `insert into order_requests (organization_id, number, offer_id, customer_id, status, lines, total_ht, total_ttc, created_by)
     values ($1,$2,$3,$4,'draft',$5,$6,$7,$8) returning id, number`,
    [orgId, number, offerId, offer.customer_id, JSON.stringify(lines), totals.totalHt.toFixed(2), totals.totalTtc.toFixed(2), userId],
  );
  await db.query(`update offers set status = 'accepted', outcome = 'won', outcome_amount_ht = total_ht where id = $1`, [offerId]);
  if (offer.opportunity_id) await db.query(`update opportunities set status = 'converted' where id = $1`, [offer.opportunity_id]);
  await db.query(`update followup_tasks set status = 'done' where offer_id = $1 and kind = 'order' and status = 'pending'`, [offerId]);
  const actor: AuditActor = userId ? { type: "user", userId } : { type: "agent" };
  await audit(db, orgId, actor, "order_request.created", { type: "order_request", id: order.rows[0]!.id }, { offer: offer.number, totalHt: totals.totalHt.toFixed(2) });
  return order.rows[0]!;
}

export async function markOfferLost(db: Db, orgId: string, userId: string, offerId: string, reason: string) {
  await db.query(`update offers set status = 'rejected', outcome = 'lost' where id = $1 and organization_id = $2`, [offerId, orgId]);
  await db.query(`update opportunities set status = 'dismissed' where offer_id = $1`, [offerId]);
  await audit(db, orgId, { type: "user", userId }, "offer.lost", { type: "offer", id: offerId }, { reason });
}

/**
 * Applique à l'offre la remise effectivement communiquée au client (bornée par la politique).
 * Appelé au moment de l'envoi du message qui annonce la remise : offre, lignes et totaux restent cohérents.
 */
export async function applyOfferDiscount(db: Db, orgId: string, offerId: string, pct: number, actor: AuditActor) {
  const policy = await loadPolicy(db, orgId);
  const p = dec(clampDiscount(policy, pct));
  if (p.lte(0)) return null;
  const lines = (await db.query<{ id: string; quantity: string; unit_price_ht: string; vat_rate: string; discount_pct: string }>(
    `select id, quantity, unit_price_ht, vat_rate, discount_pct from offer_lines where offer_id = $1 and organization_id = $2 order by line_no`, [offerId, orgId])).rows;
  const updated: { totalHt: string; vatRate: string }[] = [];
  let subtotal = dec(0);
  for (const l of lines) {
    const pctLine = dec(l.discount_pct).gt(p) ? dec(l.discount_pct) : p;
    const total = lineTotal(l.quantity, l.unit_price_ht, pctLine.toFixed(2));
    subtotal = subtotal.plus(dec(l.quantity).times(dec(l.unit_price_ht)));
    updated.push({ totalHt: total.toFixed(2), vatRate: l.vat_rate });
    await db.query(`update offer_lines set discount_pct = $2, line_total_ht = $3 where id = $1`, [l.id, pctLine.toFixed(2), total.toFixed(2)]);
  }
  const t = computeTotals(updated);
  const sub = subtotal.toDecimalPlaces(2);
  await db.query(
    `update offers set subtotal_ht = $2, discount_total_ht = $3, total_ht = $4, total_vat = $5, total_ttc = $6,
       warnings = warnings || $7::jsonb where id = $1`,
    [offerId, sub.toFixed(2), sub.minus(t.totalHt).toFixed(2), t.totalHt.toFixed(2), t.totalVat.toFixed(2), t.totalTtc.toFixed(2),
      JSON.stringify([{ code: "discount_granted", message: `Remise de ${p.toFixed(2)} % accordée au client (politique : ${policy.maxAutoDiscountPct} % max). Les documents générés avant cette remise ne la reflètent pas.` }])],
  );
  await audit(db, orgId, actor, "offer.discount_applied", { type: "offer", id: offerId }, { pct: p.toFixed(2), totalHt: t.totalHt.toFixed(2) });
  return { pct: p.toFixed(2), totalHt: t.totalHt.toFixed(2) };
}
