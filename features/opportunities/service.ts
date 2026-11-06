import type { Db } from "@/lib/database/client";
import { coPurchase, type InvoiceLite, type LineLite } from "@/features/invoices/analytics";
import type { PriceRow } from "@/features/offers/pricing";
import { detectOpportunities, type EngineProduct, type OpportunityCandidate } from "./engine";

export type ScanResult = { created: number; updated: number; expired: number; candidates: number; runId: string };

/** Les requêtes d'une même transaction doivent être séquentielles (une seule connexion). */
async function sequential<T extends readonly unknown[]>(thunks: { [K in keyof T]: () => Promise<T[K]> }): Promise<T> {
  const out: unknown[] = [];
  for (const t of thunks) out.push(await t());
  return out as unknown as T;
}

const RECOMPUTED_TYPES = ["reorder", "dormant_customer", "new_product", "cross_sell", "campaign", "unclosed_offer", "appointment"];

/**
 * Recalcule les opportunités d'une organisation.
 * Idempotent : la clé de dédoublonnage empêche les doublons ; les opportunités qui ne sont plus
 * justifiées par les données sont expirées (historique conservé).
 */
export async function runOpportunityScan(db: Db, organizationId: string, today: string, triggeredBy: string | null = null): Promise<ScanResult> {
  const run = await db.query<{ id: string }>(
    `insert into agent_runs (organization_id, kind, status, input, provider, triggered_by, started_at)
     values ($1, 'opportunity_scan', 'running', $2, 'deterministic', $3, now()) returning id`,
    [organizationId, { today }, triggeredBy],
  );
  const runId = run.rows[0]!.id;
  try {
    const settings = (
      await db.query<{ dormant_after_days: number; reorder_lookahead_days: number }>(
        `select dormant_after_days, reorder_lookahead_days from organization_settings where organization_id = $1`,
        [organizationId],
      )
    ).rows[0] ?? { dormant_after_days: 120, reorder_lookahead_days: 21 };

    const [customers, invoices, lines, products, prices, campaigns, offers] = await sequential([
      () => db.query<{ id: string; name: string; status: string }>(
        `select id, coalesce(trade_name, legal_name) as name, status from customers where organization_id = $1`,
        [organizationId],
      ),
      () => db.query<{ id: string; customer_id: string; invoice_date: string; doc_type: "invoice" | "credit_note"; status: "issued" | "cancelled"; total_ht: string }>(
        `select id, customer_id, invoice_date, doc_type, status, total_ht from invoices
         where organization_id = $1 and invoice_date > ($2::date - interval '24 months')`,
        [organizationId, today],
      ),
      () => db.query<{ invoice_id: string; customer_id: string; product_id: string | null; quantity: string; unit_price_ht: string; line_total_ht: string }>(
        `select l.invoice_id, i.customer_id, l.product_id, l.quantity, l.unit_price_ht, l.line_total_ht
         from invoice_lines l join invoices i on i.id = l.invoice_id
         where l.organization_id = $1 and i.invoice_date > ($2::date - interval '24 months')`,
        [organizationId, today],
      ),
      () => db.query<{ id: string; reference: string; name: string; category: string | null; sale_price_ht: string | null; is_new: boolean; launched_at: string | null; availability: string; status: string }>(
        `select id, reference, name, category, sale_price_ht, is_new, launched_at, availability, status from products where organization_id = $1`,
        [organizationId],
      ),
      () => db.query<{ product_id: string; customer_id: string | null; unit_price_ht: string; min_qty: number; valid_from: string | null; valid_to: string | null }>(
        `select product_id, customer_id, unit_price_ht, min_qty, valid_from, valid_to from product_prices where organization_id = $1`,
        [organizationId],
      ),
      () => db.query<{ id: string; name: string; ends_on: string | null; product_ids: string[] }>(
        `select c.id, c.name, c.ends_on, coalesce(array_agg(cp.product_id) filter (where cp.product_id is not null), '{}') as product_ids
         from campaigns c left join campaign_products cp on cp.campaign_id = c.id
         where c.organization_id = $1 and c.status = 'active' and (c.ends_on is null or c.ends_on >= $2::date)
         group by c.id`,
        [organizationId, today],
      ),
      () => db.query<{ id: string; number: string; customer_id: string; status: string; sent_at: string | null; total_ht: string }>(
        `select id, number, customer_id, status, sent_at, total_ht from offers
         where organization_id = $1 and status in ('sent', 'negotiation') and outcome is null`,
        [organizationId],
      ),
    ]);

    const engineProducts: EngineProduct[] = products.rows.map((p) => ({
      id: p.id,
      reference: p.reference,
      name: p.name,
      category: p.category,
      salePriceHt: p.sale_price_ht,
      isNew: p.is_new,
      launchedAt: p.launched_at,
      availability: p.availability,
      status: p.status,
    }));
    const priceRows: PriceRow[] = prices.rows.map((p) => ({
      productId: p.product_id,
      customerId: p.customer_id,
      unitPriceHt: p.unit_price_ht,
      minQty: p.min_qty,
      validFrom: p.valid_from,
      validTo: p.valid_to,
    }));
    const effectiveIds = new Set(invoices.rows.filter((i) => i.status !== "cancelled" && i.doc_type === "invoice").map((i) => i.id));
    const assoc = coPurchase(lines.rows.filter((l) => effectiveIds.has(l.invoice_id)).map((l) => ({ invoiceId: l.invoice_id, productId: l.product_id })));

    const invByCustomer = new Map<string, InvoiceLite[]>();
    for (const i of invoices.rows) {
      const list = invByCustomer.get(i.customer_id) ?? [];
      list.push({ id: i.id, date: i.invoice_date, docType: i.doc_type, status: i.status, totalHt: i.total_ht });
      invByCustomer.set(i.customer_id, list);
    }
    const linesByCustomer = new Map<string, LineLite[]>();
    for (const l of lines.rows) {
      const list = linesByCustomer.get(l.customer_id) ?? [];
      list.push({ invoiceId: l.invoice_id, productId: l.product_id, quantity: l.quantity, unitPriceHt: l.unit_price_ht, lineTotalHt: l.line_total_ht });
      linesByCustomer.set(l.customer_id, list);
    }
    const campaignList = campaigns.rows.map((c) => ({ id: c.id, name: c.name, endsOn: c.ends_on, productIds: c.product_ids }));

    const candidates: OpportunityCandidate[] = [];
    for (const c of customers.rows) {
      candidates.push(
        ...detectOpportunities({
          today,
          customer: c,
          invoices: invByCustomer.get(c.id) ?? [],
          lines: linesByCustomer.get(c.id) ?? [],
          products: engineProducts,
          prices: priceRows,
          settings: { dormantAfterDays: settings.dormant_after_days, reorderLookaheadDays: settings.reorder_lookahead_days },
          coPurchase: assoc,
          activeCampaigns: campaignList,
          openOffers: offers.rows.filter((o) => o.customer_id === c.id).map((o) => ({ id: o.id, number: o.number, status: o.status, sentAt: o.sent_at, totalHt: o.total_ht })),
        }),
      );
    }

    let created = 0;
    let updated = 0;
    const keys: string[] = [];
    for (const o of candidates) {
      keys.push(o.dedupeKey);
      const r = await db.query<{ inserted: boolean }>(
        `insert into opportunities (organization_id, customer_id, type, product_ids, title, justification, confidence,
           estimated_value_ht, priority, recommended_action, suggested_date, data_sources, details, dedupe_key, expires_at, run_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         on conflict (organization_id, dedupe_key) where status in ('open','in_progress')
         do update set title = excluded.title, justification = excluded.justification, confidence = excluded.confidence,
           estimated_value_ht = excluded.estimated_value_ht, priority = excluded.priority, details = excluded.details,
           suggested_date = excluded.suggested_date, expires_at = excluded.expires_at, run_id = excluded.run_id, computed_at = now()
         returning (xmax = 0) as inserted`,
        [
          organizationId, o.customerId, o.type, o.productIds, o.title, o.justification, o.confidence, o.estimatedValueHt,
          o.priority, o.recommendedAction, o.suggestedDate, JSON.stringify(o.dataSources), o.details, o.dedupeKey, o.expiresAt, runId,
        ],
      );
      if (r.rows[0]?.inserted) created++;
      else updated++;
    }

    // Expiration : délai dépassé, ou plus justifiée par les données (uniquement les "open", pas celles en cours de traitement)
    const exp = await db.query(
      `update opportunities set status = 'expired'
       where organization_id = $1 and status = 'open'
         and (expires_at < now() or (type = any($2::opportunity_type[]) and not (dedupe_key = any($3::text[]))))`,
      [organizationId, RECOMPUTED_TYPES, keys],
    );

    const result = { created, updated, expired: exp.rowCount ?? 0, candidates: candidates.length, runId };
    await db.query(`update agent_runs set status = 'succeeded', output = $2, finished_at = now() where id = $1`, [runId, result]);
    await db.query(
      `insert into agent_decisions (organization_id, run_id, decision_type, rationale, payload)
       values ($1, $2, 'opportunity_scan', $3, $4)`,
      [organizationId, runId, `Analyse de ${customers.rowCount} clients : ${candidates.length} opportunités justifiées par les données.`, result],
    );
    return result;
  } catch (e) {
    await db.query(`update agent_runs set status = 'failed', error = $2, finished_at = now() where id = $1`, [runId, String(e)]).catch(() => undefined);
    throw e;
  }
}
