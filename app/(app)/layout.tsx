import Link from "next/link";
import { Bell, CalendarDays } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { withUser } from "@/lib/database/client";
import { Sidebar, MobileNav } from "@/components/app/sidebar";
import { LeaPanel } from "@/components/app/lea-panel";
import { getLlm } from "@/lib/ai";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const counts = await withUser(ctx.userId, async (db) => {
    const r = await db.query<{ approvals: number; replies: number; opportunities: number; tasks: number; level: string; paused: boolean }>(
      `select (select count(*)::int from approvals where organization_id = $1 and status = 'pending') as approvals,
              (select count(*)::int from messages where organization_id = $1 and direction = 'inbound' and not handled) as replies,
              (select count(*)::int from opportunities where organization_id = $1 and status = 'open') as opportunities,
              (select count(*)::int from followup_tasks where organization_id = $1 and status = 'pending' and kind <> 'followup' and due_at <= now() + interval '2 days') as tasks,
              s.autonomy_level as level, s.autonomy_paused as paused
       from organization_settings s where s.organization_id = $1`,
      [ctx.org.organizationId],
    );
    return r.rows[0] ?? { approvals: 0, replies: 0, opportunities: 0, tasks: 0, level: "supervised", paused: false };
  });
  const actions = counts.approvals + counts.tasks;
  const llm = getLlm();
  const name = ctx.displayName ?? ctx.email;
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const today = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" }).format(new Date());
  return (
    <div className="flex min-h-screen">
      <Sidebar
        orgName={ctx.org.name}
        orgId={ctx.org.organizationId}
        isDemo={ctx.org.isDemo}
        memberships={ctx.memberships.map((m) => ({ id: m.organizationId, name: m.name }))}
        userName={name}
        role={ctx.org.role}
        counts={{ approvals: counts.approvals, replies: counts.replies, opportunities: counts.opportunities, actions }}
        leaStatus={counts.paused ? "paused" : (counts.level as "autonomous" | "semi_autonomous" | "supervised")}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {ctx.org.isDemo ? (
          <div className="border-b border-warning/20 bg-warning-soft px-6 py-1.5 text-center text-[12px] font-medium text-warning">
            Organisation de démonstration — toutes les données sont fictives. Aucun message n&apos;est réellement envoyé.
          </div>
        ) : null}
        <MobileNav counts={{ approvals: counts.approvals, replies: counts.replies, opportunities: counts.opportunities, actions }} />
        <header className="flex items-center justify-end gap-3 px-4 pt-5 sm:px-6 lg:px-10">
          <span className="hidden items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2 text-[13.5px] font-medium shadow-card sm:flex">
            <CalendarDays className="size-4 text-subtle" /> Aujourd&apos;hui · <span className="capitalize text-subtle">{today}</span>
          </span>
          <Link href="/actions" className="relative rounded-xl border border-border bg-surface p-2.5 shadow-card hover:bg-muted" aria-label={`Actions à traiter : ${actions + counts.replies}`}>
            <Bell className="size-[18px] text-foreground/80" />
            {actions + counts.replies > 0 ? <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" /> : null}
          </Link>
          <span className="lea-gradient flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-semibold text-white" title={name}>{initials}</span>
        </header>
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 pb-8 pt-2 sm:px-6 lg:px-10">{children}</main>
      </div>
      <LeaPanel simulated={llm.simulated} />
    </div>
  );
}
