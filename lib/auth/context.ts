import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { withUser, type Db } from "@/lib/database/client";
import { ORG_COOKIE, SESSION_COOKIE, verifySession } from "./session";
import type { MemberRole } from "./roles";

export type Membership = { organizationId: string; name: string; slug: string; isDemo: boolean; role: MemberRole };

export type AppContext = {
  userId: string;
  email: string;
  displayName: string | null;
  org: Membership;
  memberships: Membership[];
};

export const getSession = cache(async () => {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
});

/** Contexte authentifié + organisation active (vérifiée par la RLS, jamais déduite du client seul). */
export const getContext = cache(async (): Promise<AppContext | null> => {
  const session = await getSession();
  if (!session) return null;
  const store = await cookies();
  const wanted = store.get(ORG_COOKIE)?.value;
  const rows = await withUser(session.sub, async (db) => {
    const r = await db.query<{ organization_id: string; name: string; slug: string; is_demo: boolean; role: MemberRole; display_name: string | null }>(
      `select m.organization_id, o.name, o.slug, o.is_demo, m.role, m.display_name
       from organization_members m join organizations o on o.id = m.organization_id
       where m.user_id = $1 and m.status = 'active' order by o.name`,
      [session.sub],
    );
    return r.rows;
  });
  if (!rows.length) return null;
  const memberships = rows.map((r) => ({ organizationId: r.organization_id, name: r.name, slug: r.slug, isDemo: r.is_demo, role: r.role }));
  const active = memberships.find((m) => m.organizationId === wanted) ?? memberships[0]!;
  const me = rows.find((r) => r.organization_id === active.organizationId);
  return { userId: session.sub, email: session.email, displayName: me?.display_name ?? null, org: active, memberships };
});

export async function requireContext(): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** Exécute une requête sous l'identité de l'utilisateur courant (RLS). */
export async function db<T>(fn: (db: Db, ctx: AppContext) => Promise<T>): Promise<T> {
  const ctx = await requireContext();
  return withUser(ctx.userId, (d) => fn(d, ctx));
}
