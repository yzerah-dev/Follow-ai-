/**
 * Mesure des résultats de LÉA par mission (période glissante).
 * Règles d'attribution (déterministes, documentées dans docs/COMMERCIAL_RULES.md) :
 *  - Commandes : demandes de commande issues d'une offre liée à une opportunité de la mission.
 *  - CA facturé attribuable : lignes de factures du même client, sur les produits de l'offre, émises dans les 45 jours
 *    suivant l'envoi de l'offre, avoirs déduits, plafonné au montant HT de l'offre. Jamais de double comptage entre offres.
 */
import type { Db } from "@/lib/database/client";
import { dec, D, round2 } from "@/lib/money";
import { MISSIONS, MISSION_OF, type Mission } from "@/features/opportunities/missions";

export type MissionResult = {
  mission: Mission;
  detected: number;
  open: number;
  actioned: number;
  offersSent: number;
  won: number;
  conversionPct: number | null; // gagnées / envoyées
  ordersHt: string;
  invoicedHt: string;
};

export const ATTRIBUTION_WINDOW_DAYS = 45;

export async function getLeaPerformance(db: Db, orgId: string, sinceDays = 90): Promise<MissionResult[]> {
  const opps = (await db.query<{ id: string; type: string; status: string; offer_id: string | null; created_at: string }>(
    `select id, type, status, offer_id, created_at from opportunities where organization_id = $1 and created_at > now() - make_interval(days => $2)`, [orgId, sinceDays])).rows;
  const offers = (await db.query<{ id: string; opportunity_id: string | null; customer_id: string; sent_at: string | null; outcome: string | null; total_ht: string; order_ht: string | null }>(
    `select o.id, o.opportunity_id, o.customer_id, o.sent_at, o.outcome, o.total_ht, r.total_ht as order_ht
     from offers o left join order_requests r on r.offer_id = o.id and r.status <> 'cancelled'
     where o.organization_id = $1 and o.opportunity_id is not null and o.created_at > now() - make_interval(days => $2)`, [orgId, sinceDays])).rows;
  // CA facturé attribuable par offre envoyée (plafonné au montant de l'offre)
  const invoiced = new Map((await db.query<{ offer_id: string; amount: string | null }>(
    `select o.id as offer_id,
            least(o.total_ht, sum(case when i.doc_type = 'credit_note' then -l.line_total_ht else l.line_total_ht end)) as amount
     from offers o
     join offer_lines ol on ol.offer_id = o.id
     join invoices i on i.customer_id = o.customer_id and i.status = 'issued'
       and i.invoice_date >= (o.sent_at at time zone 'UTC')::date and i.invoice_date <= (o.sent_at at time zone 'UTC')::date + $3::int
     join invoice_lines l on l.invoice_id = i.id and l.product_id = ol.product_id
     where o.organization_id = $1 and o.sent_at is not null and o.created_at > now() - make_interval(days => $2)
     group by o.id, o.total_ht`, [orgId, sinceDays, ATTRIBUTION_WINDOW_DAYS])).rows.map((r) => [r.offer_id, r.amount]));

  const oppMission = new Map(opps.map((o) => [o.id, MISSION_OF[o.type] ?? "follow_up"]));
  return MISSIONS.map((mission) => {
    const mine = opps.filter((o) => (MISSION_OF[o.type] ?? "follow_up") === mission);
    const myOffers = offers.filter((o) => o.opportunity_id && oppMission.get(o.opportunity_id) === mission);
    const sent = myOffers.filter((o) => o.sent_at);
    const won = myOffers.filter((o) => o.outcome === "won");
    const ordersHt = myOffers.reduce((a, o) => a.plus(dec(o.order_ht ?? 0)), new D(0));
    const invoicedHt = sent.reduce((a, o) => a.plus(D.max(0, dec(invoiced.get(o.id) ?? 0))), new D(0));
    return {
      mission,
      detected: mine.length,
      open: mine.filter((o) => o.status === "open").length,
      actioned: mine.filter((o) => o.status !== "open" && o.status !== "expired").length,
      offersSent: sent.length,
      won: won.length,
      conversionPct: sent.length ? Number(((won.length / sent.length) * 100).toFixed(1)) : null,
      ordersHt: round2(ordersHt).toFixed(2),
      invoicedHt: round2(invoicedHt).toFixed(2),
    };
  });
}
