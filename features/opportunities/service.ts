import type { Db } from "@/lib/database/client";
import { coPurchase, type InvoiceLite, type LineLite } from "@/features/invoices/analytics";
import type { PriceRow } from "@/features/offers/pricing";
import { buildCatalogIndex, detectOpportunities, type EngineProduct, type OpportunityCandidate } from "./engine";
import { currentPeriods, type TargetInput } from "@/features/customers/targets";

export type ScanResult = { created: number; updated: number; expired: number; candidates: number; runId: string };

/** Les requêtes d'une même transaction doivent être séquentielles (une seule connexion). */
async function sequential<T extends readonly unknown[]>(thunks: { [K in keyof T]: () => Promise<T[K]> }): Promise<T> {
  const out: unknown[] = [];
  for (const t of thunks) out.push(await t());
  return out as unknown as T;
}

const RECOMPUTED_TYPES = ["reorder", "dormant_customer", "new_product", "cross_sell", "back_in_stock", "campaign", "unclosed_offer", "appointment", "target_gap"];

/**
 * Recalcule les opportunités d'une organisation.
 * Idempotent : la clé de dédoublonnage empêche les doublons ; les opportunités qui ne sont plus
 * justifiées par les données sont expirées (historique conservé).
 */
export async function runOpportunityScan(db: Db, organizationId: string, today: string, triggeredBy: string | null = null): Promise<ScanResult> {
  const t0 = Date.now();
  const trace = (label: string) => { if (process.env.PERF_TRACE) console.log(`[scan] ${label.padEnd(28)} ${((Date.now() - t0) / 1000).toFixed(1)} s`); };
  const run = await db.query<{ id: string }>(
    `insert into agent_runs (organization_id, kind, status, input, provider, triggered_by, started_at)
     values ($1, 'opportunity_scan', 'running', $2, 'deterministic', $3, now()) returning id`,
    [organizationId, { today }, triggeredBy],
  );
  const runId = run.rows[0]!.id;
  try {
    const settings = (
      await db.query<{ dormant_after_days: number; reorder_lookahead_days: number; meeting_interval_days: number; target_alert_pct: string }>(
        `select dormant_after_days, reorder_lookahead_days, meeting_interval_days, target_alert_pct from organization_settings where organization_id = $1`,
        [organizationId],
      )
    ).rows[0] ?? { dormant_after_days: 120, reorder_lookahead_days: 21, meeting_interval_days: 180, target_alert_pct: "10" };
    const periods = currentPeriods(today);
    // Mission 3 : retours en stock (dernier relevé disponible après un relevé à zéro dans les 45 derniers jours)
    const restocks = (await db.query<{ product_id: string; restocked_at: string }>(
      `select s.product_id, to_char(max(s.captured_at) at time zone 'UTC', 'YYYY-MM-DD') as restocked_at
       from inventory_snapshots s
       where s.organization_id = $1 and s.captured_at > ($2::date - interval '45 days')
       group by s.product_id
       having (array_agg(coalesce(s.qty_available, s.qty_on_hand) order by s.captured_at desc))[1] > 0
          and bool_or(coalesce(s.qty_available, s.qty_on_hand) <= 0)`, [organizationId, today])).rows.map((r) => ({ productId: r.product_id, restockedAt: r.restocked_at }));
    // Mission 5 : dernier rendez-vous réalisé par client
    const meetings = new Map((await db.query<{ customer_id: string; last: string }>(
      `select customer_id, to_char(max(starts_at) at time zone 'UTC', 'YYYY-MM-DD') as last from appointments where organization_id = $1 and status = 'done' group by customer_id`, [organizationId])).rows.map((r) => [r.customer_id, r.last]));
    // Mission 6 : objectif de la période en cours (annuel prioritaire, sinon mensuel)
    const targets = new Map<string, TargetInput>();
    for (const t of (await db.query<{ customer_id: string; period_type: "year" | "month"; period_start: string; target_ht: string }>(
      `select customer_id, period_type, period_start, target_ht from customer_targets where organization_id = $1 and ((period_type = 'year' and period_start = $2) or (period_type = 'month' and period_start = $3))
       order by (period_type = 'year')`, [organizationId, periods.year, periods.month])).rows)
      targets.set(t.customer_id, { periodType: t.period_type, periodStart: t.period_start, targetHt: t.target_ht });
    // Refus et préférences : aucune sollicitation proactive
    const blocked = new Map((await db.query<{ id: string; reason: string }>(
      `select id, case when do_not_solicit then 'Le client ne souhaite plus être sollicité.' else 'Pause après un refus du client.' end as reason
       from customers where organization_id = $1 and (do_not_solicit or (solicit_paused_until is not null and solicit_paused_until >= $2::date))`, [organizationId, today])).rows.map((r) => [r.id, r.reason]));

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

    trace("données chargées");
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

    trace("co-achats calculés");
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
    const index = buildCatalogIndex(engineProducts, priceRows);
    const offersByCustomer = new Map<string, typeof offers.rows>();
    for (const o of offers.rows) offersByCustomer.set(o.customer_id, [...(offersByCustomer.get(o.customer_id) ?? []), o]);
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
          index,
          settings: { dormantAfterDays: settings.dormant_after_days, reorderLookaheadDays: settings.reorder_lookahead_days },
          coPurchase: assoc,
          activeCampaigns: campaignList,
          openOffers: (offersByCustomer.get(c.id) ?? []).map((o) => ({ id: o.id, number: o.number, status: o.status, sentAt: o.sent_at, totalHt: o.total_ht })),
          restocks,
          lastMeetingAt: meetings.get(c.id) ?? null,
          meetingIntervalDays: settings.meeting_interval_days,
          target: targets.get(c.id) ?? null,
          targetAlertPct: Number(settings.target_alert_pct),
          blockedReason: blocked.get(c.id) ?? null,
        }),
      );
    }

    trace(`détection (${candidates.length})`);
    let created = 0;
    let updated = 0;
    const keys: string[] = [];
    // Écriture par lots (500 opportunités par requête) : quelques dizaines d'allers-retours au lieu de milliers.
    // Une seule opportunité par clé de dédoublonnage (une requête ne peut pas mettre à jour deux fois la même ligne).
    const unique = [...new Map(candidates.map((o) => [o.dedupeKey, o])).values()];
    for (const o of unique) keys.push(o.dedupeKey);
    for (let k = 0; k < unique.length; k += 500) {
      const batch = unique.slice(k, k + 500).map((o) => ({
        customer_id: o.customerId, type: o.type, product_ids: o.productIds, title: o.title, justification: o.justification, confidence: o.confidence,
        estimated_value_ht: o.estimatedValueHt, priority: o.priority, recommended_action: o.recommendedAction, suggested_date: o.suggestedDate,
        data_sources: o.dataSources, details: o.details, dedupe_key: o.dedupeKey, expires_at: o.expiresAt,
      }));
      const r = await db.query<{ inserted: boolean }>(
        `insert into opportunities (organization_id, customer_id, type, product_ids, title, justification, confidence,
           estimated_value_ht, priority, recommended_action, suggested_date, data_sources, details, dedupe_key, expires_at, run_id)
         select $1, x.customer_id, x.type::opportunity_type, x.product_ids, x.title, x.justification, x.confidence, x.estimated_value_ht, x.priority,
                x.recommended_action, x.suggested_date, x.data_sources, x.details, x.dedupe_key, x.expires_at, $3
         from jsonb_to_recordset($2::jsonb) as x(customer_id uuid, type text, product_ids uuid[], title text, justification text, confidence numeric,
           estimated_value_ht numeric, priority int, recommended_action text, suggested_date date, data_sources jsonb, details jsonb, dedupe_key text, expires_at timestamptz)
         on conflict (organization_id, dedupe_key) where status in ('open','in_progress')
         do update set title = excluded.title, justification = excluded.justification, confidence = excluded.confidence,
           estimated_value_ht = excluded.estimated_value_ht, priority = excluded.priority, details = excluded.details,
           suggested_date = excluded.suggested_date, expires_at = excluded.expires_at, run_id = excluded.run_id, computed_at = now()
         returning (xmax = 0) as inserted`,
        [organizationId, JSON.stringify(batch), runId],
      );
      for (const row of r.rows) if (row.inserted) created++; else updated++;
    }

    trace("écriture des opportunités");
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
