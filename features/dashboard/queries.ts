import type { Db } from "@/lib/database/client";

export type DashboardOpportunity = {
  id: string;
  customerId: string;
  customerName: string;
  type: string;
  title: string;
  justification: string;
  confidence: string;
  estimatedValueHt: string | null;
  priority: number;
  recommendedAction: string;
  offerId: string | null;
  status: string;
};

/** Toutes les valeurs proviennent de la base : aucune métrique fictive. */
export async function getDashboard(db: Db, orgId: string, today: string) {
  const opps = await db.query<{ id: string; customer_id: string; customer_name: string; type: string; title: string; justification: string; confidence: string; estimated_value_ht: string | null; priority: number; recommended_action: string; offer_id: string | null; status: string }>(
    `select o.id, o.customer_id, coalesce(c.trade_name, c.legal_name) as customer_name, o.type, o.title, o.justification, o.confidence,
            o.estimated_value_ht, o.priority, o.recommended_action, o.offer_id, o.status
     from opportunities o join customers c on c.id = o.customer_id
     where o.organization_id = $1 and o.status in ('open', 'in_progress')
     order by (o.status = 'open') desc, o.priority desc, o.estimated_value_ht desc nulls last limit 8`, [orgId]);
  const stats = (await db.query<{ open_count: number; potential: string | null; reorder_count: number; dormant_count: number }>(
    `select count(*)::int as open_count, sum(estimated_value_ht) filter (where type in ('reorder','unclosed_offer')) as potential,
            count(*) filter (where type = 'reorder')::int as reorder_count, count(*) filter (where type = 'dormant_customer')::int as dormant_count
     from opportunities where organization_id = $1 and status = 'open'`, [orgId])).rows[0]!;
  const approvals = await db.query<{ id: string; subject_type: string; subject_id: string; summary: string; created_at: string; requested_by_agent: boolean; offer_id: string | null; conversation_id: string | null }>(
    `select a.id, a.subject_type, a.subject_id, a.summary, a.created_at, a.requested_by_agent,
            case when a.subject_type = 'offer' then a.subject_id end as offer_id,
            case when a.subject_type in ('message','discount') then (select m.conversation_id from messages m where m.id = a.subject_id) end as conversation_id
     from approvals a where a.organization_id = $1 and a.status = 'pending' order by a.created_at desc limit 8`, [orgId]);
  const approvalCount = (await db.query<{ n: number }>(`select count(*)::int as n from approvals where organization_id = $1 and status = 'pending'`, [orgId])).rows[0]!.n;
  const replies = await db.query<{ id: string; conversation_id: string; from_address: string | null; subject: string | null; received_at: string; customer_name: string | null }>(
    `select m.id, m.conversation_id, m.from_address, m.subject, m.received_at, coalesce(c.trade_name, c.legal_name) as customer_name
     from messages m join conversations cv on cv.id = m.conversation_id left join customers c on c.id = cv.customer_id
     where m.organization_id = $1 and m.direction = 'inbound' and not m.handled order by m.received_at desc limit 6`, [orgId]);
  const tasks = await db.query<{ id: string; title: string; kind: string; due_at: string; customer_id: string | null; customer_name: string | null }>(
    `select t.id, t.title, t.kind, t.due_at, t.customer_id, coalesce(c.trade_name, c.legal_name) as customer_name
     from followup_tasks t left join customers c on c.id = t.customer_id
     where t.organization_id = $1 and t.status = 'pending' and t.due_at <= ($2::date + interval '2 days') order by t.due_at limit 6`, [orgId, today]);
  const appointments = await db.query<{ id: string; kind: string; starts_at: string; customer_name: string; status: string }>(
    `select a.id, a.kind, a.starts_at, coalesce(c.trade_name, c.legal_name) as customer_name, a.status from appointments a join customers c on c.id = a.customer_id
     where a.organization_id = $1 and a.starts_at >= $2::date and a.status in ('proposed','confirmed') order by a.starts_at limit 5`, [orgId, today]);
  const offers = (await db.query<{ prepared: number; sent_month: number; in_negotiation: number }>(
    `select count(*) filter (where status in ('pending_approval','approved'))::int as prepared,
            count(*) filter (where sent_at >= date_trunc('month', $2::date))::int as sent_month,
            count(*) filter (where status = 'negotiation')::int as in_negotiation
     from offers where organization_id = $1`, [orgId, today])).rows[0]!;
  const results = (await db.query<{ won: string | null; orders: number }>(
    `select sum(total_ht) as won, count(*)::int as orders from order_requests
     where organization_id = $1 and created_at >= date_trunc('month', $2::date) and status <> 'cancelled'`, [orgId, today])).rows[0]!;
  const autonomy = (await db.query<{ level: string; paused: boolean; sent_today: number; scheduled: number; escalations: number }>(
    `select s.autonomy_level as level, s.autonomy_paused as paused,
            (select count(*)::int from messages m where m.organization_id = $1 and m.sent_autonomously and m.sent_at >= date_trunc('day', $2::date)) as sent_today,
            (select count(*)::int from messages m where m.organization_id = $1 and m.status = 'approved' and m.scheduled_at is not null) as scheduled,
            (select count(*)::int from followup_tasks t where t.organization_id = $1 and t.kind in ('escalation','meeting') and t.status = 'pending') as escalations
     from organization_settings s where s.organization_id = $1`, [orgId, today])).rows[0] ?? { level: "supervised", paused: false, sent_today: 0, scheduled: 0, escalations: 0 };
  const activity = (await db.query<{ id: string; decision_type: string; rationale: string; created_at: string; customer_id: string | null; customer_name: string | null; message_id: string | null; conversation_id: string | null }>(
    `select d.id, d.decision_type, d.rationale, d.created_at, d.customer_id, coalesce(c.trade_name, c.legal_name) as customer_name,
            d.payload->>'messageId' as message_id, (select m.conversation_id from messages m where m.id = (d.payload->>'messageId')::uuid) as conversation_id
     from agent_decisions d left join customers c on c.id = d.customer_id
     where d.organization_id = $1 and d.decision_type in ('auto_send','auto_reply','auto_followup','escalation','draft_followup')
     order by d.created_at desc limit 8`, [orgId])).rows;
  const hasInvoices = ((await db.query(`select 1 from invoices where organization_id = $1 limit 1`, [orgId])).rowCount ?? 0) > 0;

  return {
    hasInvoices,
    opportunities: opps.rows.map<DashboardOpportunity>((o) => ({
      id: o.id, customerId: o.customer_id, customerName: o.customer_name, type: o.type, title: o.title, justification: o.justification,
      confidence: o.confidence, estimatedValueHt: o.estimated_value_ht, priority: o.priority, recommendedAction: o.recommended_action, offerId: o.offer_id, status: o.status,
    })),
    stats: { openOpportunities: stats.open_count, potentialHt: stats.potential, reorderCount: stats.reorder_count, dormantCount: stats.dormant_count },
    approvals: approvals.rows,
    approvalCount,
    replies: replies.rows,
    tasks: tasks.rows,
    appointments: appointments.rows,
    offers,
    results: { wonAmountHt: results.won ?? "0", orderRequests: results.orders },
    autonomy: { level: autonomy.level, paused: autonomy.paused, sentToday: autonomy.sent_today, scheduled: autonomy.scheduled, escalations: autonomy.escalations },
    activity,
  };
}
