/** Chargement des données de couverture d'un client (RLS : appelé via withUser / withAgent). */
import type { Db } from "@/lib/database/client";
import { computeCoverage, rankCoverage, type CoverageRow, type StockReport } from "./coverage";

export type CustomerCoverage = {
  customerName: string;
  rows: (CoverageRow & { priceHt: string | null })[];
  complementary: string[]; // compléments et retours en stock suggérés par les missions
  news: string[]; // nouveautés pertinentes
};

export async function loadCustomerCoverage(db: Db, orgId: string, customerId: string, today: string, opts: { productIds?: string[] } = {}): Promise<CustomerCoverage> {
  const c = (await db.query<{ name: string }>(`select coalesce(trade_name, legal_name) as name from customers where id = $1 and organization_id = $2`, [customerId, orgId])).rows[0];
  if (!c) throw new Error("Client introuvable.");
  const purchases = (await db.query<{ product_id: string; reference: string; name: string; units_per_case: number | null; min_order_qty: number | null; sale_price_ht: string | null; invoice_date: string; qty: string }>(
    `select p.id as product_id, p.reference, p.name, p.units_per_case, p.min_order_qty, p.sale_price_ht, i.invoice_date::text, sum(l.quantity)::text as qty
     from invoice_lines l join invoices i on i.id = l.invoice_id join products p on p.id = l.product_id
     where i.organization_id = $1 and i.customer_id = $2 and i.status = 'issued' and i.doc_type = 'invoice' and i.invoice_date > ($3::date - 365)
       and ($4::uuid[] is null or p.id = any($4::uuid[]))
     group by 1, 2, 3, 4, 5, 6, 7`, [orgId, customerId, today, opts.productIds ?? null])).rows;
  // Produits demandés mais jamais achetés (ex. nouveautés d'une offre)
  const extra = opts.productIds?.length
    ? (await db.query<{ product_id: string; reference: string; name: string; units_per_case: number | null; min_order_qty: number | null; sale_price_ht: string | null }>(
        `select id as product_id, reference, name, units_per_case, min_order_qty, sale_price_ht from products where organization_id = $1 and id = any($2::uuid[])`, [orgId, opts.productIds])).rows
    : [];
  const reports = (await db.query<{ product_id: string; qty_on_hand: string | null; units_sold_per_day: string | null; reported_at: string; source: StockReport["source"] }>(
    `select distinct on (product_id) product_id, qty_on_hand, units_sold_per_day, reported_at::text, source
     from customer_stock_reports where organization_id = $1 and customer_id = $2 and product_id is not null order by product_id, reported_at desc`, [orgId, customerId])).rows;
  const byProduct = new Map<string, { info: (typeof extra)[number]; purchases: { date: string; qty: string }[] }>();
  for (const e of extra) byProduct.set(e.product_id, { info: e, purchases: [] });
  for (const p of purchases) {
    const x = byProduct.get(p.product_id) ?? { info: p, purchases: [] };
    x.purchases.push({ date: p.invoice_date, qty: p.qty });
    byProduct.set(p.product_id, x);
  }
  const rows = rankCoverage([...byProduct.values()].map(({ info, purchases }) => {
    const r = reports.find((x) => x.product_id === info.product_id);
    return computeCoverage({
      productId: info.product_id, reference: info.reference, name: info.name, unitsPerCase: info.units_per_case, minOrderQty: info.min_order_qty, purchases, today,
      report: r ? { qtyOnHand: r.qty_on_hand, unitsSoldPerDay: r.units_sold_per_day, reportedAt: r.reported_at, source: r.source } : null,
    });
  })).map((r) => ({ ...r, priceHt: byProduct.get(r.productId)!.info.sale_price_ht }));
  const opp = (await db.query<{ type: string; names: string[] }>(
    `select o.type, array_agg(distinct p.name) as names from opportunities o join products p on p.id = any(o.product_ids)
     where o.organization_id = $1 and o.customer_id = $2 and o.status in ('open','in_progress') and o.type in ('cross_sell','back_in_stock','new_product') group by o.type`, [orgId, customerId])).rows;
  return {
    customerName: c.name,
    rows,
    complementary: opp.filter((o) => o.type !== "new_product").flatMap((o) => o.names).slice(0, 6),
    news: opp.filter((o) => o.type === "new_product").flatMap((o) => o.names).slice(0, 6),
  };
}
