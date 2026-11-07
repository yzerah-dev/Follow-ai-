import { db } from "@/lib/auth/context";
import { getDashboard } from "@/features/dashboard/queries";
import { getHomeData } from "@/features/dashboard/home";
import { getLeaPerformance, ATTRIBUTION_WINDOW_DAYS } from "@/features/dashboard/performance";
import { MISSION_LABEL } from "@/features/opportunities/missions";
import { formatMoney, dec, D } from "@/lib/money";
import { toIsoDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Donut } from "@/components/app/charts";

export const metadata = { title: "Rapports" };

const REPARTITION = {
  permanents: { label: "Permanents", color: "var(--chart-1)" },
  news: { label: "Nouveautés", color: "var(--chart-2)" },
  complementary: { label: "Complémentaires", color: "var(--chart-3)" },
  others: { label: "Autres", color: "var(--chart-4)" },
} as const;

export default async function ReportsPage() {
  const today = toIsoDate(new Date());
  const { dash, home, perf } = await db(async (d, ctx) => ({
    dash: await getDashboard(d, ctx.org.organizationId, today),
    home: await getHomeData(d, ctx.org.organizationId, today),
    perf: await getLeaPerformance(d, ctx.org.organizationId, 90),
  }));
  const attributable = perf.reduce((a, m) => a.plus(dec(m.invoicedHt)), new D(0));
  const monthFmt = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });

  const kpis: [string, string, string][] = [
    ["Offres envoyées (mois)", String(dash.offers.sent_month), `${dash.offers.prepared} préparée(s) · ${dash.offers.in_negotiation} en négociation`],
    ["Commandes du mois", formatMoney(dash.results.wonAmountHt, "EUR", { compact: true }), `${dash.results.orderRequests} demande(s) de commande`],
    ["CA attribuable à LÉA (90 j)", formatMoney(attributable.toFixed(2), "EUR", { compact: true }), `factures ${ATTRIBUTION_WINDOW_DAYS} j après l'offre, plafonnées`],
    ["Potentiel ouvert", dash.stats.potentialHt ? formatMoney(dash.stats.potentialHt, "EUR", { compact: true }) : "—", `${dash.stats.openOpportunities} opportunité(s) · estimation, pas une commande`],
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">Rapports</h1>
        <p className="mt-1 text-sm text-subtle">Les résultats de LÉA et l&apos;évolution de vos ventes, calculés à partir de vos factures et de vos offres.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map(([label, value, hint]) => (
          <div key={label} className="rounded-2xl border border-border bg-surface p-5 shadow-card">
            <p className="text-[13px] font-medium text-subtle">{label}</p>
            <p className="tabular mt-2 text-[26px] font-bold tracking-tight">{value}</p>
            <p className="mt-1.5 text-[12.5px] text-subtle">{hint}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Résultats de LÉA par mission (90 jours)</CardTitle>
          <span className="text-[12px] text-faint">CA attribuable : factures des produits proposés, {ATTRIBUTION_WINDOW_DAYS} jours après l&apos;envoi, plafonné à l&apos;offre</span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" data-testid="lea-performance">
            <thead className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
              <tr>
                <th className="px-5 py-2 font-medium">Mission</th>
                <th className="px-3 py-2 text-right font-medium">Détectées</th>
                <th className="px-3 py-2 text-right font-medium">Traitées</th>
                <th className="px-3 py-2 text-right font-medium">Offres envoyées</th>
                <th className="px-3 py-2 text-right font-medium">Conversion</th>
                <th className="px-3 py-2 text-right font-medium">Commandes HT</th>
                <th className="px-5 py-2 text-right font-medium">CA facturé attribuable</th>
              </tr>
            </thead>
            <tbody>
              {perf.map((m) => (
                <tr key={m.mission} className="border-b border-border/70 last:border-0">
                  <td className="px-5 py-2.5 font-medium">{MISSION_LABEL[m.mission]}</td>
                  <td className="tabular px-3 py-2.5 text-right">{m.detected}</td>
                  <td className="tabular px-3 py-2.5 text-right">{m.actioned}</td>
                  <td className="tabular px-3 py-2.5 text-right">{m.offersSent}</td>
                  <td className="tabular px-3 py-2.5 text-right">{m.conversionPct === null ? "—" : `${m.conversionPct.toLocaleString("fr-FR")} %`}</td>
                  <td className="tabular px-3 py-2.5 text-right">{formatMoney(m.ordersHt, "EUR", { compact: true })}</td>
                  <td className="tabular px-5 py-2.5 text-right">{formatMoney(m.invoicedHt, "EUR", { compact: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Évolution du CA</CardTitle>
            <span className="text-[12px] text-faint">CA facturé net HT · 6 derniers mois · mois en cours en pointillés</span>
          </CardHeader>
          <CardContent>
            <AreaChart
              ariaLabel="Évolution du chiffre d'affaires facturé sur 6 mois"
              partialLast
              points={home.evolution.map((e, i) => ({ label: monthFmt.format(new Date(`${e.month}-01T00:00:00Z`)).replace(".", "") + (i === home.evolution.length - 1 ? " (en cours)" : ""), value: dec(e.ht).toNumber(), display: formatMoney(e.ht, "EUR", { compact: true }) }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Répartition du CA</CardTitle>
            <span className="text-[12px] text-faint">12 derniers mois</span>
          </CardHeader>
          <CardContent>
            <Donut
              ariaLabel="Répartition du chiffre d'affaires par catégorie"
              centerLabel={formatMoney(home.repartitionTotalHt, "EUR", { compact: true })}
              segments={home.repartition.map((r) => ({ label: REPARTITION[r.key].label, color: REPARTITION[r.key].color, pct: r.pct, display: formatMoney(r.ht, "EUR", { compact: true }) }))}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
