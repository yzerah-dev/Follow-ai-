/**
 * Retard sur objectif : analyse des causes possibles (V4, §2). Uniquement des faits issus des factures (confirmés)
 * ou des estimations explicitement étiquetées ; aucune cause inventée.
 */
import type { Db } from "@/lib/database/client";
import { dec, formatMoney } from "@/lib/money";
import { daysBetween } from "@/lib/utils";

export type GapCause = { kind: "category_decline" | "stopped_references" | "reorders_due" | "no_recent_meeting" | "new_products"; text: string; certainty: "confirmé" | "estimation" };

export async function analyzeTargetGap(db: Db, orgId: string, customerId: string, today: string): Promise<{ causes: GapCause[]; meetingNeeded: boolean }> {
  const year = Number(today.slice(0, 4));
  const mmdd = today.slice(5);
  // 1. Catégories en recul à date vs la même période N-1 (factures : confirmé)
  const cats = (await db.query<{ category: string; cur: string; prev: string }>(
    `select coalesce(p.category, 'Sans catégorie') as category,
            sum(case when i.invoice_date >= make_date($3,1,1) and i.invoice_date <= $4::date then l.line_total_ht else 0 end)::text as cur,
            sum(case when i.invoice_date >= make_date($3-1,1,1) and i.invoice_date <= ($3-1 || '-' || $5)::date then l.line_total_ht else 0 end)::text as prev
     from invoices i join invoice_lines l on l.invoice_id = i.id and l.organization_id = i.organization_id left join products p on p.id = l.product_id
     where i.organization_id = $1 and i.customer_id = $2 and i.status = 'issued' and i.doc_type = 'invoice' and i.invoice_date >= make_date($3-1,1,1)
     group by 1`, [orgId, customerId, year, today, mmdd === "02-29" ? "02-28" : mmdd])).rows;
  const declines = cats.map((c) => ({ ...c, delta: dec(c.cur).minus(dec(c.prev)) })).filter((c) => c.delta.lt(0)).sort((a, b) => a.delta.comparedTo(b.delta)).slice(0, 3);
  const causes: GapCause[] = declines.map((c) => ({ kind: "category_decline", certainty: "confirmé",
    text: `${c.category} : ${formatMoney(c.delta.toFixed(2), "EUR", { compact: true })} vs N-1 à date (${formatMoney(c.cur, "EUR", { compact: true })} au lieu de ${formatMoney(c.prev, "EUR", { compact: true })}).` }));
  // 2. Références habituelles abandonnées : achetées ≥ 3 fois l'an dernier, plus depuis plus de 2 cycles
  const stopped = (await db.query<{ name: string; last: string; orders: number; span: number }>(
    `select p.name, max(i.invoice_date)::text as last, count(distinct i.id)::int as orders, (max(i.invoice_date) - min(i.invoice_date))::int as span
     from invoices i join invoice_lines l on l.invoice_id = i.id and l.organization_id = i.organization_id join products p on p.id = l.product_id
     where i.organization_id = $1 and i.customer_id = $2 and i.status = 'issued' and i.doc_type = 'invoice' and i.invoice_date > $3::date - 730
     group by p.id, p.name having count(distinct i.id) >= 3`, [orgId, customerId, today])).rows
    .filter((r) => r.orders > 1 && daysBetween(r.last, today) > 2 * (r.span / (r.orders - 1)));
  if (stopped.length) causes.push({ kind: "stopped_references", certainty: "confirmé",
    text: `${stopped.length} référence(s) habituelle(s) non recommandée(s) depuis plus de 2 cycles${stopped.length ? ` (${stopped.slice(0, 5).map((s) => s.name).join(", ")}${stopped.length > 5 ? "…" : ""})` : ""}.` });
  // 3. Rendez-vous
  const lastMeeting = (await db.query<{ d: string | null }>(`select max(starts_at)::date::text as d from appointments where customer_id = $1 and status = 'done'`, [customerId])).rows[0]?.d ?? null;
  const meetingNeeded = !lastMeeting || daysBetween(lastMeeting, today) > 60;
  if (meetingNeeded) causes.push({ kind: "no_recent_meeting", certainty: "confirmé", text: lastMeeting ? `Dernier rendez-vous il y a ${daysBetween(lastMeeting, today)} jours.` : "Aucun rendez-vous enregistré avec ce client." });
  return { causes, meetingNeeded };
}
