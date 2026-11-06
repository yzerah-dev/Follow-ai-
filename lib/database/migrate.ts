import fs from "node:fs";
import path from "node:path";
import type pg from "pg";

const ROOT = path.resolve(import.meta.dirname, "../..");

export function migrationFiles(): string[] {
  const dir = path.join(ROOT, "supabase/migrations");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => path.join(dir, f));
}

/** Applique le shim local (rôles + schéma auth) puis toutes les migrations. */
export async function applyAll(client: pg.Client, opts: { withLocalShim: boolean }) {
  if (opts.withLocalShim) {
    await client.query(fs.readFileSync(path.join(ROOT, "supabase/local/00_supabase_shim.sql"), "utf8"));
  }
  for (const f of migrationFiles()) {
    await client.query(fs.readFileSync(f, "utf8"));
  }
}

export async function recreateDatabase(adminUrl: string, dbName: string) {
  if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error("nom de base invalide");
  const { default: pgMod } = await import("pg");
  const admin = new pgMod.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [dbName]);
    await admin.query(`drop database if exists ${dbName}`);
    await admin.query(`create database ${dbName}`);
  } finally {
    await admin.end();
  }
}
