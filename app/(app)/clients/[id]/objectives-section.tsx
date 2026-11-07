"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { splitCustomerTargetAction, saveCustomerMonthsAction } from "@/app/actions/commercial";
import type { ObjectiveRow, ObjectiveSummary } from "@/features/targets/objectives";

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const SRC: Record<string, string> = { manual: "saisi", seasonality: "saison. N-1", prorata: "parts égales" };
const eur = (v: string | null) => (v === null ? "—" : Number(v).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }));

/** Objectifs mensuels du client : objectif (saisi ou réparti), réalisé, cumuls, N-1, évolution, atteinte ; saisie et répartition. */
export function ObjectivesSection({ customerId, rows, summary, writable, hasAnnual }: { customerId: string; rows: ObjectiveRow[]; summary: ObjectiveSummary; writable: boolean; hasAnnual: boolean }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState(rows.map((r) => (r.targetSource === "manual" ? Number(r.targetHt).toFixed(2) : "")));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const status = { behind: ["danger", "En retard"], ahead: ["success", "En avance"], on_track: ["info", "Dans l'objectif"], unknown: ["neutral", "À confirmer"] } as const;
  return (
    <Card data-testid="objectives-table">
      <CardHeader>
        <div>
          <CardTitle>Objectifs {summary.year} — suivi mensuel</CardTitle>
          <p className="mt-0.5 text-[12px] text-faint">Réalisé = factures émises − avoirs. Mois sans saisie : répartition selon la saisonnalité N-1 (étiquetée). Prévision = projection au rythme constaté.</p>
        </div>
        <Badge tone={status[summary.status][0]}>{status[summary.status][1]}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-5">
          {[["Objectif annuel", eur(summary.annualTargetHt)], ["Réalisé à date", eur(summary.realizedYtdHt)], ["Attendu à date", eur(summary.expectedToDateHt)],
            ["Écart", summary.gapToDateHt ? `${Number(summary.gapToDateHt) > 0 ? "+" : ""}${eur(summary.gapToDateHt)}` : "À confirmer"], ["Prévision fin d'année", summary.forecastHt ? eur(summary.forecastHt) : "À confirmer"]].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-muted px-3 py-2"><p className="text-[11.5px] text-subtle">{k}</p><p className="tabular font-semibold">{v}</p></div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-faint">
              <tr><th className="py-1.5">Mois</th><th className="text-right">Objectif</th><th className="text-right">Réalisé</th><th className="text-right">Cumul réalisé</th><th className="text-right">Cumul objectif</th><th className="text-right">Atteinte</th><th className="text-right">N-1</th><th className="text-right">Évol. N-1</th></tr>
            </thead>
            <tbody>
              {rows.map((r, k) => (
                <tr key={r.month} className="border-t border-border/70">
                  <td className="py-1.5">{MONTHS[r.month - 1]}</td>
                  <td className="tabular text-right">
                    {editing ? (
                      <input value={values[k]} onChange={(e) => setValues((v) => v.map((x, i) => (i === k ? e.target.value : x)))} placeholder={r.targetHt ? Number(r.targetHt).toFixed(0) : ""} aria-label={`Objectif ${MONTHS[r.month - 1]}`}
                        className="w-24 rounded border border-border bg-surface px-1.5 py-0.5 text-right" />
                    ) : <>{eur(r.targetHt)}{r.targetSource ? <span className="ml-1 text-[10.5px] text-faint">{SRC[r.targetSource]}</span> : null}</>}
                  </td>
                  <td className="tabular text-right">{eur(r.realizedHt)}</td>
                  <td className="tabular text-right">{eur(r.cumulativeRealizedHt)}</td>
                  <td className="tabular text-right text-subtle">{eur(r.cumulativeTargetHt)}</td>
                  <td className={`tabular text-right ${r.attainmentPct !== null && r.attainmentPct < 90 ? "text-danger" : ""}`}>{r.attainmentPct === null ? "—" : `${r.attainmentPct.toLocaleString("fr-FR")} %`}</td>
                  <td className="tabular text-right text-subtle">{eur(r.n1Ht)}</td>
                  <td className="tabular text-right">{r.evolutionPct === null ? "—" : `${r.evolutionPct > 0 ? "+" : ""}${r.evolutionPct.toLocaleString("fr-FR")} %`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {writable ? (
          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await saveCustomerMonthsAction(customerId, values.map((v) => (v.trim() ? v.trim() : null))); setMsg({ ok: r.ok, text: r.ok ? r.message ?? "" : r.error }); if (r.ok) setEditing(false); })}>Enregistrer les objectifs mensuels</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Annuler</Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Saisir les objectifs mensuels</Button>
                <Button size="sm" variant="secondary" disabled={pending || !hasAnnual} title={hasAnnual ? undefined : "Fixez d'abord l'objectif annuel"} onClick={() => start(async () => { const r = await splitCustomerTargetAction(customerId); setMsg({ ok: r.ok, text: r.ok ? r.message ?? "" : r.error }); })}>Répartir selon la saisonnalité N-1</Button>
              </>
            )}
            {msg ? <span role="status" className={`text-[12.5px] ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
