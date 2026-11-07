/**
 * Négociation par la donnée : applique le playbook (playbook.ts) à une objection reçue sur une offre.
 * Effets possibles (tous tracés) : stock déclaré enregistré, offre révisée créée (l'ancienne devient « remplacée »),
 * supports régénérés (PDF, Excel illustré, analyse de couverture, catalogue si nouveautés), reprise de contact planifiée.
 */
import type { Db } from "@/lib/database/client";
import { dec } from "@/lib/money";
import { audit } from "@/lib/security/audit";
import { loadCustomerCoverage } from "@/features/analytics/coverage-repo";
import { createOfferDraft, OfferNotBuildable } from "@/features/offers/service";
import { generateOfferAssets, autoApproveAssets, type AssetKind } from "@/features/creative-studio/service";
import { runPlaybook, PLAYBOOK_OBJECTIONS, type PlaybookResult, type Alternative } from "./playbook";
import type { ReplyAnalysis } from "./schemas";

export type NegotiationOutcome = {
  result: PlaybookResult;
  revised: { offerId: string; number: string; totalHt: string; approved: boolean; documents: string[] } | null;
  declaredStock: { qty: string; productName: string | null } | null;
};

const num = (s: string | null) => {
  const m = s?.match(/\d+(?:[.,]\d+)?/);
  return m ? m[0].replace(",", ".") : null;
};

export async function negotiate(db: Db, orgId: string, args: {
  offerId: string; customerId: string; conversationId: string; inboundId: string; inboundBody: string; analysis: ReplyAnalysis; today: string; now: Date;
  autoApprove: { reason: string; maxTotalHt: string | null } | null;
}): Promise<NegotiationOutcome | null> {
  const objection = args.analysis.objection;
  if (!objection || !PLAYBOOK_OBJECTIONS.includes(objection)) return null;
  const offer = (await db.query<{ number: string; status: string; opportunity_id: string | null; total_ht: string }>(
    `select number, status, opportunity_id, total_ht from offers where id = $1 and organization_id = $2`, [args.offerId, orgId])).rows[0];
  if (!offer || !["approved", "sent", "negotiation"].includes(offer.status)) return null;
  const lines = (await db.query<{ product_id: string; description: string; quantity: string; unit_price_ht: string; name: string; reference: string }>(
    `select l.product_id, l.description, l.quantity, l.unit_price_ht, p.name, p.reference from offer_lines l join products p on p.id = l.product_id where l.offer_id = $1 order by l.line_no`, [args.offerId])).rows;
  if (!lines.length) return null;

  // 1. Stock déclaré par le client (« il m'en reste 40 ») : enregistré comme DÉCLARÉ, jamais comme vérifié.
  let declaredStock: NegotiationOutcome["declaredStock"] = null;
  const declaredQty = objection === "stock_available" ? num(args.analysis.requestedQuantity) : null;
  if (declaredQty) {
    const body = args.inboundBody.toLowerCase();
    const target = lines.length === 1 ? lines[0]! : lines.find((l) => body.includes(l.name.toLowerCase()) || body.includes(l.description.toLowerCase())) ?? null;
    await db.query(
      `insert into customer_stock_reports (organization_id, customer_id, product_id, qty_on_hand, source, message_id, note, reported_at) values ($1,$2,$3,$4,'customer_message',$5,$6,$7)`,
      [orgId, args.customerId, target?.product_id ?? null, declaredQty, args.inboundId, args.inboundBody.slice(0, 300), args.now.toISOString()]);
    declaredStock = { qty: declaredQty, productName: target?.name ?? null };
  }

  // 2. Analyse de couverture des références de l'offre
  const cov = await loadCustomerCoverage(db, orgId, args.customerId, args.today, { productIds: lines.map((l) => l.product_id) });
  // Désignation de l'offre (avec variante) : évite de confondre deux produits de même nom.
  const names = lines.map((l) => l.description || l.name);
  const label = new Map(lines.map((l, k) => [l.product_id, names.filter((n) => n === names[k]).length > 1 ? `${names[k]} (réf. ${l.reference})` : names[k]!]));
  const coverage = new Map(cov.rows.map((r) => [r.productId, { ...r, name: label.get(r.productId) ?? r.name }]));

  // 3. Nombre de révisions déjà faites (chaîne d'offres remplacées)
  const prior = (await db.query<{ n: number }>(
    `with recursive chain as (select id, supersedes_offer_id from offers where id = $1
       union all select o.id, o.supersedes_offer_id from offers o join chain c on o.id = c.supersedes_offer_id)
     select (count(*) - 1)::int as n from chain`, [args.offerId])).rows[0]!.n;

  // 4. Alternatives (« ça ne se vend pas ») : compléments / nouveautés proposés par les missions, prix connu uniquement
  const alternatives: Alternative[] = objection === "not_selling"
    ? (await db.query<{ id: string; name: string; sale_price_ht: string; units_per_case: number | null; min_order_qty: number | null; type: string }>(
        `select distinct on (p.id) p.id, p.name, p.sale_price_ht, p.units_per_case, p.min_order_qty, o.type
         from opportunities o join products p on p.id = any(o.product_ids)
         where o.organization_id = $1 and o.customer_id = $2 and o.status in ('open','in_progress') and o.type in ('cross_sell','back_in_stock','new_product')
           and p.sale_price_ht is not null and p.availability in ('in_stock','low_stock') and not (p.id = any($3::uuid[]))
         order by p.id, o.priority desc limit 4`, [orgId, args.customerId, lines.map((l) => l.product_id)])).rows.map((p) => ({
        productId: p.id, name: p.name, unitPriceHt: p.sale_price_ht, minQty: String(p.min_order_qty ?? p.units_per_case ?? 1),
        reason: p.type === "new_product" ? "Nouveauté adaptée à votre assortiment (quantité de découverte)." : "Souvent achetée par les magasins qui travaillent vos références (quantité de découverte).",
      }))
    : [];

  const budget = (objection === "budget" || objection === "too_expensive") && (/budget/i.test(args.inboundBody) || dec(num(args.analysis.targetPrice) ?? 0).gte(100)) ? num(args.analysis.targetPrice) : null;
  const result = runPlaybook({
    objection, coverage, budgetHt: budget, priorRevisions: prior, alternatives, today: args.today,
    lines: lines.map((l) => ({ productId: l.product_id, name: label.get(l.product_id)!, quantity: l.quantity, unitPriceHt: l.unit_price_ht })),
  });
  // Stock déclaré sans référence identifiable : LÉA demande laquelle avant de recalculer (pas de révision à l'aveugle).
  if (declaredStock && !declaredStock.productName && lines.length > 1) {
    Object.assign(result, { strategy: "hold", items: [], removed: [], counterArguments: [], estimatedTotalHt: null, followUpDate: null,
      question: `Pour affiner, de quelle(s) référence(s) vous reste-t-il ${Number(declaredStock.qty)} pièces ? Je recalcule aussitôt la proposition.`,
      rationale: "Stock déclaré sans référence précise : LÉA demande la référence avant de réviser l'offre." });
  }

  let revised: NegotiationOutcome["revised"] = null;
  if (result.strategy === "revise") {
    try {
      const created = await createOfferDraft(db, orgId, null, {
        customerId: args.customerId, source: "lea", opportunityId: offer.opportunity_id, today: args.today,
        items: result.items.map((i) => ({ productId: i.productId, suggestedQty: i.qty, rationale: i.reason })),
        arguments: [result.rationale, ...result.counterArguments].slice(0, 4),
        autoApprove: args.autoApprove ?? undefined,
      });
      // Garde-fou financier : une révision sur objection prix n'est jamais plus chère que l'offre initiale.
      if (objection !== "not_selling" && dec(created.draft.totalHt).gte(dec(offer.total_ht))) {
        await db.query(`update offers set status = 'rejected' where id = $1`, [created.offerId]);
        await db.query(`delete from approvals where subject_type = 'offer' and subject_id = $1 and status = 'pending'`, [created.offerId]);
        result.strategy = "hold";
      } else {
        await db.query(`update offers set supersedes_offer_id = $2 where id = $1`, [created.offerId, args.offerId]);
        await db.query(`update offers set status = 'superseded' where id = $1`, [args.offerId]);
        await db.query(`update conversations set offer_id = $2 where organization_id = $3 and offer_id = $1`, [args.offerId, created.offerId, orgId]);
        const kinds: AssetKind[] = ["offer_pdf", "offer_excel", "coverage_excel", ...(objection === "not_selling" && alternatives.length ? (["catalog"] as AssetKind[]) : [])];
        const assets = await generateOfferAssets(db, orgId, null, created.offerId, kinds);
        if (created.autoApproved) await autoApproveAssets(db, orgId, created.offerId);
        revised = { offerId: created.offerId, number: created.number, totalHt: created.draft.totalHt, approved: created.autoApproved, documents: assets.filter((a) => a.status === "created").map((a) => a.filename) };
        await audit(db, orgId, { type: "agent" }, "offer.revised_after_objection", { type: "offer", id: created.offerId }, { previous: offer.number, objection, totalHt: created.draft.totalHt });
      }
    } catch (e) {
      if (!(e instanceof OfferNotBuildable)) throw e;
      result.strategy = "hold";
    }
  }
  if (result.strategy === "hold" && result.followUpDate) {
    await db.query(
      `insert into followup_tasks (organization_id, customer_id, conversation_id, offer_id, kind, title, due_at, assigned_user_id, idempotency_key, notes, created_by_agent)
       select $1, $2, $3, $4, 'plan', $5, $6::date + time '09:00', cu.owner_user_id, $7, $8, true from customers cu where cu.id = $2
       on conflict (organization_id, idempotency_key) do nothing`,
      [orgId, args.customerId, args.conversationId, args.offerId, `Refaire le point stock — ${cov.customerName}`, result.followUpDate, `stock-review:${args.inboundId}`, result.rationale]);
  }
  return { result, revised, declaredStock };
}
