import { dec } from "@/lib/money";

export type PriceRow = {
  productId: string;
  customerId: string | null;
  unitPriceHt: string;
  minQty: number;
  validFrom: string | null;
  validTo: string | null;
};

export type ResolvedPrice = { unitPriceHt: string; source: "customer_price" | "price_list" | "catalog" };

/**
 * Résolution du prix — ordre : tarif spécifique client valide > liste de prix générale valide > prix catalogue.
 * Retourne null si aucun prix n'est connu : on n'invente JAMAIS un prix.
 */
export function resolvePrice(
  product: { id: string; salePriceHt: string | null },
  customerId: string,
  prices: PriceRow[],
  date: string,
  qty = 1,
): ResolvedPrice | null {
  const valid = prices.filter(
    (p) =>
      p.productId === product.id &&
      (!p.validFrom || p.validFrom <= date) &&
      (!p.validTo || p.validTo >= date) &&
      p.minQty <= qty,
  );
  const pick = (rows: PriceRow[]) => rows.sort((a, b) => b.minQty - a.minQty || dec(a.unitPriceHt).comparedTo(dec(b.unitPriceHt)))[0];
  const own = pick(valid.filter((p) => p.customerId === customerId));
  if (own) return { unitPriceHt: own.unitPriceHt, source: "customer_price" };
  const general = pick(valid.filter((p) => p.customerId === null));
  if (general) return { unitPriceHt: general.unitPriceHt, source: "price_list" };
  if (product.salePriceHt !== null && product.salePriceHt !== undefined) return { unitPriceHt: product.salePriceHt, source: "catalog" };
  return null;
}

export const PRICE_SOURCE_LABEL: Record<ResolvedPrice["source"], string> = {
  customer_price: "Tarif client",
  price_list: "Liste de prix",
  catalog: "Prix catalogue",
};
