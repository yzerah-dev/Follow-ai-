import Link from "next/link";
import { Inbox, CheckCircle2, CalendarClock, Clock, Sparkles } from "lucide-react";
import { db } from "@/lib/auth/context";
import { getDashboard } from "@/features/dashboard/queries";
import { formatDate, formatRelative, toIsoDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LeaMark } from "@/components/ui/misc";
import { ActionButton } from "@/components/app/action-button";
import { OpportunityCard } from "@/components/app/opportunity-card";
import { runScanAction, runAutopilotAction } from "@/app/actions/commercial";
import { canWrite, canManage } from "@/lib/auth/roles";

export const metadata = { title: "Actions" };

export default async function ActionsPage() {
  const { data, ctx } = await db(async (d, ctx) => ({
    data: await getDashboard(d, ctx.org.organizationId, toIsoDate(new Date())),
    ctx,
  }));
  const writable = canWrite(ctx.org.role);

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Actions</h1>
          <p className="mt-1 text-sm text-subtle">
            {`${data.approvalCount} élément${data.approvalCount > 1 ? "s" : ""} à valider · ${data.replies.length} réponse(s) client · ${data.tasks.length} tâche(s) à échéance · ${data.stats.openOpportunities} opportunité(s) ouverte(s).`}
          </p>
        </div>
        {writable ? (
          <ActionButton variant="secondary" action={runScanAction} pendingLabel="Analyse en cours…">
            <Sparkles /> Relancer l&apos;analyse
          </ActionButton>
        ) : null}
      </div>

      <Card className={data.autonomy.paused ? "border-danger/30" : data.autonomy.level !== "supervised" ? "border-primary/25" : ""}>
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <LeaMark size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[14px] font-semibold">LÉA au travail</p>
              {data.autonomy.paused ? <Badge tone="danger">Suspendue</Badge> : data.autonomy.level === "autonomous" ? <Badge tone="success">Autonome</Badge> : data.autonomy.level === "semi_autonomous" ? <Badge tone="info">Semi-autonome</Badge> : <Badge>Supervisé</Badge>}
            </div>
            <p className="mt-0.5 text-[13px] text-subtle">
              {data.autonomy.level === "supervised" || data.autonomy.paused
                ? "LÉA prépare offres et messages ; rien ne part sans votre validation."
                : `Aujourd'hui : ${data.autonomy.sentToday} envoi(s) automatique(s) · ${data.autonomy.scheduled} programmé(s) · ${data.autonomy.escalations} dossier(s) transféré(s) au commercial.`}
            </p>
          </div>
          {canManage(ctx.org.role) && !data.autonomy.paused ? (
            <ActionButton variant="lea" action={runAutopilotAction} pendingLabel="LÉA travaille…">
              <Sparkles /> Lancer LÉA maintenant
            </ActionButton>
          ) : null}
          <Button asChild variant="ghost" size="sm">
            <Link href="/parametres#autonomie">Régler</Link>
          </Button>
        </div>
        {data.activity.length ? (
          <div className="border-t border-border px-5 py-3">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Dernières actions de LÉA</p>
            <ul className="space-y-1">
              {data.activity.map((a) => (
                <li key={a.id} className="flex items-start gap-2 text-[12.5px]" data-testid="lea-activity">
                  {(() => {
                    // Libellé selon le statut RÉEL du message (envoyé, programmé, en attente).
                    const what = a.decision_type === "auto_send" ? "Offre" : a.decision_type === "auto_reply" ? "Réponse" : a.decision_type === "auto_followup" ? "Relance" : null;
                    if (!what) return <Badge tone="warning">{a.decision_type === "escalation" ? "Transféré" : "À valider"}</Badge>;
                    if (a.message_status === "approved" && a.scheduled_at)
                      return <Badge tone="info">{what} programmée {formatDate(a.scheduled_at, { weekday: "short", hour: "2-digit", minute: "2-digit" })}</Badge>;
                    if (a.message_status === "sent" || a.message_status === "simulated_sent") return <Badge tone="success">{what} envoyée</Badge>;
                    return <Badge tone="warning">{what} — {a.message_status ?? "statut inconnu"}</Badge>;
                  })()}
                  {a.conversation_id ? (
                    <Link href={`/conversations/${a.conversation_id}`} className="font-medium hover:text-primary">{a.customer_name ?? "Client"}</Link>
                  ) : (
                    <span className="font-medium">{a.customer_name ?? "Client"}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-subtle">{a.rationale}</span>
                  <span className="shrink-0 text-faint">{formatRelative(a.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {!data.hasInvoices ? (
        <EmptyState
          title="Importez vos factures pour réveiller LÉA"
          description="LÉA calcule les réassorts, les clients dormants et les opportunités à partir de vos factures détaillées. Aucune métrique n'est affichée tant qu'aucune donnée réelle n'est disponible."
          action={<Button asChild><Link href="/parametres/imports">Importer des données</Link></Button>}
        />
      ) : null}


      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <LeaMark size={22} />
              <CardTitle>Opportunités à traiter</CardTitle>
            </div>
            <span className="text-[12px] text-faint">Potentiel × urgence × probabilité de conversion</span>
          </CardHeader>
          <CardContent className="space-y-2.5 px-3 pb-3">
            {data.opportunities.length === 0 ? <p className="px-2 py-6 text-center text-sm text-subtle">Rien à signaler aujourd&apos;hui.</p> : null}
            {data.opportunities.map((o) => (
              <OpportunityCard key={o.id} o={o} writable={writable} />
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
