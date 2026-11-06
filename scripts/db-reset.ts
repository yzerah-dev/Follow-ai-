/**
 * Recrée la base locale, applique le shim Supabase local + migrations, puis le seed de démonstration.
 * Usage : npm run db:reset   (LOCAL UNIQUEMENT — refuse une base distante)
 */
import pg from "pg";
import { applyAll, recreateDatabase } from "../lib/database/migrate";
import { loadEnvFile } from "./load-env";

loadEnvFile();
const url = new URL(process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/follow_ai");
if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
  console.error("db:reset est réservé à une base locale.");
  process.exit(1);
}
const dbName = url.pathname.slice(1);
const adminUrl = new URL(url.toString());
adminUrl.pathname = "/postgres";

await recreateDatabase(adminUrl.toString(), dbName);
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
await applyAll(client, { withLocalShim: true });
await client.end();
console.log(`Base ${dbName} recréée et migrée.`);

if (!process.argv.includes("--no-seed")) {
  const { seedDemo } = await import("../lib/demo/seed");
  await seedDemo(url.toString());
}
