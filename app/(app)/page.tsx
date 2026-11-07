import Link from "next/link";
import { ArrowRight, ChevronRight, Sparkles, Check } from "lucide-react";
import { db } from "@/lib/auth/context";
import { getHomeData } from "@/features/dashboard/home";
import { formatMoney, dec } from "@/lib/money";
import { toIsoDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { ActionButton } from "@/components/app/action-button";
import { LeaAvatar } from "@/components/app/lea-avatar";
import { AreaChart, Donut } from "@/components/app/charts";
import { runAutopilotAction } from "@/app/actions/commercial";
import { canManage } from "@/lib/auth/roles";

export const metadata = { title: "Accueil" };

const ACTION_TONE: Record<string, string> = {
  Réactiver: "bg-danger-soft text-danger",
  Réassort: "bg-success-soft text-success",
  Compléter: "bg-info-soft text-info",
  Nouveautés: "bg-primary-soft text-primary",
  "Rendez-vous": "bg-warning-soft text-warning",
  Accélérer: "bg-primary-soft text-primary",
  Relancer: "bg-muted text-foreground/80",
};


const REPARTITION = {
  permanents: { label: "Permanents", color: "var(--chart-1)" },
  news: { label: "Nouveautés", color: "var(--chart-2)" },
  complementary: { label: "Complémentaires", color: "var(--chart-3)" },
  others: { label: "Autres", color: "var(--chart-4)" },
} as const;

function greeting() {
  const h = Number(new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hour12: false, timeZone: "Europe/Paris" }).format(new Date()));
  return h < 18 ? "Bonjour" : "Bonsoir";
}

function initials(name: string) {
  return name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

function Kpi({ label, value, children, href }: { label: string; value: React.ReactNode; children?: React.ReactNode; href?: string }) {
  const body = (
    <div className="h-full rounded-2xl border border-border bg-surface p-5 shadow-card transition-colors hover:border-border-strong">
      <p className="text-[13px] font-medium text-subtle">{label}</p>
      <p className="tabular mt-2 text-[26px] font-bold tracking-tight">{value}</p>
      <div className="mt-1.5 text-[12.5px] text-subtle">{children}</div>
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export default async function HomePage() {
  const { home, ctx } = await db(async (d, ctx) => ({ home: await getHomeData(d, ctx.org.organizationId, toIsoDate(new Date())), ctx }));
  const firstName = (ctx.displayName ?? "").split(" ")[0];
  const hasData = home.evolution.some((e) => dec(e.ht).gt(0)) || home.clients.active > 0;
  const b = home.brief;
  const o = b.objectives;
  const yearPct = o.annualTargetHt && dec(o.annualTargetHt).gt(0) ? Number(dec(o.realizedYtdHt).dividedBy(o.annualTargetHt).times(100).toFixed(0)) : null;
  const monthFmt = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[15px] font-medium text-subtle">
          {greeting()}
          {firstName ? ` ${firstName}` : ""} 👋
        </p>
        <h1 className="mt-1 max-w-3xl text-[28px] font-bold leading-tight tracking-tight" data-testid="brief-headline">
          Voici ce que <span className="text-primary">LÉA</span> a préparé aujourd&apos;hui pour développer votre chiffre d&apos;affaires.
        </h1>
        <p className="mt-2 max-w-3xl text-[14px] text-subtle">
          J&apos;ai analysé votre portefeuille : {b.behind.total} client{b.behind.total > 1 ? "s" : ""} en retard sur {b.behind.total > 1 ? "leurs" : "son"} objectif, {b.reorders.total} réassort{b.reorders.total > 1 ? "s" : ""} à sécuriser,{" "}
          {b.news.total} présentation{b.news.total > 1 ? "s" : ""} de nouveautés, {b.dormants.total} client{b.dormants.total > 1 ? "s" : ""} à réactiver.{" "}
          {b.offersPrepared.total ? `${b.offersPrepared.total} offre${b.offersPrepared.total > 1 ? "s" : ""} préparée${b.offersPrepared.total > 1 ? "s" : ""} aujourd'hui. ` : ""}
          <Link href="/actions" className="font-medium text-primary hover:underline">{b.decisions.total} décision{b.decisions.total > 1 ? "s" : ""} à valider</Link>.
          {b.source === "live" ? <span className="text-faint"> (calculé à l&apos;instant — la tournée quotidienne de LÉA n&apos;a pas encore tourné aujourd&apos;hui)</span> : null}
        </p>
      </div>

      {!hasData ? (
        <EmptyState
          title="Importez vos factures pour réveiller LÉA"
          description="LÉA calcule les réassorts, les clients inactifs et les opportunités à partir de vos factures détaillées. Aucune métrique n'est affichée tant qu'aucune donnée réelle n'est disponible."
          action={<Button asChild><Link href="/parametres/imports">Importer des données</Link></Button>}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5" data-testid="objectives">
        <Kpi label="Objectif annuel" value={o.annualTargetHt ? formatMoney(o.realizedYtdHt, "EUR", { compact: true }) : "À confirmer"}>
          {o.annualTargetHt ? (
            <div>
              <div className="flex justify-between gap-2">
                <span>sur {formatMoney(o.annualTargetHt, "EUR", { compact: true })}{o.explicit ? "" : ` · ${o.customersWithTarget} client(s)`}</span>
                <span className="font-semibold text-foreground">{yearPct ?? "—"} %</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={yearPct ?? 0} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, yearPct ?? 0)}%` }} />
              </div>
            </div>
          ) : <span>Fixez l&apos;objectif dans Paramètres ou sur les fiches clients</span>}
        </Kpi>
        <Kpi label="Objectif du mois" value={o.monthTargetHt ? formatMoney(o.realizedMonthHt, "EUR", { compact: true }) : "À confirmer"}>
          {o.monthTargetHt ? <span>sur {formatMoney(o.monthTargetHt, "EUR", { compact: true })} ({o.monthTargetSource === "manual" ? "saisi" : o.monthTargetSource === "seasonality" ? "réparti selon la saisonnalité N-1" : "réparti à parts égales"})</span> : <span>CA du mois : {formatMoney(o.realizedMonthHt, "EUR", { compact: true })}</span>}
        </Kpi>
        <Kpi label="Écart à l'objectif à date" value={o.gapToDateHt ? `${dec(o.gapToDateHt).gt(0) ? "+" : ""}${formatMoney(o.gapToDateHt, "EUR", { compact: true })}` : "À confirmer"}>
          {o.attainmentToDatePct !== null ? (
            <span className={o.status === "behind" ? "font-medium text-danger" : o.status === "ahead" ? "font-medium text-success" : ""}>
              {o.attainmentToDatePct.toLocaleString("fr-FR")} % de l&apos;attendu à date{o.status === "behind" ? " · en retard" : o.status === "ahead" ? " · en avance" : ""}
            </span>
          ) : <span>Sans objectif, pas d&apos;écart calculable</span>}
        </Kpi>
        <Kpi label="Prévision de fin d'année" value={o.forecastHt ? formatMoney(o.forecastHt, "EUR", { compact: true }) : "À confirmer"}>
          <span>{o.forecastHt ? "Projection au rythme constaté (estimation)" : "Trop tôt ou objectif absent"}</span>
        </Kpi>
        <Kpi label="CA attribuable à LÉA (90 j)" value={formatMoney(b.attributableHt, "EUR", { compact: true })} href="/rapports">
          <span>Factures des produits proposés, 45 j après l&apos;offre</span>
        </Kpi>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="brief">
        {([
          ["Clients en retard sur leurs objectifs", b.behind, "/opportunites?mission=targets", "Plan d'accélération et offre de développement préparés"],
          ["Réassorts à sécuriser", b.reorders, "/opportunites?mission=permanents", "Quantités calculées sur le rythme d'achat"],
          ["Nouveautés à présenter", b.news, "/opportunites?mission=new_products", "Sélection personnalisée par client"],
          ["Clients à réactiver", b.dormants, "/opportunites?mission=reactivation", "Inactivité comparée à leur propre fréquence"],
          ["Rendez-vous à obtenir", b.meetings, "/opportunites?mission=meetings", "Visio, téléphone ou showroom"],
          ["Offres préparées aujourd'hui", b.offersPrepared, "/offres", "Avec supports (PDF, Excel illustré, catalogue)"],
        ] as const).map(([title, block, href, hint]) => (
          <Card key={title}>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <Link href={href} className="tabular text-[18px] font-bold text-primary hover:underline">{block.total}</Link>
            </CardHeader>
            <CardContent className="space-y-1 px-3 pb-3">
              <p className="px-2 text-[12px] text-faint">{hint}</p>
              {block.items.length === 0 ? <p className="px-2 py-2 text-[13px] text-subtle">Rien aujourd&apos;hui.</p> : null}
              {block.items.slice(0, 3).map((it, k) => (
                <Link key={`${it.customerId}-${k}`} href={it.href} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-muted">
                  <span className="min-w-0"><span className="block truncate font-medium">{it.customer}</span><span className="block truncate text-[11.5px] text-subtle">{it.detail}</span></span>
                  {it.valueHt ? <span className="tabular shrink-0 text-[12.5px] font-semibold">{formatMoney(it.valueHt, "EUR", { compact: true })}</span> : null}
                </Link>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader>
            <CardTitle>Les priorités de LÉA aujourd&apos;hui</CardTitle>
            <Link href="/opportunites" className="text-[13px] font-medium text-primary hover:underline">Tout voir</Link>
          </CardHeader>
          <CardContent className="space-y-1 px-3 pb-3">
            {home.priorities.length === 0 ? <p className="px-2 py-6 text-center text-sm text-subtle">Rien à signaler aujourd&apos;hui.</p> : null}
            {home.priorities.map((p) => (
              <Link key={p.id} href={`/clients/${p.customerId}`} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-muted" data-testid="opportunity">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-[12.5px] font-bold text-primary">{initials(p.customerName)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{p.customerName}</span>
                  <span className="block truncate text-[12.5px] text-subtle">{p.subtitle}</span>
                </span>
                <span className={`hidden rounded-full px-2.5 py-0.5 sm:inline text-[12px] font-medium ${ACTION_TONE[p.action] ?? "bg-muted"}`}>{p.action}</span>
                <span className="tabular shrink-0 text-right text-[14px] font-semibold sm:w-24">
                  {p.valueHt ? `+ ${formatMoney(p.valueHt, "EUR", { compact: true })}` : <span className="text-[12px] font-medium text-subtle">À confirmer</span>}
                </span>
                <ChevronRight className="size-4 text-faint" />
              </Link>
            ))}
          </CardContent>
        </Card>

        <div className="lea-hero relative overflow-hidden rounded-2xl border border-primary/15 p-6 shadow-card">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[19px] font-bold leading-snug">LÉA travaille pour vous, chaque jour.</p>
              <ul className="mt-4 space-y-2.5 text-[13.5px]">
                {["Analyse vos factures et vos clients", "Détecte les opportunités de vente", "Prépare les offres et les messages", "Relance par e-mail et WhatsApp", "Répond aux clients et vous transmet le reste"].map((t) => (
                  <li key={t} className="flex items-center gap-2.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-white"><Check className="size-3" strokeWidth={3} /></span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <LeaAvatar size={112} className="shrink-0" />
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {canManage(ctx.org.role) && !home.leaPaused ? (
              <ActionButton variant="lea" action={runAutopilotAction} pendingLabel="LÉA travaille…">
                <Sparkles /> Lancer LÉA maintenant
              </ActionButton>
            ) : null}
            <Button asChild variant="ghost" size="sm">
              <Link href="/actions">Voir son activité <ArrowRight /></Link>
            </Button>
          </div>
        </div>
      </div>

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
              points={home.evolution.map((e, i) => ({
                label: monthFmt.format(new Date(`${e.month}-01T00:00:00Z`)).replace(".", "") + (i === home.evolution.length - 1 ? " (en cours)" : ""),
                value: dec(e.ht).toNumber(),
                display: formatMoney(e.ht, "EUR", { compact: true }),
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Répartition du CA</CardTitle>
            <span className="text-[12px] text-faint">12 derniers mois · {formatMoney(home.repartitionTotalHt, "EUR", { compact: true })}</span>
          </CardHeader>
          <CardContent>
            <Donut
              ariaLabel="Répartition du chiffre d'affaires par catégorie"
              centerLabel={formatMoney(home.repartitionTotalHt, "EUR", { compact: true })}
              segments={home.repartition.map((r) => ({ label: REPARTITION[r.key].label, color: REPARTITION[r.key].color, pct: r.pct, display: formatMoney(r.ht, "EUR", { compact: true }) }))}
            />
            <p className="mt-4 text-[11.5px] leading-relaxed text-faint">
              Permanents : produits achetés au moins 3 fois par le client. Complémentaires : autres produits commandés avec un permanent. Nouveautés : produits marqués nouveaux.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
