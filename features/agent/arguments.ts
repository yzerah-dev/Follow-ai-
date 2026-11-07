/**
 * Arguments commerciaux FACTUELS d'une offre, calculés à partir des données de l'organisation.
 * LÉA ne peut avancer « meilleure vente », « les clients en recommandent », « stock limité » ou « offre exceptionnelle »
 * que si ces faits sont vérifiés ici. Aucun autre client n'est jamais nommé : seules des statistiques agrégées sont utilisées.
 */
import type { Db } from "@/lib/database/client";
import { dec } from "@/lib/money";

const MIN_BUYERS = 5; // pas de « % » dans les faits (réservé aux remises, contrôlé par les garde-fous). En dessous, une statistique agrégée n'est pas significative (et pourrait désigner un client)

export async function offerSalesFacts(db: Db, orgId: string, offerId: string, today: string): Promise<string[]> {
  const offer = (await db.query<{ discount_total_ht: string; source: string }>(`select discount_total_ht, source from offers where id = $1 and organization_id = $2`, [offerId, orgId])).rows[0];
  if (!offer) return [];
  // Grands volumes : popularité (acheteurs sur 90 j) agrégée une fois, puis réassort calculé uniquement pour les produits de l'offre.
  const lines = (await db.query<{ product_id: string; name: string; quantity: string; qty_available: string | null; buyers_90: number; rank_pct: string | null; buyers_365: number; repeat_buyers: number }>(
    `with offer_products as (select ol.product_id, ol.quantity, ol.line_total_ht from offer_lines ol where ol.offer_id = $1),
     pop as (
       select l.product_id, count(distinct i.customer_id)::int as buyers_90
       from invoices i join invoice_lines l on l.invoice_id = i.id and l.organization_id = i.organization_id
       where i.organization_id = $2 and i.status = 'issued' and i.doc_type = 'invoice' and i.invoice_date > ($3::date - 90) and l.product_id is not null
       group by 1),
     ranked as (select product_id, buyers_90, percent_rank() over (order by buyers_90 desc) as rank_pct from pop),
     hist as (
       select l.product_id, i.customer_id, count(distinct i.id) as n
       from invoice_lines l join invoices i on i.id = l.invoice_id
       where l.organization_id = $2 and l.product_id in (select product_id from offer_products)
         and i.status = 'issued' and i.doc_type = 'invoice' and i.invoice_date > ($3::date - 365)
       group by 1, 2),
     repeat as (select product_id, count(*)::int as buyers_365, count(*) filter (where n >= 2)::int as repeat_buyers from hist group by 1)
     select op.product_id, p.name, op.quantity,
            (select s.qty_available from inventory_snapshots s where s.product_id = op.product_id order by s.captured_at desc limit 1) as qty_available,
            coalesce(r.buyers_90, 0) as buyers_90, r.rank_pct, coalesce(rp.buyers_365, 0) as buyers_365, coalesce(rp.repeat_buyers, 0) as repeat_buyers
     from offer_products op join products p on p.id = op.product_id
     left join ranked r on r.product_id = op.product_id left join repeat rp on rp.product_id = op.product_id
     order by op.line_total_ht desc nulls last`,
    [offerId, orgId, today])).rows;

  const facts: string[] = [];
  if (dec(offer.discount_total_ht).gt(0)) facts.push("Les conditions de cette offre sont exceptionnelles : une remise est déjà incluse.");
  const best = lines.find((l) => l.buyers_90 >= MIN_BUYERS && l.rank_pct !== null && Number(l.rank_pct) <= 0.1);
  if (best) facts.push(`« ${best.name} » fait partie de nos meilleures ventes du moment.`);
  const repeat = lines
    .filter((l) => l.buyers_365 >= MIN_BUYERS && l.repeat_buyers / l.buyers_365 >= 0.6)
    .sort((a, b) => b.repeat_buyers / b.buyers_365 - a.repeat_buyers / a.buyers_365)[0];
  if (repeat) facts.push(`${Math.round((repeat.repeat_buyers / repeat.buyers_365) * 10)} magasins sur 10 qui référencent « ${repeat.name} » en recommandent régulièrement.`);
  const limited = lines.find((l) => l.qty_available !== null && dec(l.qty_available).gt(0) && dec(l.qty_available).lte(dec(l.quantity).times(3)));
  if (limited) facts.push(`Stock limité sur « ${limited.name} » : ${dec(limited.qty_available!).toFixed(0)} pièces disponibles à ce jour.`);
  return facts;
}
