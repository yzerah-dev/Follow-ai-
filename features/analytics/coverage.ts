/**
 * Analyse de couverture de stock par client × référence.
 *
 * Les factures fournisseur mesurent ce que le client ACHÈTE (sell-in), pas ce qu'il VEND (sell-out).
 * Sans sorties caisse ni stock déclaré, tout est une ESTIMATION, présentée comme telle avec ses hypothèses
 * et un niveau de confiance. Une valeur inconnue reste `null` (jamais 0).
 *
 * Hypothèses de l'estimation (affichées dans l'Excel et dans les arguments) :
 *  H1. Sur la durée, le client revend ce qu'il achète : ventes/jour ≈ quantités achetées entre la 1re et la dernière commande / nombre de jours.
 *  H2. Le client réassortit quand son stock est presque épuisé : stock restant ≈ dernière commande − ventes estimées depuis.
 * Un stock déclaré (message du client, commercial) ou des sorties caisse remplacent l'hypothèse correspondante.
 */
import { dec, D, type Dec } from "@/lib/money";
import { daysBetween } from "@/lib/utils";
import { roundToCase } from "@/features/offers/builder";

export type Purchase = { date: string; qty: string };
export type StockReport = { qtyOnHand: string | null; unitsSoldPerDay: string | null; reportedAt: string; source: "customer_message" | "sales_rep" | "sell_out_import" };

export type CoverageInput = {
  productId: string;
  reference: string;
  name: string;
  unitsPerCase: number | null;
  minOrderQty: number | null;
  purchases: Purchase[]; // factures émises uniquement (avoirs déduits en amont si besoin)
  report: StockReport | null; // le plus récent
  today: string;
};

export type Confidence = "verified" | "declared" | "high" | "medium" | "low";
export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  verified: "Vérifié (sorties caisse + stock déclaré)",
  declared: "Déclaré par le client",
  high: "Estimation fiable",
  medium: "Estimation moyenne",
  low: "Estimation fragile",
};
export type Risk = "high" | "medium" | "low" | "unknown";
export const RISK_LABEL: Record<Risk, string> = { high: "Rupture imminente", medium: "À surveiller", low: "Couvert", unknown: "Inconnu" };

export type CoverageRow = {
  productId: string;
  reference: string;
  name: string;
  lastPurchase: string | null;
  orders: number;
  historicalQty: string; // quantité achetée sur la période analysée
  dailyRate: string | null; // unités / jour
  rateSource: "sell_out" | "estimated" | null;
  stockOnHand: string | null;
  stockSource: "declared" | "estimated" | null;
  coverageDays: number | null;
  targetDays: number; // cycle de réassort visé
  risk: Risk;
  recommendedQty: string | null;
  confidence: Confidence;
  slowMover: boolean;
  reason: string;
  hypotheses: string[];
};

const DEFAULT_TARGET_DAYS = 30;
const DECLARED_STALE_DAYS = 30;

export function computeCoverage(i: CoverageInput): CoverageRow {
  const ps = [...i.purchases].filter((p) => dec(p.qty).gt(0)).sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map<string, Dec>();
  for (const p of ps) byDate.set(p.date, (byDate.get(p.date) ?? new D(0)).plus(dec(p.qty)));
  const dates = [...byDate.keys()];
  const orders = dates.length;
  const first = dates[0] ?? null;
  const last = dates.at(-1) ?? null;
  const total = [...byDate.values()].reduce((a, q) => a.plus(q), new D(0));
  const lastQty = last ? byDate.get(last)! : new D(0);
  const intervals = dates.slice(1).map((d, k) => daysBetween(dates[k]!, d));
  const meanInterval = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
  const cv = intervals.length >= 2 && meanInterval ? Math.sqrt(intervals.reduce((a, x) => a + (x - meanInterval) ** 2, 0) / intervals.length) / meanInterval : null;
  const targetDays = meanInterval ? Math.max(7, Math.min(90, Math.round(meanInterval))) : DEFAULT_TARGET_DAYS;
  const hypotheses: string[] = [];

  // Ventes / jour
  let rate: Dec | null = null;
  let rateSource: CoverageRow["rateSource"] = null;
  if (i.report?.unitsSoldPerDay !== null && i.report?.unitsSoldPerDay !== undefined) {
    rate = dec(i.report.unitsSoldPerDay);
    rateSource = "sell_out";
  } else if (orders >= 2 && first && last && daysBetween(first, last) > 0) {
    rate = total.minus(lastQty).dividedBy(daysBetween(first, last));
    rateSource = "estimated";
    hypotheses.push("H1 : ventes estimées à partir de vos achats (le client revend ce qu'il achète).");
  }

  // Stock restant
  let stock: Dec | null = null;
  let stockSource: CoverageRow["stockSource"] = null;
  const report = i.report && i.report.qtyOnHand !== null && Math.abs(daysBetween(i.report.reportedAt.slice(0, 10), i.today)) <= DECLARED_STALE_DAYS ? i.report : null;
  if (report) {
    stock = dec(report.qtyOnHand!);
    // Achats postérieurs à la déclaration : ajoutés (le reste est inchangé).
    for (const [d, q] of byDate) if (d > report.reportedAt.slice(0, 10)) stock = stock.plus(q);
    if (rate) stock = D.max(0, stock.minus(rate.times(Math.max(0, daysBetween(report.reportedAt.slice(0, 10), i.today)))));
    stockSource = "declared";
  } else if (rate && last) {
    stock = D.max(0, lastQty.minus(rate.times(daysBetween(last, i.today))));
    stockSource = "estimated";
    hypotheses.push("H2 : stock estimé = dernière commande − ventes estimées depuis (réassort à épuisement).");
  }

  const coverageDays = stock !== null && rate !== null && rate.gt(0) ? Math.floor(stock.dividedBy(rate).toNumber()) : stock !== null && stock.isZero() ? 0 : null;
  const risk: Risk = coverageDays === null ? "unknown" : coverageDays <= 7 ? "high" : coverageDays <= 21 ? "medium" : "low";

  // Quantité recommandée : couvrir le cycle habituel, sans sur-stocker.
  let recommended: string | null = null;
  if (rate !== null && stock !== null) {
    const need = D.max(0, rate.times(targetDays).minus(stock));
    recommended = need.isZero() ? "0" : roundToCase(need.toFixed(3), i.unitsPerCase, i.minOrderQty);
  }

  const sinceLast = last ? daysBetween(last, i.today) : null;
  const slowMover = (meanInterval !== null && sinceLast !== null && sinceLast > 2 * meanInterval) || (coverageDays !== null && coverageDays > 2 * targetDays);

  const confidence: Confidence =
    rateSource === "sell_out" && stockSource === "declared" ? "verified"
      : stockSource === "declared" || rateSource === "sell_out" ? "declared"
        : orders >= 4 && cv !== null && cv <= 0.5 ? "high"
          : orders >= 3 ? "medium" : "low";

  const reason =
    orders === 0 ? "Jamais acheté par le client."
      : rate === null ? "Historique insuffisant pour estimer les ventes (une seule commande)."
        : slowMover ? (coverageDays !== null && coverageDays > 2 * targetDays ? `Rotation lente : environ ${coverageDays} jours de stock pour un cycle de ${targetDays} jours.` : `Rotation qui ralentit : dernier achat il y a ${sinceLast} jours (cycle habituel ${Math.round(meanInterval!)} jours).`)
          : risk === "high" ? `Rupture probable sous ${Math.max(coverageDays ?? 0, 0)} jours au rythme ${rateSource === "sell_out" ? "de vos ventes" : "estimé"}.`
            : risk === "medium" ? `Couverture de ${coverageDays} jours : réassort à prévoir avant la fin du cycle.`
              : `Couverture de ${coverageDays} jours : stock suffisant pour l'instant.`;

  return {
    productId: i.productId,
    reference: i.reference,
    name: i.name,
    lastPurchase: last,
    orders,
    historicalQty: total.toFixed(0),
    dailyRate: rate ? rate.toFixed(2) : null,
    rateSource,
    stockOnHand: stock ? stock.toFixed(0) : null,
    stockSource,
    coverageDays,
    targetDays,
    risk,
    recommendedQty: recommended,
    confidence,
    slowMover,
    reason,
    hypotheses,
  };
}

/** Tri commercial : rupture imminente d'abord, puis à surveiller ; rotations lentes en dernier. */
export function rankCoverage(rows: CoverageRow[]) {
  const w: Record<Risk, number> = { high: 0, medium: 1, unknown: 2, low: 3 };
  return [...rows].sort((a, b) => Number(a.slowMover) - Number(b.slowMover) || w[a.risk] - w[b.risk] || (a.coverageDays ?? 1e9) - (b.coverageDays ?? 1e9));
}

export const fmtRate = (r: string | null) => (r === null ? "Inconnu" : dec(r).toFixed(dec(r).lt(10) ? 1 : 0).replace(".", ","));
