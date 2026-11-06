import type pg from "pg";
import { pool } from "./pool";

export type Db = {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
};

export type DbContext =
  | { kind: "user"; userId: string }
  | { kind: "agent"; organizationId: string };

function claimsFor(ctx: DbContext): string {
  return ctx.kind === "user"
    ? JSON.stringify({ sub: ctx.userId, role: "authenticated" })
    : JSON.stringify({ role: "authenticated", agent_org: ctx.organizationId });
}

/**
 * Exécute fn dans une transaction soumise à la RLS :
 *   set local role authenticated + request.jwt.claims (identique à PostgREST/Supabase).
 * Toutes les requêtes applicatives passent par ici.
 */
export async function withDb<T>(ctx: DbContext, fn: (db: Db) => Promise<T>, p: pg.Pool = pool()): Promise<T> {
  const c = await p.connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [claimsFor(ctx)]);
    const result = await fn({ query: (text, values) => c.query(text, values as unknown[]) } as Db);
    await c.query("commit");
    return result;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export const withUser = <T>(userId: string, fn: (db: Db) => Promise<T>) => withDb({ kind: "user", userId }, fn);
export const withAgent = <T>(organizationId: string, fn: (db: Db) => Promise<T>) =>
  withDb({ kind: "agent", organizationId }, fn);

/**
 * Connexion privilégiée (contourne la RLS). Réservée à :
 *   - la vérification des identifiants (auth locale),
 *   - la lecture/écriture des secrets chiffrés de connexion,
 *   - les scripts d'administration (migrations, seed).
 * Ne jamais l'utiliser pour des données métier exposées à l'utilisateur.
 */
export async function withPrivileged<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const conn = await pool().connect();
  try {
    await conn.query("begin");
    const r = await fn({ query: (text, values) => conn.query(text, values as unknown[]) } as Db);
    await conn.query("commit");
    return r;
  } catch (e) {
    await conn.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    conn.release();
  }
}
