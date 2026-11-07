/**
 * Compte rendu quotidien de LÉA (V4, §10-11) : « Voici ce que LÉA a préparé aujourd'hui pour développer votre chiffre d'affaires. »
 * Construit à partir des données réelles ; enregistré une fois par jour (daily_briefs, idempotent : ré-exécuter met à jour la même ligne).
 */
import type { Db } from "@/lib/database/client";
import { dec, D } from "@/lib/money";
import { loadOrgObjectives } from "@/features/targets/repo";
import { getLeaPerformance } from "./performance";

type Item = { customerId: string; customer: string; detail: string; valueHt: string | null; href: string };
export type DailyBrief = {
  date: string;
  objectives: { annualTargetHt: string | null; monthTargetHt: string | null; monthTargetSource?: string | null; realizedYtdHt: string; realizedMonthHt: string; expectedToDateHt: string | null; gapToDateHt: string | null; attainmentToDatePct: number | null; forecastHt: string | null; status: string; explicit: boolean; customersWithTarget: number };
  behind: { total: number; items: Item[] };
  reorders: { total: number; items: Item[] };
  news: { total: number; items: Item[] };
  dormants: { total: number; items: Item[] };
  meetings: { total: number; items: Item[] };
  offersPrepared: { total: number; pending: number; sent: number; items: Item[] };
  decisions: { total: number; items: { id: string; summary: string; href: string }[] };
  attributableHt: string;
  generatedAt: string;
  source: "autopilot" | "live";
};

async function opps(db: Db, orgId: string, type: string, limit = 5) {
  const total = (await db.query<{ n: number }>(`select count(*)::int n from opportunities where organization_id = $1 and status in ('open','in_progress') and type = $2::opportunity_type`, [orgId, type])).rows[0]!.n;
  const items = (await db.query<{ customer_id: string; customer: string; title: string; estimated_value_ht: string | null; details: { gapPct?: number; progress?: { gapPct?: number } } }>(
    `select o.customer_id, coalesce(c.trade_name, c.legal_name) as customer, o.title, o.estimated_value_ht, o.details
     from opportunities o join customers c on c.id = o.customer_id
     where o.organization_id = $1 and o.status in ('open','in_progress') and o.type = $2::opportunity_type
     order by o.priority desc, o.estimated_value_ht desc nulls last limit $3`, [orgId, type, limit])).rows;
  return { total, items: items.map<Item>((o) => ({ customerId: o.customer_id, customer: o.customer, detail: o.title, valueHt: o.estimated_value_ht, href: `/clients/${o.customer_id}` })) };
}

export async function buildDailyBrief(db: Db, orgId: string, today: string, source: DailyBrief["source"] = "live"): Promise<DailyBrief> {
  const obj = await loadOrgObjectives(db, orgId, today);
  const s = obj.company.summary;
  const offers = (await db.query<{ id: string; number: string; status: string; total_ht: string; customer_id: string; customer: string }>(
    `select o.id, o.number, o.status, o.total_ht, o.customer_id, coalesce(c.trade_name, c.legal_name) as customer from offers o join customers c on c.id = o.customer_id
     where o.organization_id = $1 and o.created_by_agent and o.created_at >= $2::date and o.status <> 'superseded' order by o.total_ht desc`, [orgId, today])).rows;
  const approvals = (await db.query<{ id: string; summary: string; subject_type: string; subject_id: string }>(
    `select id, summary, subject_type, subject_id from approvals where organization_id = $1 and status = 'pending' order by created_at desc limit 8`, [orgId])).rows;
  const approvalsTotal = (await db.query<{ n: number }>(`select count(*)::int n from approvals where organization_id = $1 and status = 'pending'`, [orgId])).rows[0]!.n;
  const meetingTasks = (await db.query<{ n: number }>(`select count(*)::int n from followup_tasks where organization_id = $1 and kind = 'meeting' and status = 'pending'`, [orgId])).rows[0]!.n;
  const appointments = await opps(db, orgId, "appointment");
  const perf = await getLeaPerformance(db, orgId, 90);
  return {
    date: today,
    objectives: { ...s, explicit: obj.company.explicit, customersWithTarget: obj.company.customersWithTarget },
    behind: await opps(db, orgId, "target_gap"),
    reorders: await opps(db, orgId, "reorder"),
    news: await opps(db, orgId, "new_product"),
    dormants: await opps(db, orgId, "dormant_customer"),
    meetings: { total: appointments.total + meetingTasks, items: appointments.items },
    offersPrepared: {
      total: offers.length, pending: offers.filter((o) => o.status === "pending_approval").length, sent: offers.filter((o) => ["sent", "negotiation", "accepted"].includes(o.status)).length,
      items: offers.slice(0, 5).map((o) => ({ customerId: o.customer_id, customer: o.customer, detail: `Offre ${o.number}`, valueHt: o.total_ht, href: `/offres/${o.id}` })),
    },
    decisions: { total: approvalsTotal, items: approvals.map((a) => ({ id: a.id, summary: a.summary, href: a.subject_type === "offer" ? `/offres/${a.subject_id}` : "/actions" })) },
    attributableHt: perf.reduce((a, m) => a.plus(dec(m.invoicedHt)), new D(0)).toFixed(2),
    generatedAt: new Date().toISOString(),
    source,
  };
}

/** Enregistre (ou met à jour) le compte rendu du jour : une seule ligne par organisation et par date. */
export async function saveDailyBrief(db: Db, orgId: string, today: string, runReport: unknown) {
  const brief = await buildDailyBrief(db, orgId, today, "autopilot");
  await db.query(
    `insert into daily_briefs (organization_id, brief_date, payload, run_report) values ($1,$2,$3,$4)
     on conflict (organization_id, brief_date) do update set payload = excluded.payload, run_report = excluded.run_report, updated_at = now()`,
    [orgId, today, brief, runReport ?? {}]);
  return brief;
}

export async function loadDailyBrief(db: Db, orgId: string, today: string): Promise<DailyBrief> {
  const row = (await db.query<{ payload: DailyBrief }>(`select payload from daily_briefs where organization_id = $1 and brief_date = $2`, [orgId, today])).rows[0];
  return row?.payload ?? buildDailyBrief(db, orgId, today, "live");
}
