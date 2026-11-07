/**
 * Données de l'accueil (direction artistique « LÉA fait avancer vos ventes »).
 * Toutes les valeurs sont calculées à partir des données réelles de l'organisation ; rien n'est simulé.
 */
import type { Db } from "@/lib/database/client";
import { dec, round2, D } from "@/lib/money";
import { lastMonths } from "@/features/invoices/analytics";
import { MISSION_OF } from "@/features/opportunities/missions";

export type HomePriority = {
  id: string;
  customerId: string;
  customerName: string;
  type: string;
  mission: string;
  action: string; // verbe d'action affiché (Réactiver, Réassort…)
  subtitle: string;
  valueHt: string | null;
  priority: number;
};

const ACTION_BY_MISSION: Record<string, string> = {
  reactivation: "Réactiver",
  permanents: "Réassort",
  complementary: "Compléter",
  new_products: "Nouveautés",
  meetings: "Rendez-vous",
  targets: "Accélérer",
  follow_up: "Relancer",
};

function subtitleFor(o: { type: string; title: string; details: Record<string, unknown> }) {
  const d = o.details;
  switch (o.type) {
    case "dormant_customer":
      return `Client inactif depuis ${d.daysSinceLast ?? "?"} jours`;
    case "appointment":
      return d.reason === "decline" && typeof d.trendPct === "number" ? `CA en baisse (${d.trendPct.toLocaleString("fr-FR")} %)` : "Non rencontré depuis longtemps";
    case "target_gap": {
      const p = d.progress as { gapPct?: number } | undefined;
      return p?.gapPct !== undefined ? `Objectif CA : ${p.gapPct.toLocaleString("fr-FR")} % à date` : "Objectif CA en retard";
    }
    default:
      return o.title;
  }
}

export async function getHomeData(db: Db, orgId: string, today: string) {
  const monthStart = `${today.slice(0, 7)}-01`;
  const prev = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1));
  const prevStart = prev.toISOString().slice(0, 10);
  const day = Number(today.slice(8, 10));
  const prevSameDay = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), Math.min(day, new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 0)).getUTCDate()))).toISOString().slice(0, 10);

  // CA facturé net du mois à date vs même période du mois précédent
  const ca = (await db.query<{ cur: string | null; prev: string | null }>(
    `select sum(case when invoice_date >= $2 and invoice_date <= $3 then sign_ht end) as cur,
            sum(case when invoice_date >= $4 and invoice_date <= $5 then sign_ht end) as prev
     from (select invoice_date, case when doc_type = 'credit_note' then -total_ht else total_ht end as sign_ht from invoices where organization_id = $1 and status = 'issued') x`,
    [orgId, monthStart, today, prevStart, prevSameDay])).rows[0]!;
  const caMonth = round2(ca.cur ?? 0).toFixed(2);
  const caPct = ca.prev && dec(ca.prev).gt(0) ? Number(dec(caMonth).minus(dec(ca.prev)).dividedBy(dec(ca.prev)).times(100).toFixed(1)) : null;

  // Objectifs annuels : somme des objectifs et CA réalisé à date des clients concernés
  const targets = (await db.query<{ total: string | null; realized: string | null; n: number }>(
    `select sum(t.target_ht) as total, count(*)::int as n,
            (select sum(case when i.doc_type = 'credit_note' then -i.total_ht else i.total_ht end) from invoices i
              where i.organization_id = $1 and i.status = 'issued' and i.invoice_date >= $2 and i.invoice_date <= $3
                and i.customer_id in (select customer_id from customer_targets where organization_id = $1 and period_type = 'year' and period_start = $2)) as realized
     from customer_targets t where t.organization_id = $1 and t.period_type = 'year' and t.period_start = $2`,
    [orgId, `${today.slice(0, 4)}-01-01`, today])).rows[0]!;

  // Clients actifs (facture sur 12 mois) et nouveaux (première facture < 90 j)
  const clients = (await db.query<{ active: number; fresh: number }>(
    `select count(*) filter (where last_inv > ($2::date - 365))::int as active, count(*) filter (where first_inv > ($2::date - 90))::int as fresh
     from (select customer_id, max(invoice_date) as last_inv, min(invoice_date) as first_inv from invoices
           where organization_id = $1 and status = 'issued' and doc_type = 'invoice' group by customer_id) x`, [orgId, today])).rows[0]!;

  // Actions de LÉA à traiter
  const todo = (await db.query<{ approvals: number; tasks: number; replies: number }>(
    `select (select count(*)::int from approvals where organization_id = $1 and status = 'pending') as approvals,
            (select count(*)::int from followup_tasks where organization_id = $1 and status = 'pending' and kind <> 'followup' and due_at <= ($2::date + interval '2 days')) as tasks,
            (select count(*)::int from messages where organization_id = $1 and direction = 'inbound' and not handled) as replies`, [orgId, today])).rows[0]!;

  // Priorités du jour
  const priorities = (await db.query<{ id: string; customer_id: string; customer_name: string; type: string; title: string; details: Record<string, unknown>; estimated_value_ht: string | null; priority: number }>(
    `select o.id, o.customer_id, coalesce(c.trade_name, c.legal_name) as customer_name, o.type, o.title, o.details, o.estimated_value_ht, o.priority
     from opportunities o join customers c on c.id = o.customer_id
     where o.organization_id = $1 and o.status = 'open'
     order by o.priority desc, o.estimated_value_ht desc nulls last limit 5`, [orgId])).rows.map<HomePriority>((o) => {
    const mission = (o.details.mission as string | undefined) ?? MISSION_OF[o.type] ?? "follow_up";
    return { id: o.id, customerId: o.customer_id, customerName: o.customer_name, type: o.type, mission, action: ACTION_BY_MISSION[mission] ?? "Agir", subtitle: subtitleFor(o), valueHt: o.estimated_value_ht, priority: o.priority };
  });

  // Évolution du CA facturé net sur 6 mois
  const months = lastMonths(today, 6);
  const monthly = new Map((await db.query<{ m: string; ht: string }>(
    `select to_char(invoice_date, 'YYYY-MM') as m, sum(case when doc_type = 'credit_note' then -total_ht else total_ht end) as ht
     from invoices where organization_id = $1 and status = 'issued' and invoice_date >= $2::date and invoice_date <= $3::date group by 1`,
    [orgId, `${months[0]}-01`, today])).rows.map((r) => [r.m, r.ht]));
  const evolution = months.map((m) => ({ month: m, ht: round2(monthly.get(m) ?? 0).toFixed(2) }));

  // Répartition du CA (12 mois) : permanents / nouveautés / complémentaires / autres
  const split = (await db.query<{ cat: string; ht: string }>(
    `with lines as (
       select i.id as invoice_id, i.customer_id, l.product_id, p.is_new,
              case when i.doc_type = 'credit_note' then -l.line_total_ht else l.line_total_ht end as ht
       from invoice_lines l join invoices i on i.id = l.invoice_id left join products p on p.id = l.product_id
       where i.organization_id = $1 and i.status = 'issued' and i.invoice_date > ($2::date - 365)),
     perm as (
       select i.customer_id, l.product_id from invoice_lines l join invoices i on i.id = l.invoice_id
       where i.organization_id = $1 and i.status = 'issued' and i.doc_type = 'invoice' and l.product_id is not null
       group by 1, 2 having count(distinct i.id) >= 3),
     tagged as (
       select ln.*, (pm.product_id is not null) as is_perm from lines ln left join perm pm on pm.customer_id = ln.customer_id and pm.product_id = ln.product_id),
     inv_has_perm as (select invoice_id, bool_or(is_perm) as has_perm from tagged group by invoice_id)
     select case when t.is_new then 'news' when t.is_perm then 'permanents' when h.has_perm then 'complementary' else 'others' end as cat, sum(t.ht) as ht
     from tagged t join inv_has_perm h on h.invoice_id = t.invoice_id group by 1`, [orgId, today])).rows;
  const splitTotal = split.reduce((a, r) => a.plus(dec(r.ht)), new D(0));
  const repartition = (["permanents", "news", "complementary", "others"] as const).map((k) => {
    const v = dec(split.find((r) => r.cat === k)?.ht ?? 0);
    return { key: k, ht: round2(v).toFixed(2), pct: splitTotal.gt(0) ? Number(v.dividedBy(splitTotal).times(100).toFixed(1)) : 0 };
  });

  const settings = (await db.query<{ paused: boolean }>(`select autonomy_paused as paused from organization_settings where organization_id = $1`, [orgId])).rows[0];

  return {
    leaPaused: settings?.paused ?? false,
    caMonth,
    caPct,
    target: targets.n ? { totalHt: round2(targets.total ?? 0).toFixed(2), realizedHt: round2(targets.realized ?? 0).toFixed(2), customers: targets.n } : null,
    clients,
    todo: { ...todo, total: todo.approvals + todo.tasks + todo.replies },
    priorities,
    evolution,
    repartition,
    repartitionTotalHt: round2(splitTotal).toFixed(2),
  };
}
