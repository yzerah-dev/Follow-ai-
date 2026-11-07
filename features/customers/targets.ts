/**
 * Mission 6 — Objectifs de CA : calculs 100 % déterministes (décimal exact).
 * CA réalisé = factures émises − avoirs, hors annulations, sur la période jusqu'à aujourd'hui.
 * Attendu à date = objectif × part de la période écoulée :
 *   - saisonnalité N-1 du client si l'historique de l'an dernier couvre la période ;
 *   - sinon prorata temporis (jours écoulés / jours de la période).
 * Prévision de fin de période = réalisé / part écoulée (projection au rythme actuel), « À confirmer » si trop tôt.
 */
import { dec, round2, D } from "@/lib/money";
import { addDays, daysBetween, toIsoDate } from "@/lib/utils";
import type { InvoiceLite } from "@/features/invoices/analytics";

export type TargetInput = { periodType: "year" | "month"; periodStart: string; targetHt: string };

export type TargetProgress = {
  periodType: "year" | "month";
  periodStart: string;
  periodEnd: string;
  targetHt: string;
  realizedHt: string;
  expectedToDateHt: string | null;
  gapHt: string | null; // réalisé − attendu (négatif = retard)
  gapPct: number | null;
  forecastHt: string | null;
  elapsedShare: number;
  method: "seasonality_n1" | "prorata";
  status: "ahead" | "on_track" | "behind" | "unknown";
};

export function periodEnd(t: Pick<TargetInput, "periodType" | "periodStart">): string {
  const [y, m] = t.periodStart.split("-").map(Number) as [number, number];
  const end = t.periodType === "year" ? new Date(Date.UTC(y + 1, 0, 0)) : new Date(Date.UTC(y, m, 0));
  return toIsoDate(end);
}

export function currentPeriods(today: string) {
  return { year: `${today.slice(0, 4)}-01-01`, month: `${today.slice(0, 7)}-01` };
}

const shiftYear = (iso: string, n: number) => `${Number(iso.slice(0, 4)) + n}${iso.slice(4)}`.replace(/-02-29$/, "-02-28");

function netBetween(invoices: InvoiceLite[], from: string, to: string) {
  let v = new D(0);
  for (const i of invoices) {
    if (i.status === "cancelled" || i.date < from || i.date > to) continue;
    v = v.plus(dec(i.totalHt).times(i.docType === "credit_note" ? -1 : 1));
  }
  return v;
}

export function computeTargetProgress(invoices: InvoiceLite[], target: TargetInput, today: string, alertPct = 10): TargetProgress {
  const start = target.periodStart;
  const end = periodEnd(target);
  const asOf = today < end ? today : end;
  const base = { periodType: target.periodType, periodStart: start, periodEnd: end, targetHt: dec(target.targetHt).toFixed(2) };
  if (today < start) {
    return { ...base, realizedHt: "0.00", expectedToDateHt: "0.00", gapHt: "0.00", gapPct: 0, forecastHt: null, elapsedShare: 0, method: "prorata", status: "unknown" };
  }
  const realized = netBetween(invoices, start, asOf);
  // Part écoulée : saisonnalité N-1 si l'historique couvre toute la période de l'an dernier.
  const prevStart = shiftYear(start, -1);
  const prevEnd = shiftYear(end, -1);
  const prevAsOf = shiftYear(asOf, -1);
  const firstInvoice = invoices.filter((i) => i.status !== "cancelled").map((i) => i.date).sort()[0];
  const prevTotal = netBetween(invoices, prevStart, prevEnd);
  let share: number;
  let method: TargetProgress["method"];
  // Historique « couvrant » la période N-1 : première facture au plus tard 45 j (année) / 7 j (mois) après son début.
  const tolerance = target.periodType === "year" ? 45 : 7;
  if (firstInvoice && firstInvoice <= toIsoDate(addDays(prevStart, tolerance)) && prevTotal.gt(0)) {
    share = Math.min(1, Math.max(0, netBetween(invoices, prevStart, prevAsOf).dividedBy(prevTotal).toNumber()));
    method = "seasonality_n1";
  } else {
    share = Math.min(1, (daysBetween(start, asOf) + 1) / (daysBetween(start, end) + 1));
    method = "prorata";
  }
  const expected = round2(dec(target.targetHt).times(share));
  const gap = round2(realized.minus(expected));
  const gapPct = expected.gt(0) ? Number(gap.dividedBy(expected).times(100).toFixed(1)) : null;
  const forecast = share >= 0.05 ? round2(realized.dividedBy(share)) : null;
  // Trop tôt dans la période pour juger : « À confirmer ».
  const status: TargetProgress["status"] =
    share < 0.05 || gapPct === null ? "unknown" : gapPct <= -alertPct ? "behind" : gapPct >= alertPct ? "ahead" : "on_track";
  return {
    ...base,
    realizedHt: round2(realized).toFixed(2),
    expectedToDateHt: expected.toFixed(2),
    gapHt: gap.toFixed(2),
    gapPct,
    forecastHt: forecast ? forecast.toFixed(2) : null,
    elapsedShare: Number(share.toFixed(4)),
    method,
    status,
  };
}

export const TARGET_STATUS_LABEL: Record<TargetProgress["status"], string> = {
  ahead: "En avance",
  on_track: "Dans l'objectif",
  behind: "En retard",
  unknown: "À confirmer",
};

/** Objectif annuel suggéré (aide à la saisie, jamais appliqué automatiquement) : CA des 12 derniers mois. */
export function last12mRevenue(invoices: InvoiceLite[], today: string) {
  return round2(netBetween(invoices, toIsoDate(addDays(today, -364)), today)).toFixed(2);
}
