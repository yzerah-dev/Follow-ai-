/**
 * Intelligence commerciale déterministe à partir des factures et de leurs lignes.
 * Règles :
 *  - Les documents annulés sont exclus.
 *  - Les avoirs (credit_note) sont soustraits (montants stockés positifs).
 *  - Facturation ≠ encaissement : aucune hypothèse sur le paiement ici.
 */
import { dec, round2, D, type Dec } from "@/lib/money";
import { daysBetween, addDays, toIsoDate } from "@/lib/utils";

export type InvoiceLite = {
  id: string;
  date: string; // YYYY-MM-DD
  docType: "invoice" | "credit_note";
  status: "issued" | "cancelled";
  totalHt: string;
};

export type LineLite = {
  invoiceId: string;
  productId: string | null;
  quantity: string;
  unitPriceHt: string;
  lineTotalHt: string;
};

const sign = (i: InvoiceLite) => (i.docType === "credit_note" ? -1 : 1);
export const effectiveInvoices = (invoices: InvoiceLite[]) => invoices.filter((i) => i.status !== "cancelled");

export function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
export function stdDev(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export type CustomerSummary = {
  invoiceCount: number;
  revenue12m: string;
  revenuePrev12m: string;
  revenueTotal: string;
  avgBasket: string | null;
  firstPurchase: string | null;
  lastPurchase: string | null;
  daysSinceLast: number | null;
  meanIntervalDays: number | null;
  monthly: { month: string; ht: string }[]; // 12 derniers mois, du plus ancien au plus récent
  trendPct: number | null; // 3 derniers mois vs 3 précédents
  seasonality: number[]; // part du CA par mois calendaire (0..11)
};

export function monthKey(date: string) {
  return date.slice(0, 7);
}

export function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

export function customerSummary(invoices: InvoiceLite[], today: string): CustomerSummary {
  const eff = effectiveInvoices(invoices);
  const sales = eff.filter((i) => i.docType === "invoice").sort((a, b) => a.date.localeCompare(b.date));
  const cutoff12 = toIsoDate(addDays(today, -365));
  const cutoff24 = toIsoDate(addDays(today, -730));
  let r12 = new D(0);
  let rPrev = new D(0);
  let total = new D(0);
  const byMonth = new Map<string, Dec>();
  const season = Array.from({ length: 12 }, () => new D(0));
  for (const inv of eff) {
    const v = dec(inv.totalHt).times(sign(inv));
    total = total.plus(v);
    if (inv.date > cutoff12 && inv.date <= today) r12 = r12.plus(v);
    else if (inv.date > cutoff24 && inv.date <= cutoff12) rPrev = rPrev.plus(v);
    byMonth.set(monthKey(inv.date), (byMonth.get(monthKey(inv.date)) ?? new D(0)).plus(v));
    const mi = Number(inv.date.slice(5, 7)) - 1;
    season[mi] = season[mi]!.plus(v);
  }
  const months = lastMonths(today, 12);
  const monthly = months.map((m) => ({ month: m, ht: round2(byMonth.get(m) ?? 0).toFixed(2) }));
  const intervals: number[] = [];
  for (let i = 1; i < sales.length; i++) intervals.push(daysBetween(sales[i - 1]!.date, sales[i]!.date));
  // Tendance sur fenêtres glissantes de 90 jours (plus robuste que des mois calendaires)
  const d90 = toIsoDate(addDays(today, -90));
  const d180 = toIsoDate(addDays(today, -180));
  let last3 = new D(0);
  let prev3 = new D(0);
  for (const inv of eff) {
    const v = dec(inv.totalHt).times(sign(inv));
    if (inv.date > d90 && inv.date <= today) last3 = last3.plus(v);
    else if (inv.date > d180 && inv.date <= d90) prev3 = prev3.plus(v);
  }
  const seasonTotal = season.reduce((a, b) => a.plus(b), new D(0));
  const salesTotal = sales.reduce((a, i) => a.plus(dec(i.totalHt)), new D(0));
  return {
    invoiceCount: sales.length,
    revenue12m: round2(r12).toFixed(2),
    revenuePrev12m: round2(rPrev).toFixed(2),
    revenueTotal: round2(total).toFixed(2),
    avgBasket: sales.length ? round2(salesTotal.dividedBy(sales.length)).toFixed(2) : null,
    firstPurchase: sales[0]?.date ?? null,
    lastPurchase: sales.at(-1)?.date ?? null,
    daysSinceLast: sales.length ? daysBetween(sales.at(-1)!.date, today) : null,
    meanIntervalDays: intervals.length ? Math.round(mean(intervals)) : null,
    monthly,
    trendPct: prev3.gt(0) ? Number(last3.minus(prev3).dividedBy(prev3).times(100).toFixed(1)) : null,
    seasonality: seasonTotal.gt(0) ? season.map((s) => Number(s.dividedBy(seasonTotal).toFixed(4))) : season.map(() => 0),
  };
}

export type ProductHabit = {
  productId: string;
  orders: number; // nombre de factures distinctes contenant le produit
  totalQty: string; // net des avoirs
  avgQtyPerOrder: string;
  firstDate: string;
  lastDate: string;
  meanIntervalDays: number | null;
  intervalCv: number | null; // coefficient de variation (régularité)
  nextExpected: string | null;
  daysUntilNext: number | null; // négatif = en retard
  lastUnitPriceHt: string;
  revenue: string;
};

export function productHabits(invoices: InvoiceLite[], lines: LineLite[], today: string): ProductHabit[] {
  const byId = new Map(effectiveInvoices(invoices).map((i) => [i.id, i]));
  const acc = new Map<string, { dates: Set<string>; qty: Dec; saleQty: Dec; revenue: Dec; last: { date: string; price: string } | null }>();
  for (const l of lines) {
    const inv = byId.get(l.invoiceId);
    if (!inv || !l.productId) continue;
    const a = acc.get(l.productId) ?? { dates: new Set<string>(), qty: new D(0), saleQty: new D(0), revenue: new D(0), last: null };
    const s = sign(inv);
    a.qty = a.qty.plus(dec(l.quantity).times(s));
    a.revenue = a.revenue.plus(dec(l.lineTotalHt).times(s));
    if (inv.docType === "invoice") {
      a.dates.add(inv.date);
      a.saleQty = a.saleQty.plus(dec(l.quantity));
      if (!a.last || inv.date >= a.last.date) a.last = { date: inv.date, price: l.unitPriceHt };
    }
    acc.set(l.productId, a);
  }
  const out: ProductHabit[] = [];
  for (const [productId, a] of acc) {
    const dates = [...a.dates].sort();
    if (!dates.length || !a.last) continue;
    const intervals: number[] = [];
    for (let i = 1; i < dates.length; i++) intervals.push(daysBetween(dates[i - 1]!, dates[i]!));
    const mi = intervals.length ? mean(intervals) : null;
    const cv = intervals.length >= 2 && mi ? stdDev(intervals) / mi : null;
    const next = mi ? toIsoDate(addDays(dates.at(-1)!, Math.round(mi))) : null;
    out.push({
      productId,
      orders: dates.length,
      totalQty: a.qty.toFixed(3),
      avgQtyPerOrder: a.saleQty.dividedBy(dates.length).toFixed(3),
      firstDate: dates[0]!,
      lastDate: dates.at(-1)!,
      meanIntervalDays: mi ? Math.round(mi) : null,
      intervalCv: cv === null ? null : Number(cv.toFixed(3)),
      nextExpected: next,
      daysUntilNext: next ? daysBetween(today, next) : null,
      lastUnitPriceHt: a.last.price,
      revenue: round2(a.revenue).toFixed(2),
    });
  }
  return out.sort((x, y) => dec(y.revenue).comparedTo(dec(x.revenue)));
}

/** Associations produit -> produits souvent achetés ensemble (sur toute l'organisation). */
export function coPurchase(lines: { invoiceId: string; productId: string | null }[], minSupport = 3) {
  const baskets = new Map<string, Set<string>>();
  for (const l of lines) {
    if (!l.productId) continue;
    const b = baskets.get(l.invoiceId) ?? new Set<string>();
    b.add(l.productId);
    baskets.set(l.invoiceId, b);
  }
  const single = new Map<string, number>();
  const pair = new Map<string, number>();
  for (const b of baskets.values()) {
    const items = [...b].sort();
    for (const a of items) single.set(a, (single.get(a) ?? 0) + 1);
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const k = `${items[i]}|${items[j]}`;
        pair.set(k, (pair.get(k) ?? 0) + 1);
      }
  }
  const n = baskets.size || 1;
  const assoc = new Map<string, { productId: string; support: number; confidence: number; lift: number }[]>();
  for (const [k, c] of pair) {
    if (c < minSupport) continue;
    const [a, b] = k.split("|") as [string, string];
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const conf = c / (single.get(x) ?? 1);
      const lift = conf / ((single.get(y) ?? 1) / n);
      const list = assoc.get(x) ?? [];
      list.push({ productId: y, support: c, confidence: conf, lift });
      assoc.set(x, list);
    }
  }
  for (const list of assoc.values()) list.sort((p, q) => q.lift - p.lift);
  return assoc;
}
