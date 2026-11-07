/**
 * Les 6 missions permanentes de LÉA et leur rattachement aux types d'opportunités.
 */
import type { ProductHabit } from "@/features/invoices/analytics";
import { roundToCase } from "@/features/offers/builder";

export const MISSIONS = ["reactivation", "permanents", "complementary", "new_products", "meetings", "targets", "follow_up"] as const;
export type Mission = (typeof MISSIONS)[number];

export const MISSION_LABEL: Record<Mission, string> = {
  reactivation: "Réactivation",
  permanents: "Permanents",
  complementary: "Complémentaires & retours en stock",
  new_products: "Nouveautés",
  meetings: "Rendez-vous",
  targets: "Objectifs de CA",
  follow_up: "Suivi des offres & campagnes",
};

export const MISSION_OF: Record<string, Mission> = {
  dormant_customer: "reactivation",
  reorder: "permanents",
  cross_sell: "complementary",
  back_in_stock: "complementary",
  new_product: "new_products",
  appointment: "meetings",
  target_gap: "targets",
  campaign: "follow_up",
  unclosed_offer: "follow_up",
};

export const OPPORTUNITY_TYPES_OF: Record<Mission, string[]> = Object.entries(MISSION_OF).reduce(
  (acc, [type, mission]) => ({ ...acc, [mission]: [...(acc[mission] ?? []), type] }),
  {} as Record<Mission, string[]>,
);

/** Mission 2 — produit « permanent » : acheté au moins 3 fois, cycle ≤ 120 jours et régulier (CV ≤ 0,6). */
export function isPermanent(h: ProductHabit) {
  return h.orders >= 3 && h.meanIntervalDays !== null && h.meanIntervalDays <= 120 && (h.intervalCv === null || h.intervalCv <= 0.6);
}

export type PermanentProduct = ProductHabit & { suggestedQty: string; dueSoon: boolean };

export function permanentProducts(habits: ProductHabit[], unitsPerCase: Map<string, { unitsPerCase: number | null; minOrderQty: number | null }>, lookaheadDays = 21): PermanentProduct[] {
  return habits.filter(isPermanent).map((h) => {
    const p = unitsPerCase.get(h.productId);
    return {
      ...h,
      suggestedQty: roundToCase(h.avgQtyPerOrder, p?.unitsPerCase ?? null, p?.minOrderQty ?? null),
      dueSoon: h.daysUntilNext !== null && h.daysUntilNext <= lookaheadDays,
    };
  });
}
