import Link from "next/link";
import { ArrowRight, ChevronRight, Sparkles, Check, RefreshCw, Repeat, PackagePlus, Star, CalendarDays, Target, TrendingUp, TrendingDown } from "lucide-react";
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

const MISSION_TILES = [
  { key: "reactivation", label: "Réactiver", hint: "les clients inactifs", icon: RefreshCw },
  { key: "permanents", label: "Réassort", hint: "des produits permanents", icon: Repeat },
  { key: "complementary", label: "Compléter", hint: "les gammes & retours en stock", icon: PackagePlus },
  { key: "new_products", label: "Nouveautés", hint: "proposer les nouveaux produits", icon: Star },
  { key: "meetings", label: "Rendez-vous", hint: "planifier les visites", icon: CalendarDays },
  { key: "targets", label: "Objectifs", hint: "suivre les objectifs de CA", icon: Target },
] as const;

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
  const targetPct = home.target && dec(home.target.totalHt).gt(0) ? Number(dec(home.target.realizedHt).dividedBy(home.target.totalHt).times(100).toFixed(0)) : null;
  const monthFmt = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[15px] font-medium text-subtle">
          {greeting()}
          {firstName ? ` ${firstName}` : ""} 👋
        </p>
        <h1 className="mt-1 text-[30px] font-bold tracking-tight">
          <span className="text-primary">LÉA</span> fait avancer vos ventes
        </h1>
        <p className="mt-1 text-[14px] text-subtle">Vos clients sont suivis, relancés et développés chaque jour.</p>
      </div>

      {!hasData ? (
        <EmptyState
          title="Importez vos factures pour réveiller LÉA"
          description="LÉA calcule les réassorts, les clients inactifs et les opportunités à partir de vos factures détaillées. Aucune métrique n'est affichée tant qu'aucune donnée réelle n'est disponible."
          action={<Button asChild><Link href="/parametres/imports">Importer des données</Link></Button>}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="CA facturé (mois en cours)" value={formatMoney(home.caMonth, "EUR", { compact: true })}>
          {home.caPct === null ? (
            <span>Pas de comparaison possible</span>
          ) : (
            <span>
              <span className={home.caPct >= 0 ? "inline-flex items-center gap-1 whitespace-nowrap font-semibold text-success" : "inline-flex items-center gap-1 whitespace-nowrap font-semibold text-danger"}>
                {home.caPct >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                {home.caPct > 0 ? "+" : ""}
                {home.caPct.toLocaleString("fr-FR")}&nbsp;%
              </span>{" "}
              vs même période du mois dernier
            </span>
          )}
        </Kpi>
        <Kpi label="Objectif annuel (à date)" value={home.target ? formatMoney(home.target.realizedHt, "EUR", { compact: true }) : "À confirmer"}>
          {home.target && targetPct !== null ? (
            <div>
              <div className="flex justify-between">
                <span>sur {formatMoney(home.target.totalHt, "EUR", { compact: true })} · {home.target.customers} client{home.target.customers > 1 ? "s" : ""}</span>
                <span className="font-semibold text-foreground">{targetPct} %</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={targetPct} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, targetPct)}%` }} />
              </div>
            </div>
          ) : (
            <span>Aucun objectif fixé — à définir sur les fiches clients</span>
          )}
        </Kpi>
        <Kpi label="Clients actifs (12 mois)" value={home.clients.active} href="/clients">
          <span className="font-medium text-success">+{home.clients.fresh}</span> nouveau{home.clients.fresh > 1 ? "x" : ""} (90 jours)
        </Kpi>
        <Kpi label="Actions de LÉA" value={home.todo.total} href="/actions">
          à traiter aujourd&apos;hui · {home.todo.approvals} validation{home.todo.approvals > 1 ? "s" : ""}, {home.todo.replies} réponse{home.todo.replies > 1 ? "s" : ""}
        </Kpi>
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {MISSION_TILES.map((m) => (
          <Link key={m.key} href={`/opportunites?mission=${m.key}`} className="group rounded-2xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-primary/30">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary"><m.icon className="size-5" /></span>
            <p className="mt-3 text-[14px] font-semibold group-hover:text-primary">{m.label}</p>
            <p className="text-[12px] text-subtle">{m.hint}</p>
          </Link>
        ))}
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
