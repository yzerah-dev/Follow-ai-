import { NextResponse } from "next/server";
import { withAgent, withPrivileged } from "@/lib/database/client";
import { runOpportunityScan } from "@/features/opportunities/service";
import { runAutopilot } from "@/features/agent/autopilot";
import { loadAutonomy } from "@/features/settings/policy-repo";
import { safeEqual } from "@/lib/security/crypto";
import { toIsoDate } from "@/lib/utils";

/**
 * Journée de travail de LÉA (Vercel Cron : Authorization: Bearer $CRON_SECRET).
 * Chaque organisation est traitée sous l'identité agent de SON organisation (RLS),
 * avec une clé d'idempotence par jour : un double déclenchement ne crée rien en double.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return new NextResponse("Non autorisé", { status: 401 });
  const today = toIsoDate(new Date());
  // Liste des organisations : seule lecture privilégiée, aucune donnée métier.
  const orgs = await withPrivileged(async (db) => (await db.query<{ id: string }>(`select id from organizations`)).rows);
  const results: Record<string, unknown> = {};
  for (const o of orgs) {
    try {
      results[o.id] = await withAgent(o.id, async (db) => {
        const lock = await db.query(
          `insert into agent_runs (organization_id, kind, status, idempotency_key, started_at, finished_at) values ($1, 'daily_plan', 'succeeded', $2, now(), now())
           on conflict (organization_id, idempotency_key) do nothing returning id`,
          [o.id, `daily_plan:${today}`],
        );
        if (!lock.rowCount) return { skipped: "déjà exécuté aujourd'hui" };
        const cfg = await loadAutonomy(db, o.id);
        // Mode autonome / semi-autonome : LÉA prépare ET envoie ; sinon elle prépare seulement.
        return cfg.level !== "supervised" && !cfg.paused ? runAutopilot(db, o.id) : runOpportunityScan(db, o.id, today);
      });
    } catch (e) {
      results[o.id] = { error: e instanceof Error ? e.message : "erreur" };
    }
  }
  return NextResponse.json({ date: today, organizations: orgs.length, results });
}
