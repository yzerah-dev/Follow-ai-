import Link from "next/link";
import { Target, TrendingUp, CalendarClock, Sparkles, Repeat, Puzzle } from "lucide-react";
import { formatMoney, formatQty, dec } from "@/lib/money";
import { formatDate, formatRelative, cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KeyValue } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ActionButton } from "@/components/app/action-button";
import { AVAILABILITY } from "@/components/app/labels";
import { TARGET_STATUS_LABEL, type TargetProgress } from "@/features/customers/targets";
import { MISSION_LABEL, type Mission, type PermanentProduct } from "@/features/opportunities/missions";
import { setDoNotSolicitAction } from "@/app/actions/commercial";
import { TargetForm } from "./target-form";

const TBC = <span className="text-warning">À confirmer</span>;

type Reco = { id: string; reference: string; name: string; availability: string; sale_price_ht: string | null };

export type Growth = {
  targets: { id: string; notes: string | null; progress: TargetProgress }[];
  permanents: (PermanentProduct & { product: { reference: string; name: string; availability: string } | null })[];
  complementary: Reco[];
  newProducts: Reco[];
  lastMeeting: { starts_at: string; kind: string } | null;
  nextMeeting: { starts_at: string; kind: string; status: string } | null;
  plan: { id: string; type: string; mission: string; title: string; action: string; valueHt: string | null; offerId: string | null; status: string }[];
  targetGap: { justification: string; details: { plan?: string[] } } | null;
};

const MEETING_KIND: Record<string, string> = { visio: "Visioconférence", showroom: "Showroom", visit: "Visite", call: "Téléphone" };

function TargetCard({ t }: { t: TargetProgress }) {
  const tone = t.status === "behind" ? "danger" : t.status === "ahead" ? "success" : t.status === "on_track" ? "info" : "neutral";
  const pct = Math.min(100, Math.round(dec(t.realizedHt).dividedBy(dec(t.targetHt)).times(100).toNumber()));
  return (
    <div className="space-y-2" data-testid="target">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium">Objectif {t.periodType === "year" ? `annuel ${t.periodStart.slice(0, 4)}` : `de ${formatDate(t.periodStart, { month: "long", year: "numeric" })}`}</p>
        <Badge tone={tone}>{TARGET_STATUS_LABEL[t.status]}</Badge>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${pct} % de l'objectif`}>
        <div className={cn("h-full rounded-full", t.status === "behind" ? "bg-danger/70" : "bg-success/70")} style={{ width: `${Math.max(0, pct)}%` }} />
      </div>
      <KeyValue label="Objectif CA">{formatMoney(t.targetHt)}</KeyValue>
      <KeyValue label="CA réalisé (facturé net)">{formatMoney(t.realizedHt)}</KeyValue>
      <KeyValue label="Attendu à date">{t.expectedToDateHt ? formatMoney(t.expectedToDateHt) : TBC}</KeyValue>
      <KeyValue label="Écart à l'objectif à date">
        {t.gapHt && t.status !== "unknown" ? (
          <span className={dec(t.gapHt).lt(0) ? "text-danger" : "text-success"}>
            {dec(t.gapHt).gt(0) ? "+" : ""}{formatMoney(t.gapHt)} ({t.gapPct! > 0 ? "+" : ""}{t.gapPct!.toLocaleString("fr-FR")} %)
          </span>
        ) : TBC}
      </KeyValue>
      <KeyValue label="Prévision de fin de période">{t.forecastHt ? formatMoney(t.forecastHt) : TBC}</KeyValue>
      <p className="text-[11px] text-faint">
        Attendu calculé {t.method === "seasonality_n1" ? "selon la saisonnalité du client l'an dernier" : "au prorata du temps écoulé"} ({Math.round(t.elapsedShare * 100)} % de la période). Prévision au rythme actuel.
      </p>
    </div>
  );
}

export function GrowthSection({ customerId, growth, writable, revenue12m, doNotSolicit, pausedUntil }: { customerId: string; growth: Growth; writable: boolean; revenue12m: string; doNotSolicit: boolean; pausedUntil: string | null }) {
  const paused = pausedUntil && pausedUntil >= new Date().toISOString().slice(0, 10);
  return (
    <section className="space-y-5" aria-label="Développement du client">
      {doNotSolicit || paused ? (
        <div className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-[13px] text-warning">
          {doNotSolicit ? "Ce client ne souhaite plus être sollicité : LÉA ne lui propose plus rien de sa propre initiative." : `Pause des sollicitations après un refus, jusqu'au ${formatDate(pausedUntil)}.`}
        </div>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Target className="size-4 text-primary" /> Objectif de CA</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {growth.targets.length ? growth.targets.map((t) => <TargetCard key={t.id} t={t.progress} />) : (
              <div className="space-y-1 text-[13px]">
                <KeyValue label="Objectif CA">{TBC}</KeyValue>
                <KeyValue label="CA facturé sur 12 mois">{formatMoney(revenue12m)}</KeyValue>
                <p className="text-[12px] text-faint">Aucun objectif enregistré : l&apos;écart et la prévision ne peuvent pas être calculés.</p>
              </div>
            )}
            {writable ? <TargetForm customerId={customerId} suggestion={dec(revenue12m).gt(0) ? dec(revenue12m).toDecimalPlaces(0).toString() : null} /> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TrendingUp className="size-4 text-primary" /> Plan de développement commercial</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2" data-testid="growth-plan">
            {growth.targetGap ? <p className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{growth.targetGap.justification}</p> : null}
            {growth.plan.length === 0 ? <p className="text-[13px] text-subtle">Aucun levier détecté pour l&apos;instant.</p> : null}
            {growth.plan.map((p, i) => (
              <div key={p.id} className="flex items-start gap-2 text-[13px]">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {p.title} <Badge tone="outline">{MISSION_LABEL[p.mission as Mission] ?? p.mission}</Badge>
                    {p.status === "in_progress" ? <Badge tone="info" className="ml-1">En cours</Badge> : null}
                  </p>
                  <p className="text-[12px] text-subtle">{p.action}</p>
                </div>
                <span className="tabular shrink-0 text-[12.5px] font-medium">{p.valueHt ? `≈ ${formatMoney(p.valueHt, "EUR", { compact: true })}` : TBC}</span>
                {p.offerId ? <Link href={`/offres/${p.offerId}`} className="shrink-0 text-[12px] text-primary hover:underline">Offre</Link> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Repeat className="size-4 text-primary" /> Produits permanents</CardTitle>
          <span className="text-[12px] text-faint">Achetés au moins 3 fois, à intervalle régulier</span>
        </CardHeader>
        {growth.permanents.length === 0 ? (
          <CardContent><p className="text-[13px] text-subtle">Aucun produit permanent identifié dans l&apos;historique.</p></CardContent>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Produit</TH>
                <TH>Cycle</TH>
                <TH className="text-right">Qté habituelle</TH>
                <TH className="text-right">Qté conseillée</TH>
                <TH>Prochain réassort</TH>
                <TH>Dispo.</TH>
              </tr>
            </THead>
            <TBody>
              {growth.permanents.map((h) => (
                <TR key={h.productId} data-testid="permanent">
                  <TD>
                    <Link href={`/produits/${h.productId}`} className="font-medium hover:text-primary">{h.product?.name ?? "Produit"}</Link>
                    <span className="block text-[11.5px] text-faint">{h.product?.reference} · {h.orders} commandes</span>
                  </TD>
                  <TD className="text-subtle">{h.meanIntervalDays} j</TD>
                  <TD className="tabular text-right">{formatQty(dec(h.avgQtyPerOrder).toDecimalPlaces(0))}</TD>
                  <TD className="tabular text-right font-medium">{formatQty(h.suggestedQty)}</TD>
                  <TD>{h.nextExpected ? <span className={h.dueSoon ? "font-medium text-warning" : "text-subtle"}>{formatRelative(h.nextExpected)}</span> : TBC}</TD>
                  <TD>{h.product ? <Badge tone={AVAILABILITY[h.product.availability]?.tone ?? "neutral"}>{AVAILABILITY[h.product.availability]?.label}</Badge> : null}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Puzzle className="size-4 text-primary" /> Produits complémentaires</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {growth.complementary.length === 0 ? <p className="text-[13px] text-subtle">Aucune recommandation pour l&apos;instant.</p> : null}
            {growth.complementary.map((p) => (
              <Link key={p.id} href={`/produits/${p.id}`} className="block text-[13px] hover:text-primary">
                <span className="font-medium">{p.name}</span> <span className="text-[11.5px] text-faint">{p.reference} · {p.sale_price_ht ? formatMoney(p.sale_price_ht) : "prix à confirmer"}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Nouveautés recommandées</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {growth.newProducts.length === 0 ? <p className="text-[13px] text-subtle">Aucune nouveauté adaptée à ses catégories.</p> : null}
            {growth.newProducts.map((p) => (
              <Link key={p.id} href={`/produits/${p.id}`} className="block text-[13px] hover:text-primary">
                <span className="font-medium">{p.name}</span> <span className="text-[11.5px] text-faint">{p.reference} · {p.sale_price_ht ? formatMoney(p.sale_price_ht) : "prix à confirmer"}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CalendarClock className="size-4 text-primary" /> Rendez-vous</CardTitle>
          </CardHeader>
          <CardContent>
            <KeyValue label="Dernier rendez-vous">{growth.lastMeeting ? `${formatDate(growth.lastMeeting.starts_at)} · ${MEETING_KIND[growth.lastMeeting.kind] ?? growth.lastMeeting.kind}` : TBC}</KeyValue>
            <KeyValue label="Prochain rendez-vous">{growth.nextMeeting ? `${formatDate(growth.nextMeeting.starts_at)} · ${MEETING_KIND[growth.nextMeeting.kind] ?? growth.nextMeeting.kind}` : "Aucun planifié"}</KeyValue>
            {writable ? (
              <div className="mt-3">
                <ActionButton size="sm" variant={doNotSolicit ? "secondary" : "danger"} action={setDoNotSolicitAction.bind(null, customerId, !doNotSolicit)}
                  confirm={doNotSolicit ? undefined : "Le client ne souhaite plus être sollicité ? LÉA ne lui enverra plus rien de sa propre initiative."}>
                  {doNotSolicit ? "Réautoriser les sollicitations" : "Ne plus solliciter ce client"}
                </ActionButton>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
