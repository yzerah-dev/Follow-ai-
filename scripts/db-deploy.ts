/**
 * Mise à jour d'une base hébergée (test ou production) : applique UNIQUEMENT les migrations pas encore appliquées,
 * chacune dans sa transaction, et les enregistre dans public.app_migrations. Ne supprime jamais rien.
 *
 *   npm run db:deploy                 # migrations manquantes
 *   npm run db:deploy -- --demo-seed  # + données de démonstration (environnement de TEST uniquement, base sans autre organisation ;
 *                                     #   en ligne, mot de passe des comptes = DEMO_SEED_PASSWORD, obligatoire)
 *
 * Base PostgreSQL standard (Railway, Neon, …) : le shim local (rôles « authenticated », schéma auth) est appliqué à la création.
 * Base Supabase : ajouter --supabase (rôles et schéma auth fournis par Supabase).
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { migrationFiles } from "../lib/database/migrate";
import { loadEnvFile } from "./load-env";

loadEnvFile();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant.");
  process.exit(1);
}
const args = new Set(process.argv.slice(2));
const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
await client.connect();
await client.query(`create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now())`);
const fresh = !(await client.query(`select 1 from information_schema.tables where table_schema = 'public' and table_name = 'organizations'`)).rowCount;
if (fresh && !args.has("--supabase")) {
  console.log("Base neuve : rôles et schéma auth (shim)…");
  await client.query(fs.readFileSync(path.resolve(import.meta.dirname, "../supabase/local/00_supabase_shim.sql"), "utf8"));
}
if (!fresh && !(await client.query(`select 1 from public.app_migrations limit 1`)).rowCount) {
  // Base créée avant le suivi des migrations (ex. db:reset) : toutes les migrations existantes sont considérées appliquées.
  for (const f of migrationFiles()) await client.query(`insert into public.app_migrations (name) values ($1) on conflict do nothing`, [path.basename(f)]);
  console.log("Base existante : migrations actuelles enregistrées comme appliquées.");
}
const done = new Set((await client.query<{ name: string }>(`select name from public.app_migrations`)).rows.map((r) => r.name));
let applied = 0;
for (const f of migrationFiles()) {
  const name = path.basename(f);
  if (done.has(name)) continue;
  console.log(`→ ${name}`);
  await client.query("begin");
  try {
    await client.query(fs.readFileSync(f, "utf8"));
    await client.query(`insert into public.app_migrations (name) values ($1)`, [name]);
    await client.query("commit");
    applied++;
  } catch (e) {
    await client.query("rollback");
    console.error(`Échec de ${name} : ${(e as Error).message}`);
    process.exit(1);
  }
}
console.log(`${applied} migration(s) appliquée(s).`);
if (args.has("--demo-seed")) {
  const counts = (await client.query<{ real: number; total: number }>(`select count(*) filter (where not is_demo)::int as real, count(*)::int as total from organizations`)).rows[0]!;
  await client.end();
  if (counts.real > 0) {
    console.error("Refusé : la base contient des organisations réelles. Les données de démonstration sont réservées à un environnement de test.");
    process.exit(1);
  }
  if (counts.total > 0) {
    // Commande de déploiement relancée à chaque mise à jour : les données de démonstration ne sont créées qu'une fois.
    console.log("Données de démonstration déjà présentes : rien à faire.");
    process.exit(0);
  }
  // Base accessible depuis internet : jamais le mot de passe de démonstration publié dans le code.
  const local = /localhost|127\.0\.0\.1/.test(url);
  const password = process.env.DEMO_SEED_PASSWORD;
  if (!local && (!password || password.length < 14)) {
    console.error("Refusé : définissez DEMO_SEED_PASSWORD (14 caractères minimum) pour les comptes de démonstration d'une base en ligne.");
    process.exit(1);
  }
  const { seedDemo } = await import("../lib/demo/seed");
  await seedDemo(url, { password: local ? undefined : password });
} else await client.end();
