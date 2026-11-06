import Decimal from "decimal.js";

/**
 * Calculs financiers en décimal exact (jamais de float).
 * Arrondi commercial : ROUND_HALF_UP à 2 décimales pour les montants.
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;
export type DecimalInput = string | number | Dec;

export const dec = (v: DecimalInput | null | undefined): Dec => new D(v ?? 0);
export const round2 = (v: DecimalInput): Dec => dec(v).toDecimalPlaces(2, D.ROUND_HALF_UP);
export const sum = (values: DecimalInput[]): Dec => values.reduce<Dec>((acc, v) => acc.plus(dec(v)), new D(0));

/** Montant HT d'une ligne : quantité × PU × (1 − remise%) arrondi au centime. */
export function lineTotal(quantity: DecimalInput, unitPrice: DecimalInput, discountPct: DecimalInput = 0): Dec {
  return round2(dec(quantity).times(dec(unitPrice)).times(new D(1).minus(dec(discountPct).dividedBy(100))));
}

export type VatLine = { totalHt: DecimalInput; vatRate: DecimalInput };

/** Totaux HT / TVA / TTC ; TVA calculée par taux (ventilation) puis arrondie. */
export function computeTotals(lines: VatLine[]) {
  const byRate = new Map<string, Dec>();
  for (const l of lines) {
    const key = dec(l.vatRate).toFixed(2);
    byRate.set(key, (byRate.get(key) ?? new D(0)).plus(dec(l.totalHt)));
  }
  let ht = new D(0);
  let vat = new D(0);
  const breakdown: { rate: string; base: string; vat: string }[] = [];
  for (const [rate, base] of [...byRate.entries()].sort()) {
    const v = round2(base.times(dec(rate)).dividedBy(100));
    ht = ht.plus(base);
    vat = vat.plus(v);
    breakdown.push({ rate, base: round2(base).toFixed(2), vat: v.toFixed(2) });
  }
  return { totalHt: round2(ht), totalVat: round2(vat), totalTtc: round2(ht.plus(vat)), breakdown };
}

const eurFormatters = new Map<string, Intl.NumberFormat>();
export function formatMoney(v: DecimalInput | null | undefined, currency = "EUR", opts: { compact?: boolean } = {}): string {
  if (v === null || v === undefined || v === "") return "—";
  const key = `${currency}-${opts.compact ? "c" : "f"}`;
  let f = eurFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      maximumFractionDigits: opts.compact ? 0 : 2,
      minimumFractionDigits: opts.compact ? 0 : 2,
    });
    eurFormatters.set(key, f);
  }
  // Intl formate un Number : acceptable pour l'AFFICHAGE uniquement, jamais pour le calcul.
  return f.format(dec(v).toNumber()).replace(/ /g, " ");
}

export function formatQty(v: DecimalInput): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(dec(v).toNumber()).replace(/ /g, " ");
}
