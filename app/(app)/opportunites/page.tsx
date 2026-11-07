import Link from "next/link";
import { Sparkles } from "lucide-react";
import { db } from "@/lib/auth/context";
import { listOpportunities } from "@/features/dashboard/queries";
import { MISSIONS, MISSION_LABEL, type Mission } from "@/features/opportunities/missions";
import { canWrite } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import { ActionButton } from "@/components/app/action-button";
import { OpportunityCard } from "@/components/app/opportunity-card";
import { runScanAction } from "@/app/actions/commercial";

export const metadata = { title: "Opportunités" };

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ mission?: string }> }) {
  const sp = await searchParams;
  const mission = (MISSIONS as readonly string[]).includes(sp.mission ?? "") ? (sp.mission as Mission) : undefined;
  const { opps, ctx } = await db(async (d, ctx) => ({ opps: await listOpportunities(d, ctx.org.organizationId, { mission }), ctx }));
  const writable = canWrite(ctx.org.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Opportunités</h1>
          <p className="mt-1 text-sm text-subtle">
            {opps.length} opportunité{opps.length > 1 ? "s" : ""} {mission ? `· ${MISSION_LABEL[mission]}` : "ouverte(s)"} — classées par potentiel × urgence × probabilité.
          </p>
        </div>
        {writable ? (
          <ActionButton variant="secondary" action={runScanAction} pendingLabel="Analyse en cours…">
            <Sparkles /> Relancer l&apos;analyse
          </ActionButton>
        ) : null}
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Filtrer par mission">
        {[undefined, ...MISSIONS].map((m) => (
          <Link
            key={m ?? "all"}
            href={m ? `/opportunites?mission=${m}` : "/opportunites"}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              m === mission ? "border-primary bg-primary text-white" : "border-border bg-surface text-foreground/80 hover:bg-muted",
            )}
            aria-current={m === mission ? "page" : undefined}
          >
            {m ? MISSION_LABEL[m] : "Toutes"}
          </Link>
        ))}
      </nav>

      <div className="space-y-2.5">
        {opps.length === 0 ? <p className="rounded-2xl border border-border bg-surface px-4 py-10 text-center text-sm text-subtle">Aucune opportunité ouverte pour cette mission.</p> : null}
        {opps.map((o) => (
          <div key={o.id} className="rounded-2xl bg-surface shadow-card">
            <OpportunityCard o={o} writable={writable} />
          </div>
        ))}
      </div>
    </div>
  );
}
