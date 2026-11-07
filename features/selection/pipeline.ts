/**
 * Moteur de sélection pour grands catalogues (V3) — 100 % déterministe, calculé côté PostgreSQL + logique pure.
 *
 *  1. Index produits (attributs, colisage, disponibilité, tarifs client, médias)       → requêtes indexées
 *  2-3. Historique de factures du client et fréquences d'achat                          → agrégats SQL
 *  4. Réassorts probables / références permanentes (couverture, cycles)               → features/analytics/coverage.ts
 *  5. Nouveautés pertinentes (catégories travaillées par le client)
 *  6. Produits complémentaires (co-achats sur l'organisation, à partir des références du client)
 *  7. Retours en stock
 *  8. Vérification des tarifs et disponibilités (prix inconnu ou rupture sans date → exclu, avec motif)
 *  9. Classement (potentiel × urgence × confiance)
 * 10. Offre complète, une ligne par produit (aucun doublon), dans la limite du budget et du nombre de lignes.
 *
 * Rien n'est envoyé au modèle de langage ici : seul un résumé (catégories, priorités) lui est transmis ensuite.
 */
import type { Db } from "@/lib/database/client";
import { dec, D, type Dec } from "@/lib/money";
import { daysBetween } from "@/lib/utils";
import { computeCoverage, type Confidence, type CoverageRow } from "@/features/analytics/coverage";
import { resolvePrice, type PriceRow } from "@/features/offers/pricing";
import { roundToCase } from "@/features/offers/builder";

export type RecommendationType = "reorder" | "permanent" | "back_in_stock" | "complementary" | "new_product";
export const RECOMMENDATION_LABEL: Record<RecommendationType | "manual", string> = {
  reorder: "Réassort",
  permanent: "Permanent",
  back_in_stock: "Retour en stock",
  complementary: "Complémentaire",
  new_product: "Nouveauté",
  manual: "Ajout manuel",
};

export type SelectionOptions = {
  maxLines?: number; // défaut 200 ; aucune limite arbitraire à 5 ou 10 produits
  budgetHt?: string | null;
  categories?: string[] | null; // proposition limitée à certaines catégories
  newProductsMax?: number; // plusieurs dizaines de nouveautés possibles
  complementaryMax?: number;
  include?: Partial<Record<RecommendationType, boolean>>;
  lookaheadDays?: number;
};

export type SelectionLine = {
  productId: string;
  reference: string;
  ean: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  type: RecommendationType;
  quantity: string;
  unitPriceHt: string;
  priceSource: string;
  lineTotalHt: string;
  unitsPerCase: number | null;
  availability: string;
  purchaseCount: number;
  lastOrderDate: string | null;
  historyQty: string;
  confidence: Confidence;
  justification: string;
  score: number;
  hasPhoto: boolean;
};

export type Excluded = { productId: string; reference: string; name: string; reason: string };

export type Selection = {
  customerId: string;
  customerName: string;
  lines: SelectionLine[];
  excluded: Excluded[]; // « ne pas recommander », avec motif
  byCategory: { category: string; lines: number; totalHt: string }[];
  byType: Record<RecommendationType, number>;
  totalHt: string;
  truncated: { byBudget: number; byMaxLines: number };
  timingsMs: Record<string, number>;
};

const TYPE_RANK: Record<RecommendationType, number> = { reorder: 0, back_in_stock: 1, permanent: 2, complementary: 3, new_product: 4 };
const CONF_WEIGHT: Record<Confidence, number> = { verified: 1, declared: 0.9, high: 0.85, medium: 0.65, low: 0.45 };

export async function selectForCustomer(db: Db, orgId: string, customerId: string, today: string, opts: SelectionOptions = {}): Promise<Selection> {
  const t: Record<string, number> = {};
  let t0 = Date.now();
  const lap = (k: string) => { t[k] = Date.now() - t0; t0 = Date.now(); };
  const maxLines = Math.min(Math.max(opts.maxLines ?? 200, 1), 2000);
  const include = { reorder: true, permanent: true, back_in_stock: true, complementary: true, new_product: true, ...opts.include };
  const lookahead = opts.lookaheadDays ?? 21;

  const cust = (await db.query<{ name: string }>(`select coalesce(trade_name, legal_name) as name from customers where id = $1 and organization_id = $2`, [customerId, orgId])).rows[0];
  if (!cust) throw new Error("Client introuvable.");

  // 2-3. Historique du client sur 3 ans, agrégé par produit et par date (quelques milliers de lignes au plus)
  const hist = (await db.query<{ product_id: string; d: string; qty: string }>(
    `select l.product_id, i.invoice_date::text as d, sum(case when i.doc_type = 'credit_note' then -l.quantity else l.quantity end)::text as qty
     from invoices i join invoice_lines l on l.invoice_id = i.id and l.organization_id = i.organization_id
     where i.organization_id = $1 and i.customer_id = $2 and i.status = 'issued' and i.invoice_date > ($3::date - 1095) and l.product_id is not null
     group by 1, 2`, [orgId, customerId, today])).rows;
  const purchases = new Map<string, { date: string; qty: string }[]>();
  for (const h of hist) (purchases.get(h.product_id) ?? purchases.set(h.product_id, []).get(h.product_id)!).push({ date: h.d, qty: h.qty });
  const bought = [...purchases.keys()];
  lap("historique");

  // Catégories travaillées (part du CA 12 mois)
  const cats = (await db.query<{ category: string; share: string }>(
    `select p.category, sum(l.line_total_ht) / nullif(sum(sum(l.line_total_ht)) over (), 0) as share
     from invoices i join invoice_lines l on l.invoice_id = i.id and l.organization_id = i.organization_id join products p on p.id = l.product_id
     where i.organization_id = $1 and i.customer_id = $2 and i.status = 'issued' and i.doc_type = 'invoice' and i.invoice_date > ($3::date - 365) and p.category is not null
     group by 1`, [orgId, customerId, today])).rows;
  // Catégories travaillées : ≥ 5 % du CA, et pour les comptes très diversifiés (grands distributeurs) les 8 premières catégories.
  const strongCats = [...new Set([...cats.filter((c) => Number(c.share) >= 0.05), ...[...cats].sort((a, b) => Number(b.share) - Number(a.share)).slice(0, 8)].map((c) => c.category))];
  lap("catégories");

  // 6. Complémentaires : produits co-achetés (mêmes factures) avec les 60 références principales du client, sur 12 mois
  const seeds = [...purchases.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 60).map(([id]) => id);
  const complementary = include.complementary && seeds.length
    ? (await db.query<{ product_id: string; support: number; buyers: number }>(
        `with seed_inv as (
           select distinct l.invoice_id from invoice_lines l join invoices i on i.id = l.invoice_id
           where l.organization_id = $1 and l.product_id = any($2::uuid[]) and i.invoice_date > ($4::date - 365) and i.customer_id <> $3)
         select l.product_id, count(*)::int as support, count(distinct i.customer_id)::int as buyers
         from seed_inv s join invoice_lines l on l.invoice_id = s.invoice_id and l.organization_id = $1 join invoices i on i.id = l.invoice_id
         where l.product_id is not null and not (l.product_id = any($5::uuid[]))
         group by 1 having count(distinct i.customer_id) >= 3 order by support desc limit $6`,
        [orgId, seeds, customerId, today, bought, (opts.complementaryMax ?? 60) * 2])).rows
    : [];
  lap("co-achats");

  // 5. Nouveautés dans les catégories du client ; 7. retours en stock
  const news = include.new_product && strongCats.length
    ? (await db.query<{ id: string }>(
        `select id from products where organization_id = $1 and is_new and status = 'active' and category = any($2::text[]) and availability <> 'out_of_stock'
           and (launched_at is null or launched_at >= $3::date - 120) and not (id = any($4::uuid[]))
         order by launched_at desc nulls last, reference limit $5`, [orgId, strongCats, today, bought, opts.newProductsMax ?? 40])).rows.map((r) => r.id)
    : [];
  const restocked = new Set(include.back_in_stock && bought.length
    ? (await db.query<{ product_id: string }>(
        `select s.product_id from inventory_snapshots s
         where s.organization_id = $1 and s.product_id = any($2::uuid[]) and s.captured_at > ($3::date - interval '45 days')
         group by s.product_id
         having (array_agg(coalesce(s.qty_available, s.qty_on_hand) order by s.captured_at desc))[1] > 0 and bool_or(coalesce(s.qty_available, s.qty_on_hand) <= 0)`,
        [orgId, bought, today])).rows.map((r) => r.product_id)
    : []);
  lap("nouveautés & retours");

  // 1 & 8. Attributs, tarifs, disponibilité, stock et médias des seuls produits candidats
  const candidateIds = [...new Set([...bought, ...complementary.map((c) => c.product_id), ...news])];
  const products = (await db.query<{ id: string; reference: string; ean: string | null; name: string; brand: string | null; category: string | null; units_per_case: number | null; min_order_qty: number | null;
    sale_price_ht: string | null; availability: string; available_from: string | null; status: string; is_new: boolean; qty_available: string | null; has_photo: boolean }>(
    `select p.id, p.reference, p.ean, p.name, p.brand, p.category, p.units_per_case, p.min_order_qty, p.sale_price_ht, p.availability, p.available_from, p.status, p.is_new,
            st.qty_available, exists (select 1 from product_images pi where pi.product_id = p.id and pi.approved) as has_photo
     from products p
     left join lateral (select s.qty_available from inventory_snapshots s where s.product_id = p.id order by s.captured_at desc limit 1) st on true
     where p.organization_id = $1 and p.id = any($2::uuid[])`, [orgId, candidateIds])).rows;
  const prices = (await db.query<{ product_id: string; customer_id: string | null; unit_price_ht: string; min_qty: number; valid_from: string | null; valid_to: string | null }>(
    `select product_id, customer_id, unit_price_ht, min_qty, valid_from, valid_to from product_prices
     where organization_id = $1 and product_id = any($2::uuid[]) and (customer_id is null or customer_id = $3)`, [orgId, candidateIds, customerId])).rows;
  const reports = (await db.query<{ product_id: string; qty_on_hand: string | null; units_sold_per_day: string | null; reported_at: string; source: "customer_message" | "sales_rep" | "sell_out_import" }>(
    `select distinct on (product_id) product_id, qty_on_hand, units_sold_per_day, reported_at::text, source from customer_stock_reports
     where organization_id = $1 and customer_id = $2 and product_id is not null order by product_id, reported_at desc`, [orgId, customerId])).rows;
  lap("tarifs & disponibilités");

  const priceIdx = new Map<string, PriceRow[]>();
  for (const p of prices) (priceIdx.get(p.product_id) ?? priceIdx.set(p.product_id, []).get(p.product_id)!).push({ productId: p.product_id, customerId: p.customer_id, unitPriceHt: p.unit_price_ht, minQty: p.min_qty, validFrom: p.valid_from, validTo: p.valid_to });
  const reportIdx = new Map(reports.map((r) => [r.product_id, r]));
  const compIdx = new Map(complementary.map((c) => [c.product_id, c]));
  const newsSet = new Set(news);
  const excluded: Excluded[] = [];
  const out: SelectionLine[] = [];

  for (const p of products) {
    if (opts.categories?.length && (!p.category || !opts.categories.includes(p.category))) continue;
    const hist = purchases.get(p.id) ?? [];
    let cov: CoverageRow | null = null;
    let type: RecommendationType | null = null;
    let why = "";
    if (hist.length) {
      cov = computeCoverage({
        productId: p.id, reference: p.reference, name: p.name, unitsPerCase: p.units_per_case, minOrderQty: p.min_order_qty, purchases: hist, today,
        report: reportIdx.get(p.id) ? { qtyOnHand: reportIdx.get(p.id)!.qty_on_hand, unitsSoldPerDay: reportIdx.get(p.id)!.units_sold_per_day, reportedAt: reportIdx.get(p.id)!.reported_at, source: reportIdx.get(p.id)!.source } : null,
      });
      const permanent = cov.orders >= 3 && cov.targetDays <= 120 && !cov.slowMover;
      if (restocked.has(p.id) && include.back_in_stock) { type = "back_in_stock"; why = `De nouveau disponible ; acheté ${cov.orders} fois par le client.`; }
      else if (include.reorder && cov.orders >= 2 && !cov.slowMover && cov.coverageDays !== null && cov.coverageDays <= lookahead) { type = "reorder"; why = cov.reason; }
      else if (include.permanent && permanent && cov.recommendedQty !== "0") { type = "permanent"; why = `Référence permanente : ${cov.orders} commandes, cycle d'environ ${cov.targetDays} jours. ${cov.reason}`; }
      else if (cov.slowMover) { excluded.push({ productId: p.id, reference: p.reference, name: p.name, reason: cov.reason }); continue; }
      else continue; // couverture suffisante : rien à proposer maintenant
    } else if (newsSet.has(p.id)) { type = "new_product"; why = `Nouveauté dans une catégorie travaillée par le client (${p.category}).`; }
    else if (compIdx.has(p.id)) { const c = compIdx.get(p.id)!; type = "complementary"; why = `Acheté avec vos références habituelles par ${c.buyers} autres magasins (${c.support} factures sur 12 mois).`; }
    if (!type) continue;

    // 8. Vérifications : statut, disponibilité, prix
    if (p.status !== "active") { excluded.push({ productId: p.id, reference: p.reference, name: p.name, reason: "Référence retirée du catalogue." }); continue; }
    if (p.availability === "out_of_stock" && !p.available_from) { excluded.push({ productId: p.id, reference: p.reference, name: p.name, reason: "En rupture sans date de retour connue." }); continue; }
    const qty = type === "new_product" || type === "complementary"
      ? roundToCase("1", p.units_per_case, p.min_order_qty) // quantité de découverte
      : cov!.recommendedQty && dec(cov!.recommendedQty).gt(0) ? cov!.recommendedQty : roundToCase(dec(cov!.historicalQty).dividedBy(Math.max(cov!.orders, 1)).toFixed(3), p.units_per_case, p.min_order_qty);
    const price = resolvePrice({ id: p.id, salePriceHt: p.sale_price_ht }, customerId, priceIdx.get(p.id) ?? [], today, Number(qty));
    if (!price) { excluded.push({ productId: p.id, reference: p.reference, name: p.name, reason: "Prix inconnu : la référence ne peut pas être proposée." }); continue; }
    const total = dec(qty).times(price.unitPriceHt);
    const confidence: Confidence = cov?.confidence ?? (type === "complementary" ? "medium" : "low");
    // 9. Score : potentiel (log de la valeur) × urgence × confiance ; les retours en stock et réassorts passent devant
    const urgency = cov?.coverageDays !== null && cov?.coverageDays !== undefined ? Math.max(0.2, 1 - cov.coverageDays / 60) : type === "new_product" ? 0.4 : 0.5;
    const score = Number(((Math.log10(1 + total.toNumber()) / 5) * urgency * CONF_WEIGHT[confidence] * (1 - TYPE_RANK[type] * 0.08)).toFixed(5));
    out.push({
      productId: p.id, reference: p.reference, ean: p.ean, name: p.name, brand: p.brand, category: p.category, type, quantity: dec(qty).toFixed(3),
      unitPriceHt: price.unitPriceHt, priceSource: price.source, lineTotalHt: total.toDecimalPlaces(2).toFixed(2), unitsPerCase: p.units_per_case,
      availability: p.availability, purchaseCount: cov?.orders ?? 0, lastOrderDate: cov?.lastPurchase ?? null, historyQty: cov?.historicalQty ?? "0",
      confidence, justification: why, score, hasPhoto: p.has_photo,
    });
  }
  lap("analyse & vérifications");

  // 10. Classement, budget, nombre de lignes ; une ligne par produit (le Map garantit l'absence de doublon)
  const ranked = [...new Map(out.map((l) => [l.productId, l])).values()].sort((a, b) => b.score - a.score || a.reference.localeCompare(b.reference));
  let acc: Dec = new D(0);
  const kept: SelectionLine[] = [];
  let byBudget = 0;
  let byMaxLines = 0;
  const budget = opts.budgetHt ? dec(opts.budgetHt) : null;
  for (const l of ranked) {
    if (kept.length >= maxLines) { byMaxLines++; continue; }
    if (budget && acc.plus(l.lineTotalHt).gt(budget)) { byBudget++; continue; }
    acc = acc.plus(l.lineTotalHt);
    kept.push(l);
  }
  const byCat = new Map<string, { lines: number; total: Dec }>();
  for (const l of kept) {
    const k = l.category ?? "Sans catégorie";
    const v = byCat.get(k) ?? { lines: 0, total: new D(0) };
    byCat.set(k, { lines: v.lines + 1, total: v.total.plus(l.lineTotalHt) });
  }
  const byType = { reorder: 0, permanent: 0, back_in_stock: 0, complementary: 0, new_product: 0 } as Record<RecommendationType, number>;
  for (const l of kept) byType[l.type]++;
  lap("classement");
  return {
    customerId, customerName: cust.name, lines: kept, excluded,
    byCategory: [...byCat.entries()].map(([category, v]) => ({ category, lines: v.lines, totalHt: v.total.toFixed(2) })).sort((a, b) => dec(b.totalHt).comparedTo(dec(a.totalHt))),
    byType, totalHt: acc.toFixed(2), truncated: { byBudget, byMaxLines }, timingsMs: t,
  };
}

/** Âge d'une date en jours (pour l'affichage « dernière commande il y a N jours »). */
export const ageDays = (d: string | null, today: string) => (d ? daysBetween(d, today) : null);
