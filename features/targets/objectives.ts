/**
 * Moteur d'objectifs de CA (V4) — calculs purs, décimal exact.
 * Niveaux : client, portefeuille (commercial), entreprise. Les objectifs sont fixés par des humains ;
 * la répartition mensuelle peut être saisie ou calculée selon la saisonnalité N-1 (sinon prorata), et elle est étiquetée.
 *
 * Réalisé = factures émises − avoirs (hors annulations). Attendu à date = objectifs des mois écoulés
 * + objectif du mois en cours au prorata des jours écoulés. Prévision de fin d'année = réalisé + objectifs restants
 * ajustés du rythme constaté (réalisé / attendu à date), étiquetée « projection ».
 */
import { dec, round2, D, type Dec } from "@/lib/money";

export type MonthAmounts = Dec[]; // 12 montants (janvier → décembre)
export type TargetSource = "manual" | "seasonality" | "prorata";

export const SOURCE_LABEL: Record<TargetSource, string> = {
  manual: "Saisi",
  seasonality: "Saisonnalité N-1",
  prorata: "Réparti également",
};

/** Répartition d'un objectif annuel sur 12 mois : saisonnalité N-1 si l'historique couvre l'année, sinon parts égales. Somme exacte garantie. */
export function splitAnnual(annualHt: string, n1: MonthAmounts): { months: string[]; source: TargetSource } {
  const annual = dec(annualHt);
  const total = n1.reduce((a, m) => a.plus(D.max(0, m)), new D(0));
  // Saisonnalité fiable seulement si l'historique N-1 couvre l'année (au moins 10 mois avec du CA) ;
  // sinon un seul mois connu concentrerait tout l'objectif sur ce mois → répartition à parts égales.
  const coveredMonths = n1.filter((m) => m.gt(0)).length;
  const source: TargetSource = total.gt(0) && coveredMonths >= 10 ? "seasonality" : "prorata";
  const raw = n1.map((m) => (source === "seasonality" ? annual.times(D.max(0, m)).dividedBy(total) : annual.dividedBy(12)));
  const months = raw.map((m) => round2(m));
  // L'arrondi est reporté sur décembre pour que la somme soit exactement l'objectif annuel.
  const diff = annual.minus(months.reduce((a, m) => a.plus(m), new D(0)));
  months[11] = months[11]!.plus(diff);
  return { months: months.map((m) => m.toFixed(2)), source };
}

export type ObjectiveRow = {
  month: number; // 1-12
  targetHt: string | null;
  targetSource: TargetSource | null;
  realizedHt: string | null; // null : mois futur
  cumulativeRealizedHt: string | null;
  cumulativeTargetHt: string | null;
  n1Ht: string;
  evolutionPct: number | null; // réalisé vs N-1 (mois écoulés)
  attainmentPct: number | null; // réalisé / objectif du mois
};

export type ObjectiveSummary = {
  year: number;
  annualTargetHt: string | null;
  monthTargetHt: string | null;
  monthTargetSource: TargetSource | null;
  realizedYtdHt: string;
  realizedMonthHt: string;
  expectedToDateHt: string | null;
  gapToDateHt: string | null;
  attainmentToDatePct: number | null; // réalisé / attendu à date
  attainmentYearPct: number | null; // réalisé / objectif annuel
  forecastHt: string | null;
  forecastMethod: "pace_vs_target" | null;
  n1YtdHt: string;
  evolutionYtdPct: number | null;
  status: "ahead" | "on_track" | "behind" | "unknown";
};

export function buildObjectiveTable(args: {
  year: number;
  today: string; // AAAA-MM-JJ
  annualTargetHt: string | null;
  monthlyTargets: Map<number, { targetHt: string; source: TargetSource }>; // mois saisis ou répartis et enregistrés
  realized: MonthAmounts; // année en cours
  n1: MonthAmounts; // année précédente
  alertPct?: number;
}): { rows: ObjectiveRow[]; summary: ObjectiveSummary } {
  const { year, today } = args;
  const ty = Number(today.slice(0, 4));
  const tm = Number(today.slice(5, 7));
  const td = Number(today.slice(8, 10));
  const daysInMonth = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  // Mois sans objectif enregistré : répartition calculée à la volée (étiquetée) si un objectif annuel existe.
  const split = args.annualTargetHt ? splitAnnual(args.annualTargetHt, args.n1) : null;
  const monthTarget = (m: number) => args.monthlyTargets.get(m) ?? (split ? { targetHt: split.months[m - 1]!, source: split.source } : null);
  const elapsed = (m: number) => (year < ty ? 1 : year > ty ? 0 : m < tm ? 1 : m === tm ? td / daysInMonth : 0);

  let cumR = new D(0);
  let cumT = new D(0);
  let expected = new D(0);
  let hasTarget = false;
  const rows: ObjectiveRow[] = [];
  for (let m = 1; m <= 12; m++) {
    const share = elapsed(m);
    const t = monthTarget(m);
    const real = share > 0 ? args.realized[m - 1]! : null;
    if (real) cumR = cumR.plus(real);
    if (t) { hasTarget = true; cumT = cumT.plus(dec(t.targetHt)); expected = expected.plus(dec(t.targetHt).times(share)); }
    const n1 = args.n1[m - 1]!;
    rows.push({
      month: m, targetHt: t?.targetHt ?? null, targetSource: t?.source ?? null,
      realizedHt: real ? round2(real).toFixed(2) : null,
      cumulativeRealizedHt: share > 0 ? round2(cumR).toFixed(2) : null,
      cumulativeTargetHt: t ? round2(cumT).toFixed(2) : null,
      n1Ht: round2(n1).toFixed(2),
      evolutionPct: real && share === 1 && n1.gt(0) ? Number(real.minus(n1).dividedBy(n1).times(100).toFixed(1)) : null,
      attainmentPct: real && t && dec(t.targetHt).gt(0) ? Number(real.dividedBy(dec(t.targetHt)).times(100).toFixed(1)) : null,
    });
  }
  const annual = args.annualTargetHt ? dec(args.annualTargetHt) : hasTarget ? cumT : null;
  const exp = hasTarget ? round2(expected) : null;
  const gap = exp ? round2(cumR.minus(exp)) : null;
  const attToDate = exp && exp.gt(0) ? Number(cumR.dividedBy(exp).times(100).toFixed(1)) : null;
  const n1Ytd = args.n1.reduce((a, v, k) => a.plus(v.times(Math.min(1, elapsed(k + 1)))), new D(0));
  // Projection : réalisé + objectifs restants × rythme constaté (borné), seulement si au moins 5 % de l'année est écoulée.
  const remaining = annual && exp ? annual.minus(exp) : null;
  const pace = exp && exp.gt(0) ? D.min(1.5, D.max(0, cumR.dividedBy(exp))) : null;
  const forecast = remaining && pace && exp!.dividedBy(annual!).gte(0.05) ? round2(cumR.plus(remaining.times(pace))) : null;
  const alert = args.alertPct ?? 10;
  const status: ObjectiveSummary["status"] = attToDate === null || (exp && annual && exp.dividedBy(annual).lt(0.05)) ? "unknown" : attToDate <= 100 - alert ? "behind" : attToDate >= 100 + alert ? "ahead" : "on_track";
  const cur = year === ty ? tm : null;
  return {
    rows,
    summary: {
      year, annualTargetHt: annual ? round2(annual).toFixed(2) : null,
      monthTargetHt: cur ? monthTarget(cur)?.targetHt ?? null : null,
      monthTargetSource: cur ? monthTarget(cur)?.source ?? null : null,
      realizedYtdHt: round2(cumR).toFixed(2),
      realizedMonthHt: cur ? round2(args.realized[cur - 1]!).toFixed(2) : "0.00",
      expectedToDateHt: exp ? exp.toFixed(2) : null,
      gapToDateHt: gap ? gap.toFixed(2) : null,
      attainmentToDatePct: attToDate,
      attainmentYearPct: annual && annual.gt(0) ? Number(cumR.dividedBy(annual).times(100).toFixed(1)) : null,
      forecastHt: forecast ? forecast.toFixed(2) : null,
      forecastMethod: forecast ? "pace_vs_target" : null,
      n1YtdHt: round2(n1Ytd).toFixed(2),
      evolutionYtdPct: n1Ytd.gt(0) ? Number(cumR.minus(n1Ytd).dividedBy(n1Ytd).times(100).toFixed(1)) : null,
      status,
    },
  };
}

export const MONTH_LABEL = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
