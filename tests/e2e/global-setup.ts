import pg from "pg";
import { applyAll, recreateDatabase } from "../../lib/database/migrate";
import { seedDemo } from "../../lib/demo/seed";

/** Base E2E neuve (le serveur doit avoir été construit : npm run build). */
export default async function globalSetup() {
  const url = process.env.DATABASE_URL!;
  const admin = new URL(url);
  admin.pathname = "/postgres";
  await recreateDatabase(admin.toString(), new URL(url).pathname.slice(1));
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await applyAll(c, { withLocalShim: true });
  await c.end();
  await seedDemo(url);
}
