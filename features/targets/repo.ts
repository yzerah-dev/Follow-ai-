/** Objectifs de CA : chargement (client, portefeuille, entreprise) et enregistrement (humains uniquement, RLS). */
import type { Db } from "@/lib/database/client";
import { dec, D } from "@/lib/money";
import { audit } from "@/lib/security/audit";
import { buildObjectiveTable, splitAnnual, type MonthAmounts, type TargetSource } from "./objectives";

/** Périmètre : un client, un portefeuille, et/ou seulement les clients qui ont un objectif annuel (même périmètre que l'objectif). */
type Scope = { customerId?: string; ownerUserId?: string; withTargetYear?: number };

/** CA net mensuel de l'année et de N-1 (une requête agrégée, rapide même sur des centaines de milliers de lignes). */
export async function monthlyRevenue(db: Db, orgId: string, year: number, scope: Scope = {}): Promise<{ current: MonthAmounts; n1: MonthAmounts }> {
  const rows = (await db.query<{ y: number; m: number; ht: string }>(
    `select extract(year from i.invoice_date)::int as y, extract(month from i.invoice_date)::int as m,
            sum(case when i.doc_type = 'credit_note' then -i.total_ht else i.total_ht end)::text as ht
     from invoices i
     where i.organization_id = $1 and i.status = 'issued' and i.invoice_date >= make_date($2 - 1, 1, 1) and i.invoice_date < make_date($2 + 1, 1, 1)
       and ($3::uuid is null or i.customer_id = $3)
       and ($4::uuid is null or i.customer_id in (select c.id from customers c where c.organization_id = $1 and c.owner_user_id = $4))
       and (not $5 or i.customer_id in (select t.customer_id from customer_targets t where t.organization_id = $1 and t.period_type = 'year' and t.period_start = make_date($2, 1, 1)))
     group by 1, 2`, [orgId, year, scope.customerId ?? null, scope.ownerUserId ?? null, !!scope.withTargetYear])).rows;
  const current = Array.from({ length: 12 }, () => new D(0));
  const n1 = Array.from({ length: 12 }, () => new D(0));
  for (const r of rows) (r.y === year ? current : n1)[r.m - 1] = dec(r.ht);
  return { current, n1 };
}

export async function loadCustomerObjectives(db: Db, orgId: string, customerId: string, today: string, alertPct = 10) {
  const year = Number(today.slice(0, 4));
  const targets = (await db.query<{ period_type: "year" | "month"; period_start: string; target_ht: string; source: TargetSource }>(
    `select period_type, period_start::text, target_ht::text, source from customer_targets
     where organization_id = $1 and customer_id = $2 and period_start >= make_date($3, 1, 1) and period_start < make_date($3 + 1, 1, 1)`, [orgId, customerId, year])).rows;
  const annual = targets.find((t) => t.period_type === "year")?.target_ht ?? null;
  const monthly = new Map(targets.filter((t) => t.period_type === "month").map((t) => [Number(t.period_start.slice(5, 7)), { targetHt: t.target_ht, source: t.source }]));
  const rev = await monthlyRevenue(db, orgId, year, { customerId });
  return buildObjectiveTable({ year, today, annualTargetHt: annual, monthlyTargets: monthly, realized: rev.current, n1: rev.n1, alertPct });
}

/** Objectifs entreprise et portefeuilles : objectif saisi, sinon somme des objectifs annuels des clients du périmètre. */
export async function loadOrgObjectives(db: Db, orgId: string, today: string) {
  const year = Number(today.slice(0, 4));
  const st = (await db.query<{ scope: "company" | "portfolio"; owner_user_id: string | null; period_type: "year" | "month"; period_start: string; target_ht: string; source: TargetSource }>(
    `select scope, owner_user_id, period_type, period_start::text, target_ht::text, source from sales_targets
     where organization_id = $1 and period_start >= make_date($2, 1, 1) and period_start < make_date($2 + 1, 1, 1)`, [orgId, year])).rows;
  const clientSums = (await db.query<{ owner_user_id: string | null; total: string; n: number }>(
    `select c.owner_user_id, sum(t.target_ht)::text as total, count(*)::int as n from customer_targets t join customers c on c.id = t.customer_id
     where t.organization_id = $1 and t.period_type = 'year' and t.period_start = make_date($2, 1, 1) group by c.owner_user_id`, [orgId, year])).rows;
  const companyRow = clientSums.length
    ? { total: clientSums.reduce((a, r) => a.plus(dec(r.total)), new D(0)).toFixed(2), n: clientSums.reduce((a, r) => a + r.n, 0) }
    : null;
  const companyAnnual = st.find((s) => s.scope === "company" && s.period_type === "year")?.target_ht ?? null;
  const companyMonths = new Map(st.filter((s) => s.scope === "company" && s.period_type === "month").map((s) => [Number(s.period_start.slice(5, 7)), { targetHt: s.target_ht, source: s.source }]));
  // Sans objectif d'entreprise saisi : objectif = somme des objectifs clients, réalisé = CA de ces mêmes clients.
  const rev = await monthlyRevenue(db, orgId, year, companyAnnual ? {} : { withTargetYear: year });
  const company = buildObjectiveTable({ year, today, annualTargetHt: companyAnnual ?? companyRow?.total ?? null, monthlyTargets: companyMonths, realized: rev.current, n1: rev.n1 });
  const owners = (await db.query<{ user_id: string; name: string | null }>(`select user_id, display_name as name from organization_members where organization_id = $1 and status = 'active' and role in ('owner','admin','manager','commercial') order by display_name`, [orgId])).rows;
  const portfolios = [];
  for (const o of owners) {
    const explicit = st.find((s) => s.scope === "portfolio" && s.owner_user_id === o.user_id && s.period_type === "year")?.target_ht ?? null;
    const annual = explicit ?? clientSums.find((r) => r.owner_user_id === o.user_id)?.total ?? null;
    if (!annual) continue;
    const r = await monthlyRevenue(db, orgId, year, explicit ? { ownerUserId: o.user_id } : { ownerUserId: o.user_id, withTargetYear: year });
    portfolios.push({ ownerUserId: o.user_id, name: o.name, explicit: st.some((s) => s.scope === "portfolio" && s.owner_user_id === o.user_id), ...buildObjectiveTable({ year, today, annualTargetHt: annual, monthlyTargets: new Map(), realized: r.current, n1: r.n1 }) });
  }
  return { year, company: { ...company, explicit: !!companyAnnual, customersWithTarget: companyRow?.n ?? 0 }, portfolios };
}

/** Répartit l'objectif annuel d'un client sur 12 mois (saisonnalité N-1) sans écraser les mois saisis à la main. */
export async function splitCustomerTarget(db: Db, orgId: string, userId: string, customerId: string, year: number) {
  const annual = (await db.query<{ target_ht: string }>(`select target_ht::text from customer_targets where organization_id = $1 and customer_id = $2 and period_type = 'year' and period_start = make_date($3, 1, 1)`, [orgId, customerId, year])).rows[0];
  if (!annual) throw new Error("Fixez d'abord l'objectif annuel du client.");
  const { n1 } = await monthlyRevenue(db, orgId, year, { customerId });
  const { months, source } = splitAnnual(annual.target_ht, n1);
  for (const [k, v] of months.entries()) {
    if (dec(v).lte(0)) continue;
    await db.query(
      `insert into customer_targets (organization_id, customer_id, period_type, period_start, target_ht, source, created_by) values ($1,$2,'month',make_date($3,$4,1),$5,$6,$7)
       on conflict (organization_id, customer_id, period_type, period_start) do update set target_ht = excluded.target_ht, source = excluded.source where customer_targets.source <> 'manual'`,
      [orgId, customerId, year, k + 1, v, source, userId]);
  }
  await audit(db, orgId, { type: "user", userId }, "target.monthly_split", { type: "customer", id: customerId }, { year, source });
  return { source, months };
}

/** Saisie manuelle d'objectifs mensuels (prioritaires sur la répartition automatique). */
export async function saveCustomerMonths(db: Db, orgId: string, userId: string, customerId: string, year: number, months: (string | null)[]) {
  for (const [k, v] of months.entries()) {
    if (v === null || v === "") continue;
    if (!/^\d+([.,]\d{1,2})?$/.test(v) || dec(v.replace(",", ".")).lte(0)) throw new Error(`Objectif de ${k + 1}/${year} invalide.`);
    await db.query(
      `insert into customer_targets (organization_id, customer_id, period_type, period_start, target_ht, source, created_by) values ($1,$2,'month',make_date($3,$4,1),$5,'manual',$6)
       on conflict (organization_id, customer_id, period_type, period_start) do update set target_ht = excluded.target_ht, source = 'manual'`,
      [orgId, customerId, year, k + 1, v.replace(",", "."), userId]);
  }
  await audit(db, orgId, { type: "user", userId }, "target.monthly_saved", { type: "customer", id: customerId }, { year });
}

export async function saveSalesTarget(db: Db, orgId: string, userId: string, args: { scope: "company" | "portfolio"; ownerUserId: string | null; year: number; targetHt: string }) {
  await db.query(
    `insert into sales_targets (organization_id, scope, owner_user_id, period_type, period_start, target_ht, created_by) values ($1,$2,$3,'year',make_date($4,1,1),$5,$6)
     on conflict (organization_id, scope, coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), period_type, period_start) do update set target_ht = excluded.target_ht`,
    [orgId, args.scope, args.ownerUserId, args.year, args.targetHt, userId]);
  await audit(db, orgId, { type: "user", userId }, "target.sales_saved", undefined, args);
}
