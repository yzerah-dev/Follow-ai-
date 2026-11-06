import pg from "pg";
import { applyAll, recreateDatabase } from "@/lib/database/migrate";
import { seedDemo, DEMO_USERS } from "@/lib/demo/seed";

export const TEST_URL = process.env.DATABASE_URL!;
export const TODAY = "2026-11-06";

/** Base de test neuve : shim local + migrations + seed de démonstration à date fixe. */
export async function resetTestDb(opts: { seed?: boolean } = { seed: true }) {
  const url = new URL(TEST_URL);
  const admin = new URL(TEST_URL);
  admin.pathname = "/postgres";
  await recreateDatabase(admin.toString(), url.pathname.slice(1));
  const c = new pg.Client({ connectionString: TEST_URL });
  await c.connect();
  await applyAll(c, { withLocalShim: true });
  await c.end();
  if (opts.seed !== false) await seedDemo(TEST_URL, { today: TODAY });
}

export async function privileged<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: TEST_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export async function ids() {
  return privileged(async (c) => {
    const users = Object.fromEntries((await c.query<{ email: string; id: string }>(`select email, id from auth.users`)).rows.map((r) => [r.email, r.id]));
    const orgs = Object.fromEntries((await c.query<{ slug: string; id: string }>(`select slug, id from organizations`)).rows.map((r) => [r.slug, r.id]));
    return {
      alice: users["alice@demo.follow.ai"]!,
      bruno: users["bruno@demo.follow.ai"]!,
      diane: users["diane@demo.follow.ai"]!,
      chloe: users["chloe@demo.follow.ai"]!,
      orgA: orgs["demo-jonas"]!,
      orgB: orgs["demo-beta"]!,
    };
  });
}

export { DEMO_USERS };
