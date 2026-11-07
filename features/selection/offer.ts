/** Offre complète construite par le moteur de sélection (1 à plusieurs centaines de lignes, sans doublon). */
import type { Db } from "@/lib/database/client";
import { formatMoney } from "@/lib/money";
import { createOfferDraft, OfferNotBuildable, type OfferActor } from "@/features/offers/service";
import { selectForCustomer, RECOMMENDATION_LABEL, type SelectionOptions, type Selection } from "./pipeline";

export async function createOfferFromSelection(db: Db, orgId: string, actor: OfferActor | null, customerId: string, today: string, opts: SelectionOptions & { autoApprove?: { reason: string; maxTotalHt?: string | null } } = {}) {
  const selection = await selectForCustomer(db, orgId, customerId, today, opts);
  if (!selection.lines.length) throw new OfferNotBuildable("Aucune référence à proposer pour l'instant : couverture suffisante ou données insuffisantes.");
  const summary = summarizeSelection(selection);
  const res = await createOfferDraft(db, orgId, actor, {
    customerId, source: actor ? "manual" : "lea", today, autoApprove: opts.autoApprove,
    items: selection.lines.map((l) => ({
      productId: l.productId, suggestedQty: l.quantity, rationale: l.justification,
      meta: { recommendationType: l.type, confidence: l.confidence, purchaseCount: l.purchaseCount, lastOrderDate: l.lastOrderDate, historyQty: l.historyQty },
    })),
    arguments: summary,
  });
  return { ...res, selection };
}

/** Résumé court de la sélection (c'est lui, et non le catalogue, qui est transmis au modèle de langage). */
export function summarizeSelection(s: Selection): string[] {
  const types = Object.entries(s.byType).filter(([, n]) => n > 0).map(([t, n]) => `${n} ${RECOMMENDATION_LABEL[t as keyof typeof RECOMMENDATION_LABEL].toLowerCase()}`);
  return [
    `${s.lines.length} référence(s) sélectionnée(s) : ${types.join(", ")}.`,
    `Catégories principales : ${s.byCategory.slice(0, 5).map((c) => `${c.category} (${c.lines} réf., ${formatMoney(c.totalHt, "EUR", { compact: true })})`).join(", ")}.`,
    ...(s.excluded.length ? [`${s.excluded.length} référence(s) écartée(s) (rotation lente, rupture sans date, prix inconnu…).`] : []),
  ];
}
