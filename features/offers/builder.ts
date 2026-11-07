/**
 * Moteur de construction d'offres — déterministe et vérifiable.
 * - prix : résolus via resolvePrice (jamais inventés)
 * - disponibilité : uniquement celle connue ; inconnue => avertissement
 * - colisage et minimum de commande respectés (arrondi au colis supérieur)
 * - remises bornées par la politique commerciale
 */
import { dec, lineTotal, computeTotals, round2, D } from "@/lib/money";
import { resolvePrice, type PriceRow, type ResolvedPrice } from "./pricing";
import { clampDiscount, type CommercialPolicy } from "./policy";

export type BuilderProduct = {
  id: string;
  reference: string;
  name: string;
  salePriceHt: string | null;
  vatRate: string;
  unitsPerCase: number | null;
  minOrderQty: number | null;
  availability: "in_stock" | "low_stock" | "out_of_stock" | "on_order" | "unknown";
  qtyAvailable: string | null; // dernier stock connu
  availableFrom: string | null;
};

/** Métadonnées commerciales d'une ligne (moteur de sélection) : type de recommandation, historique, confiance. */
export type LineMeta = {
  recommendationType?: "reorder" | "permanent" | "back_in_stock" | "complementary" | "new_product" | "manual";
  confidence?: "verified" | "declared" | "high" | "medium" | "low";
  purchaseCount?: number;
  lastOrderDate?: string | null;
  historyQty?: string | null;
};
export type BuilderItem = { productId: string; suggestedQty: string; rationale?: string; discountPct?: string; meta?: LineMeta };

export type BuilderInput = {
  customer: { id: string; minOrderAmount: string | null; francoAmount: string | null };
  items: BuilderItem[];
  products: BuilderProduct[];
  prices: PriceRow[];
  policy: CommercialPolicy;
  date: string;
};

export type DraftLine = {
  lineNo: number;
  productId: string;
  reference: string;
  description: string;
  quantity: string;
  unitPriceHt: string;
  priceSource: ResolvedPrice["source"];
  discountPct: string;
  vatRate: string;
  lineTotalHt: string;
  rationale: string | null;
  notes: string[];
  meta: LineMeta;
};

export type Warning = { code: string; message: string; productId?: string };

export type OfferDraft = {
  lines: DraftLine[];
  excluded: Warning[];
  warnings: Warning[];
  subtotalHt: string;
  discountTotalHt: string;
  totalHt: string;
  totalVat: string;
  totalTtc: string;
  requiresApproval: boolean;
  hasDiscount: boolean;
};

export function roundToCase(qty: string, unitsPerCase: number | null, minOrderQty: number | null): string {
  let q = dec(qty);
  if (q.lte(0)) q = new D(1);
  if (minOrderQty && q.lt(minOrderQty)) q = new D(minOrderQty);
  if (unitsPerCase && unitsPerCase > 1) q = q.dividedBy(unitsPerCase).ceil().times(unitsPerCase);
  else q = q.ceil();
  return q.toFixed(0);
}

export function buildOfferDraft(input: BuilderInput): OfferDraft {
  const lines: DraftLine[] = [];
  const excluded: Warning[] = [];
  const warnings: Warning[] = [];
  const byId = new Map(input.products.map((p) => [p.id, p]));
  let anyDiscount = false;
  // Doublons : une seule ligne par produit, quantités additionnées (signalé).
  const merged = new Map<string, BuilderItem>();
  for (const item of input.items) {
    const prev = merged.get(item.productId);
    if (prev) {
      merged.set(item.productId, { ...prev, suggestedQty: dec(prev.suggestedQty).plus(dec(item.suggestedQty)).toFixed(3) });
      warnings.push({ code: "duplicate_merged", message: `Produit présent plusieurs fois : lignes fusionnées.`, productId: item.productId });
    } else merged.set(item.productId, item);
  }

  for (const item of merged.values()) {
    const p = byId.get(item.productId);
    if (!p) {
      excluded.push({ code: "unknown_product", message: "Produit introuvable dans le catalogue.", productId: item.productId });
      continue;
    }
    if (p.availability === "out_of_stock" && !p.availableFrom) {
      excluded.push({ code: "out_of_stock", message: `${p.reference} — rupture sans date de disponibilité connue : exclu.`, productId: p.id });
      continue;
    }
    const qty = roundToCase(item.suggestedQty, p.unitsPerCase, p.minOrderQty);
    const price = resolvePrice({ id: p.id, salePriceHt: p.salePriceHt }, input.customer.id, input.prices, input.date, Number(qty));
    if (!price) {
      excluded.push({ code: "no_price", message: `${p.reference} — aucun prix connu : exclu (aucun prix n'est inventé).`, productId: p.id });
      continue;
    }
    const notes: string[] = [];
    if (qty !== dec(item.suggestedQty).toFixed(0)) notes.push(`Quantité ajustée au colisage (${p.unitsPerCase ?? 1}) / minimum de commande.`);
    if (p.availability === "unknown") notes.push("Disponibilité non communiquée : à confirmer.");
    if (p.availability === "on_order" || (p.availability === "out_of_stock" && p.availableFrom))
      notes.push(p.availableFrom ? `Disponible à partir du ${p.availableFrom}.` : "En réapprovisionnement.");
    if (p.qtyAvailable !== null && dec(p.qtyAvailable).lt(dec(qty))) notes.push(`Stock connu (${dec(p.qtyAvailable).toFixed(0)}) inférieur à la quantité proposée.`);
    const discount = clampDiscount(input.policy, item.discountPct ?? "0");
    if (dec(discount).gt(0)) anyDiscount = true;
    if (item.discountPct && dec(item.discountPct).gt(dec(discount)))
      warnings.push({ code: "discount_clamped", message: `Remise demandée sur ${p.reference} ramenée au plafond de ${discount} %.`, productId: p.id });
    lines.push({
      lineNo: lines.length + 1,
      productId: p.id,
      reference: p.reference,
      description: p.name,
      quantity: qty,
      unitPriceHt: dec(price.unitPriceHt).toFixed(4),
      priceSource: price.source,
      discountPct: discount,
      vatRate: dec(p.vatRate).toFixed(2),
      lineTotalHt: lineTotal(qty, price.unitPriceHt, discount).toFixed(2),
      rationale: item.rationale ?? null,
      notes,
      meta: item.meta ?? {},
    });
    for (const n of notes) if (n.startsWith("Disponibilité") || n.startsWith("Stock")) warnings.push({ code: "availability", message: `${p.reference} — ${n}`, productId: p.id });
  }

  const subtotal = round2(lines.reduce((a, l) => a.plus(dec(l.quantity).times(dec(l.unitPriceHt))), new D(0)));
  const totals = computeTotals(lines.map((l) => ({ totalHt: l.lineTotalHt, vatRate: l.vatRate })));
  if (input.customer.minOrderAmount && totals.totalHt.lt(dec(input.customer.minOrderAmount)))
    warnings.push({ code: "below_minimum", message: `Total HT inférieur au minimum de commande du client (${dec(input.customer.minOrderAmount).toFixed(2)} €).` });
  if (input.customer.francoAmount && totals.totalHt.lt(dec(input.customer.francoAmount)))
    warnings.push({ code: "below_franco", message: `Franco de port non atteint (${dec(input.customer.francoAmount).toFixed(2)} € HT) : frais de port possibles.` });
  if (!lines.length) warnings.push({ code: "empty", message: "Aucune ligne valide : l'offre ne peut pas être créée." });

  return {
    lines,
    excluded,
    warnings,
    subtotalHt: subtotal.toFixed(2),
    discountTotalHt: round2(subtotal.minus(totals.totalHt)).toFixed(2),
    totalHt: totals.totalHt.toFixed(2),
    totalVat: totals.totalVat.toFixed(2),
    totalTtc: totals.totalTtc.toFixed(2),
    // V1 : toute offre est validée par un humain avant envoi.
    requiresApproval: true,
    hasDiscount: anyDiscount,
  };
}
