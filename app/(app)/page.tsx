import Link from "next/link";
import { ArrowRight, Inbox, CheckCircle2, CalendarClock, Clock, Sparkles } from "lucide-react";
import { db } from "@/lib/auth/context";
import { getDashboard } from "@/features/dashboard/queries";
import { formatMoney, dec } from "@/lib/money";
import { formatRelative, toIsoDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LeaMark, Stat } from "@/components/ui/misc";
import { ActionButton } from "@/components/app/action-button";
import { OPPORTUNITY_LABEL } from "@/components/app/labels";
import { createOfferFromOpportunityAction, dismissOpportunityAction, runScanAction } from "@/app/actions/commercial";
import { canWrite } from "@/lib/auth/roles";

export const metadata = { title: "Accueil" };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hour12: false, timeZone: "Europe/Paris" }).format(new Date()));
  return h < 18 ? "Bonjour" : "Bonsoir";
}

export default async function HomePage() {
  const { data, ctx } = await db(async (d, ctx) => ({ data: await getDashboard(d, ctx.org.organizationId, toIsoDate(new Date())), ctx }));
  const writable = canWrite(ctx.org.role);
  const firstName = (ctx.displayName ?? "").split(" ")[0];

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-faint">{new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" }).format(new Date())}</p>
          <h1 className="mt-0.5 text-[26px] font-semibold tracking-tight">
            {greeting()}
            {firstName ? ` ${firstName}` : ""}.
          </h1>
          <p className="mt-1 text-sm text-subtle">
            {data.stats.openOpportunities > 0
              ? `LÉA a identifié ${data.stats.openOpportunities} opportunité${data.stats.openOpportunities > 1 ? "s" : ""} — voici les plus prioritaires. ${data.approvalCount} élément${data.approvalCount > 1 ? "s" : ""} attend${data.approvalCount > 1 ? "ent" : ""} votre validation.`
              : "Aucune opportunité ouverte pour l'instant."}
          </p>
        </div>
        {writable ? (
          <ActionButton variant="secondary" action={runScanAction} pendingLabel="Analyse en cours…">
            <Sparkles /> Relancer l&apos;analyse
          </ActionButton>
        ) : null}
      </div>

      {!data.hasInvoices ? (
        <EmptyState
          title="Importez vos factures pour réveiller LÉA"
          description="LÉA calcule les réassorts, les clients dormants et les opportunités à partir de vos factures détaillées. Aucune métrique n'est affichée tant qu'aucune donnée réelle n'est disponible."
          action={<Button asChild><Link href="/parametres/imports">Importer des données</Link></Button>}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Potentiel estimé" value={data.stats.potentialHt ? formatMoney(data.stats.potentialHt, "EUR", { compact: true }) : "—"} hint="Réassorts et offres en cours · estimation, pas une commande" tone="primary" />
        <Stat label="Opportunités ouvertes" value={data.stats.openOpportunities} hint={`${data.stats.reorderCount} réassorts · ${data.stats.dormantCount} clients dormants`} />
        <Stat label="Offres préparées" value={data.offers.prepared} hint={`${data.offers.sent_month} envoyée(s) ce mois · ${data.offers.in_negotiation} en négociation`} href="/offres" />
        <Stat label="Résultat du mois" value={formatMoney(data.results.wonAmountHt, "EUR", { compact: true })} hint={`${data.results.orderRequests} demande(s) de commande`} tone="success" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <LeaMark size={22} />
              <CardTitle>Opportunités du jour</CardTitle>
            </div>
            <span className="text-[12px] text-faint">Classées par priorité</span>
          </CardHeader>
          <CardContent className="space-y-2.5 px-3 pb-3">
            {data.opportunities.length === 0 ? <p className="px-2 py-6 text-center text-sm text-subtle">Rien à signaler aujourd&apos;hui.</p> : null}
            {data.opportunities.map((o) => (
              <div key={o.id} className="rounded-lg border border-border px-4 py-3.5 transition-colors hover:border-border-strong" data-testid="opportunity">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/clients/${o.customerId}`} className="text-[14px] font-semibold hover:text-primary">
                        {o.customerName}
                      </Link>
                      <Badge tone="primary">{OPPORTUNITY_LABEL[o.type] ?? o.type}</Badge>
                      {o.status === "in_progress" ? <Badge tone="info">Offre en cours</Badge> : null}
                    </div>
                    <p className="mt-1 text-[13.5px] font-medium">« {o.title} »</p>
                    <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-subtle">{o.justification}</p>
                  </div>
                  <div className="text-right">
                    <p className="tabular text-[15px] font-semibold">{o.estimatedValueHt ? formatMoney(o.estimatedValueHt, "EUR", { compact: true }) : "—"}</p>
                    <p className="text-[11px] text-faint">{o.estimatedValueHt ? "potentiel estimé HT" : "potentiel non estimé"}</p>
                    <p className="mt-1 text-[11px] text-faint">Confiance {Math.round(dec(o.confidence).toNumber() * 100)} %</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/clients/${o.customerId}`}>Voir le client</Link>
                  </Button>
                  {o.offerId ? (
                    <Button asChild variant="soft" size="sm">
                      <Link href={`/offres/${o.offerId}`}>
                        Voir l&apos;offre <ArrowRight />
                      </Link>
                    </Button>
                  ) : writable && ["reorder", "dormant_customer", "new_product", "cross_sell", "campaign"].includes(o.type) ? (
                    <ActionButton size="sm" action={createOfferFromOpportunityAction.bind(null, o.id)} pendingLabel="LÉA prépare l'offre…">
                      Préparer l&apos;offre <ArrowRight />
                    </ActionButton>
                  ) : null}
                  {writable && !o.offerId ? (
                    <ActionButton size="sm" variant="ghost" action={dismissOpportunityAction.bind(null, o.id)}>
                      Ignorer
                    </ActionButton>
                  ) : null}
                  <span className="ml-auto text-[12px] text-faint">{o.recommendedAction}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card id="validations">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-warning" /> Validations en attente
              </CardTitle>
              <Badge tone={data.approvalCount ? "warning" : "neutral"}>{data.approvalCount}</Badge>
            </CardHeader>
            <CardContent className="space-y-1 px-3">
              {data.approvals.length === 0 ? <p className="px-2 py-2 text-[13px] text-subtle">Tout est à jour.</p> : null}
              {data.approvals.map((a) => (
                <Link
                  key={a.id}
                  href={a.offer_id ? `/offres/${a.offer_id}` : a.conversation_id ? `/conversations/${a.conversation_id}` : "/"}
                  className="flex items-center gap-2 rounded-md px-2 py-2 text-[13px] hover:bg-muted"
                >
                  <Badge tone={a.subject_type === "discount" ? "danger" : a.subject_type === "offer" ? "info" : "primary"}>
                    {a.subject_type === "offer" ? "Offre" : a.subject_type === "discount" ? "Remise" : "Message"}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate">{a.summary}</span>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Inbox className="size-4 text-primary" /> Réponses à traiter
              </CardTitle>
              <Badge tone={data.replies.length ? "primary" : "neutral"}>{data.replies.length}</Badge>
            </CardHeader>
            <CardContent className="space-y-1 px-3">
              {data.replies.length === 0 ? <p className="px-2 py-2 text-[13px] text-subtle">Aucune réponse en attente.</p> : null}
              {data.replies.map((r) => (
                <Link key={r.id} href={`/conversations/${r.conversation_id}`} className="block rounded-md px-2 py-2 text-[13px] hover:bg-muted">
                  <span className="font-medium">{r.customer_name ?? r.from_address}</span>
                  <span className="block truncate text-[12px] text-subtle">{r.subject}</span>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="size-4 text-subtle" /> Relances & tâches
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 px-3">
              {data.tasks.length === 0 ? <p className="px-2 py-2 text-[13px] text-subtle">Aucune tâche imminente.</p> : null}
              {data.tasks.map((t) => (
                <Link key={t.id} href={t.customer_id ? `/clients/${t.customer_id}` : "/"} className="flex items-center justify-between gap-2 rounded-md px-2 py-2 text-[13px] hover:bg-muted">
                  <span className="min-w-0 truncate">{t.title}</span>
                  <span className="shrink-0 text-[11px] text-faint">{formatRelative(t.due_at)}</span>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="size-4 text-subtle" /> Rendez-vous
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5">
              {data.appointments.length === 0 ? <p className="text-[13px] text-subtle">Aucun rendez-vous planifié.</p> : null}
              {data.appointments.map((a) => (
                <p key={a.id} className="py-1 text-[13px]">
                  {a.customer_name} · {formatRelative(a.starts_at)}
                </p>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
