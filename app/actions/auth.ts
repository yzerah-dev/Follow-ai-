"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { verifyCredentials } from "@/lib/auth/local-provider";
import { ORG_COOKIE, SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/security/rate-limit";
import { requireContext } from "@/lib/auth/context";
import { withUser } from "@/lib/database/client";
import { audit } from "@/lib/security/audit";

const loginSchema = z.object({ email: z.email().max(200), password: z.string().min(1).max(200) });

export type LoginState = { error?: string };

export async function loginAction(_: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Email ou mot de passe invalide." };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const rl = rateLimit(`login:${ip}:${parsed.data.email.toLowerCase()}`, 8, 10 * 60_000);
  if (!rl.ok) return { error: "Trop de tentatives. Réessayez dans quelques minutes." };
  const user = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!user) return { error: "Identifiants incorrects." };
  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession({ sub: user.id, email: user.email }), sessionCookieOptions);
  const orgs = await withUser(user.id, async (db) => (await db.query<{ organization_id: string }>(`select organization_id from organization_members where user_id = $1 and status = 'active'`, [user.id])).rows);
  for (const o of orgs.slice(0, 1)) await withUser(user.id, (db) => audit(db, o.organization_id, { type: "user", userId: user.id }, "auth.login", undefined, { ip }));
  redirect("/");
}

export async function logoutAction() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(ORG_COOKIE);
  redirect("/login");
}

export async function switchOrgAction(formData: FormData) {
  const ctx = await requireContext();
  const orgId = String(formData.get("organizationId") ?? "");
  if (!ctx.memberships.some((m) => m.organizationId === orgId)) return;
  (await cookies()).set(ORG_COOKIE, orgId, sessionCookieOptions);
  redirect("/");
}
