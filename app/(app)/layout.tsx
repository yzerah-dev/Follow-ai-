import { requireContext } from "@/lib/auth/context";
import { withUser } from "@/lib/database/client";
import { Sidebar } from "@/components/app/sidebar";
import { LeaPanel } from "@/components/app/lea-panel";
import { getLlm } from "@/lib/ai";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const counts = await withUser(ctx.userId, async (db) => {
    const r = await db.query<{ approvals: number; replies: number }>(
      `select (select count(*)::int from approvals where organization_id = $1 and status = 'pending') as approvals,
              (select count(*)::int from messages where organization_id = $1 and direction = 'inbound' and not handled) as replies`,
      [ctx.org.organizationId],
    );
    return r.rows[0]!;
  });
  const llm = getLlm();
  return (
    <div className="flex min-h-screen">
      <Sidebar
        orgName={ctx.org.name}
        orgId={ctx.org.organizationId}
        memberships={ctx.memberships.map((m) => ({ id: m.organizationId, name: m.name }))}
        userName={ctx.displayName ?? ctx.email}
        role={ctx.org.role}
        counts={counts}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {ctx.org.isDemo ? (
          <div className="border-b border-warning/20 bg-warning-soft px-6 py-1.5 text-center text-[12px] font-medium text-warning">
            Organisation de démonstration — toutes les données sont fictives. Aucun message n&apos;est réellement envoyé.
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-6 py-7 lg:px-10">{children}</main>
      </div>
      <LeaPanel simulated={llm.simulated} />
    </div>
  );
}
