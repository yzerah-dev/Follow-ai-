/**
 * Éditeur d'offres volumineuses (200 à 1 000 lignes).
 * Le client envoie des intentions (quantité, remise, ajout, retrait) ; le SERVEUR re-résout les prix, applique le colisage
 * et la politique de remise, recalcule les totaux et journalise chaque modification (offer_line_changes, ajout seul).
 * Concurrence optimiste : chaque sauvegarde porte la révision lue ; une révision périmée est refusée.
 */
import type { Db } from "@/lib/database/client";
import { dec, lineTotal, computeTotals, round2, D } from "@/lib/money";
import { toIsoDate } from "@/lib/utils";
import { audit } from "@/lib/security/audit";
import { resolvePrice, type PriceRow } from "./pricing";
import { roundToCase } from "./builder";
import { clampDiscount } from "./policy";
import { loadPolicy } from "@/features/settings/policy-repo";

export const EDITABLE_STATUSES = ["draft", "pending_approval", "approved"] as const;
export const MAX_OFFER_LINES = 1000;

export type EditorLine = {
  productId: string;
  lineNo: number;
  reference: string;
  ean: string | null;
  description: string;
  brand: string | null;
  category: string | null;
  imageId: string | null;
  recommendationType: string | null;
  confidence: string | null;
  purchaseCount: number | null;
  lastOrderDate: string | null;
  historyQty: string | null;
  quantity: string;
  unitPriceHt: string;
  priceSource: string;
  discountPct: string;
  lineTotalHt: string;
  unitsPerCase: number | null;
  availability: string;
  rationale: string | null;
};

export type LineChange =
  | { op: "update"; productId: string; quantity?: string; discountPct?: string }
  | { op: "remove"; productId: string }
  | { op: "add"; productId: string; quantity?: string };

export class StaleRevisionError extends Error {
  constructor() { super("L'offre a été modifiée entre-temps : rechargez la page pour récupérer la dernière version."); }
}

export async function loadEditorLines(db: Db, offerId: string): Promise<EditorLine[]> {
  return (await db.query<EditorLine>(
    `select l.product_id as "productId", l.line_no as "lineNo", p.reference, p.ean, l.description, p.brand, p.category,
            (select pi.id from product_images pi where pi.product_id = p.id and pi.approved order by pi.is_primary desc limit 1) as "imageId",
            l.recommendation_type as "recommendationType", l.confidence, l.purchase_count as "purchaseCount", l.last_order_date::text as "lastOrderDate",
            l.history_qty::text as "historyQty", l.quantity::text as quantity, l.unit_price_ht::text as "unitPriceHt", l.price_source as "priceSource",
            l.discount_pct::text as "discountPct", l.line_total_ht::text as "lineTotalHt", p.units_per_case as "unitsPerCase", p.availability::text as availability, l.rationale
     from offer_lines l join products p on p.id = l.product_id where l.offer_id = $1 order by l.line_no`, [offerId])).rows;
}

export async function applyLineChanges(db: Db, orgId: string, userId: string, offerId: string, revision: number, changes: LineChange[]) {
  const offer = (await db.query<{ status: string; revision: number; customer_id: string; offer_date: string }>(
    `select status, revision, customer_id, offer_date::text from offers where id = $1 and organization_id = $2 for update`, [offerId, orgId])).rows[0];
  if (!offer) throw new Error("Offre introuvable.");
  if (!(EDITABLE_STATUSES as readonly string[]).includes(offer.status)) throw new Error("Offre déjà envoyée : elle ne peut plus être modifiée.");
  if (offer.revision !== revision) throw new StaleRevisionError();
  const policy = await loadPolicy(db, orgId);
  const today = toIsoDate(new Date());

  // Dernière intention par produit (une saisie rapide peut produire plusieurs changements sur la même ligne)
  const byProduct = new Map<string, LineChange>();
  for (const c of changes) {
    const prev = byProduct.get(c.productId);
    byProduct.set(c.productId, prev && prev.op === "update" && c.op === "update" ? { ...prev, ...c } : c);
  }
  const ids = [...byProduct.keys()];
  const current = new Map((await db.query<{ product_id: string; quantity: string; discount_pct: string; line_no: number }>(
    `select product_id, quantity::text, discount_pct::text, line_no from offer_lines where offer_id = $1 and product_id = any($2::uuid[])`, [offerId, ids])).rows.map((r) => [r.product_id, r]));
  const products = new Map((await db.query<{ id: string; name: string; sale_price_ht: string | null; vat_rate: string; units_per_case: number | null; min_order_qty: number | null; status: string; availability: string; available_from: string | null }>(
    `select id, name, sale_price_ht, vat_rate::text, units_per_case, min_order_qty, status, availability::text, available_from from products where organization_id = $1 and id = any($2::uuid[])`, [orgId, ids])).rows.map((p) => [p.id, p]));
  const prices = (await db.query<{ product_id: string; customer_id: string | null; unit_price_ht: string; min_qty: number; valid_from: string | null; valid_to: string | null }>(
    `select product_id, customer_id, unit_price_ht, min_qty, valid_from, valid_to from product_prices where organization_id = $1 and product_id = any($2::uuid[]) and (customer_id is null or customer_id = $3)`,
    [orgId, ids, offer.customer_id])).rows;
  const priceIdx = new Map<string, PriceRow[]>();
  for (const p of prices) (priceIdx.get(p.product_id) ?? priceIdx.set(p.product_id, []).get(p.product_id)!).push({ productId: p.product_id, customerId: p.customer_id, unitPriceHt: p.unit_price_ht, minQty: p.min_qty, validFrom: p.valid_from, validTo: p.valid_to });

  const upserts: Record<string, unknown>[] = [];
  const removes: string[] = [];
  const history: Record<string, unknown>[] = [];
  const rejected: { productId: string; reason: string }[] = [];
  let nextLineNo = Number((await db.query<{ n: number }>(`select coalesce(max(line_no), 0)::int as n from offer_lines where offer_id = $1`, [offerId])).rows[0]!.n);
  const count = Number((await db.query<{ n: number }>(`select count(*)::int as n from offer_lines where offer_id = $1`, [offerId])).rows[0]!.n);
  let added = 0;

  for (const [productId, c] of byProduct) {
    const cur = current.get(productId);
    if (c.op === "remove") {
      if (cur) { removes.push(productId); history.push({ product_id: productId, action: "remove", field: null, old_value: cur.quantity, new_value: null }); }
      continue;
    }
    const p = products.get(productId);
    if (!p) { rejected.push({ productId, reason: "Produit introuvable." }); continue; }
    if (c.op === "add" && cur) { rejected.push({ productId, reason: "Produit déjà présent dans l'offre (pas de doublon)." }); continue; }
    if (c.op === "add" && count + added >= MAX_OFFER_LINES) { rejected.push({ productId, reason: `Offre limitée à ${MAX_OFFER_LINES} lignes.` }); continue; }
    if (c.op === "update" && !cur) { rejected.push({ productId, reason: "Ligne absente de l'offre." }); continue; }
    if (p.status !== "active") { rejected.push({ productId, reason: "Référence retirée du catalogue." }); continue; }
    if (c.op === "add" && p.availability === "out_of_stock" && !p.available_from) { rejected.push({ productId, reason: "En rupture sans date de retour : non ajoutée." }); continue; }
    const rawQty = c.quantity ?? (cur ? cur.quantity : "1");
    if (!/^\d+([.,]\d{1,3})?$/.test(rawQty) || dec(rawQty.replace(",", ".")).lte(0)) { rejected.push({ productId, reason: "Quantité invalide." }); continue; }
    const qty = roundToCase(rawQty.replace(",", "."), p.units_per_case, p.min_order_qty);
    const price = resolvePrice({ id: p.id, salePriceHt: p.sale_price_ht }, offer.customer_id, priceIdx.get(p.id) ?? [], today, Number(qty));
    if (!price) { rejected.push({ productId, reason: "Prix inconnu : la ligne ne peut pas être valorisée (aucun prix n'est inventé)." }); continue; }
    const discount = clampDiscount(policy, c.op === "update" && c.discountPct !== undefined ? c.discountPct.replace(",", ".") : cur?.discount_pct ?? "0");
    const lineNo = cur?.line_no ?? ++nextLineNo;
    if (!cur) added++;
    upserts.push({
      product_id: productId, line_no: lineNo, description: p.name, quantity: qty, unit_price_ht: dec(price.unitPriceHt).toFixed(4), price_source: price.source,
      discount_pct: discount, vat_rate: p.vat_rate, line_total_ht: lineTotal(qty, price.unitPriceHt, discount).toFixed(2),
      recommendation_type: cur ? null : "manual",
    });
    if (!cur) history.push({ product_id: productId, action: "add", field: "quantity", old_value: null, new_value: qty });
    else {
      if (dec(cur.quantity).toFixed(3) !== dec(qty).toFixed(3)) history.push({ product_id: productId, action: "update", field: "quantity", old_value: dec(cur.quantity).toFixed(0), new_value: qty });
      if (dec(cur.discount_pct).toFixed(2) !== dec(discount).toFixed(2)) history.push({ product_id: productId, action: "update", field: "discount_pct", old_value: cur.discount_pct, new_value: discount });
    }
  }

  if (removes.length) {
    const del = await db.query(`delete from offer_lines where offer_id = $1 and product_id = any($2::uuid[])`, [offerId, removes]);
    if ((del.rowCount ?? 0) !== removes.length) throw new Error("Suppression non autorisée pour ce rôle.");
  }
  if (upserts.length)
    await db.query(
      `insert into offer_lines (organization_id, offer_id, line_no, product_id, description, quantity, unit_price_ht, price_source, discount_pct, vat_rate, line_total_ht, recommendation_type, rationale)
       select $1, $2, x.line_no, x.product_id, x.description, x.quantity, x.unit_price_ht, x.price_source, x.discount_pct, x.vat_rate, x.line_total_ht, x.recommendation_type,
              case when x.recommendation_type = 'manual' then 'Ajoutée manuellement.' end
       from jsonb_to_recordset($3::jsonb) as x(line_no int, product_id uuid, description text, quantity numeric, unit_price_ht numeric, price_source text, discount_pct numeric, vat_rate numeric, line_total_ht numeric, recommendation_type text)
       on conflict (offer_id, product_id) do update set quantity = excluded.quantity, unit_price_ht = excluded.unit_price_ht, price_source = excluded.price_source,
         discount_pct = excluded.discount_pct, line_total_ht = excluded.line_total_ht`,
      [orgId, offerId, JSON.stringify(upserts)]);

  // Totaux recalculés à partir des lignes en base (source de vérité)
  const lines = (await db.query<{ quantity: string; unit_price_ht: string; line_total_ht: string; vat_rate: string }>(
    `select quantity::text, unit_price_ht::text, line_total_ht::text, vat_rate::text from offer_lines where offer_id = $1`, [offerId])).rows;
  const subtotal = round2(lines.reduce((a, l) => a.plus(dec(l.quantity).times(dec(l.unit_price_ht))), new D(0)));
  const totals = computeTotals(lines.map((l) => ({ totalHt: l.line_total_ht, vatRate: l.vat_rate })));
  const newRevision = offer.revision + 1;
  const changed = history.length > 0;
  await db.query(
    `update offers set subtotal_ht = $2, discount_total_ht = $3, total_ht = $4, total_vat = $5, total_ttc = $6, revision = $7, updated_at = now(),
       status = case when $8 and status = 'approved' then 'pending_approval'::offer_status else status end where id = $1`,
    [offerId, subtotal.toFixed(2), round2(subtotal.minus(totals.totalHt)).toFixed(2), totals.totalHt.toFixed(2), totals.totalVat.toFixed(2), totals.totalTtc.toFixed(2), newRevision, changed]);
  if (changed) {
    await db.query(
      `insert into offer_line_changes (organization_id, offer_id, product_id, action, field, old_value, new_value, revision, changed_by)
       select $1, $2, x.product_id, x.action, x.field, x.old_value, x.new_value, $3, $4 from jsonb_to_recordset($5::jsonb) as x(product_id uuid, action text, field text, old_value text, new_value text)`,
      [orgId, offerId, newRevision, userId, JSON.stringify(history)]);
    // Les supports déjà générés ne correspondent plus à l'offre : ils devront être régénérés.
    await db.query(`update generated_assets set validation_status = 'rejected', validation_report = validation_report || '{"outdated": true}'::jsonb where offer_id = $1 and validation_status <> 'rejected'`, [offerId]);
    // Une offre validée puis modifiée repasse en validation.
    if (offer.status === "approved")
      await db.query(`insert into approvals (organization_id, subject_type, subject_id, summary, payload, requested_by) values ($1,'offer',$2,$3,$4,$5)`,
        [orgId, offerId, `Offre modifiée (${history.length} changement(s)) — nouvelle validation`, { revision: newRevision }, userId]);
    await audit(db, orgId, { type: "user", userId }, "offer.lines_edited", { type: "offer", id: offerId }, { changes: history.length, revision: newRevision });
  }
  return {
    revision: newRevision,
    totals: { subtotalHt: subtotal.toFixed(2), totalHt: totals.totalHt.toFixed(2), totalVat: totals.totalVat.toFixed(2), totalTtc: totals.totalTtc.toFixed(2), lines: lines.length },
    rejected,
    applied: history.length,
    statusReset: changed && offer.status === "approved",
  };
}

export async function searchProductsForOffer(db: Db, orgId: string, offerId: string, q: string) {
  const term = q.trim();
  if (term.length < 2) return [];
  return (await db.query<{ id: string; reference: string; ean: string | null; name: string; category: string | null; availability: string; sale_price_ht: string | null; in_offer: boolean }>(
    `select p.id, p.reference, p.ean, p.name, p.category, p.availability::text, p.sale_price_ht::text,
            exists (select 1 from offer_lines l where l.offer_id = $3 and l.product_id = p.id) as in_offer
     from products p where p.organization_id = $1 and p.status = 'active'
       and (p.reference ilike $2 || '%' or p.ean = $4 or p.name ilike '%' || $2 || '%')
     order by (p.reference ilike $2 || '%') desc, p.reference limit 20`, [orgId, term.replace(/[%_]/g, ""), offerId, term])).rows;
}

export async function loadLineHistory(db: Db, offerId: string, limit = 100) {
  return (await db.query<{ id: number; action: string; field: string | null; old_value: string | null; new_value: string | null; revision: number; created_at: string; reference: string | null; who: string | null }>(
    `select h.id, h.action, h.field, h.old_value, h.new_value, h.revision, h.created_at, p.reference, m.display_name as who
     from offer_line_changes h left join products p on p.id = h.product_id
     left join organization_members m on m.organization_id = h.organization_id and m.user_id = h.changed_by
     where h.offer_id = $1 order by h.id desc limit $2`, [offerId, limit])).rows;
}
