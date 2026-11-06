import { NextResponse } from "next/server";
import { withAgent, withPrivileged } from "@/lib/database/client";
import { sendDueMessages } from "@/features/agent/autopilot";
import { safeEqual } from "@/lib/security/crypto";

/** Envoi des messages programmés (hors plage horaire, quota) — à appeler fréquemment (ex. toutes les 15 min). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new NextResponse("Non autorisé", { status: 401 });
  const orgs = await withPrivileged(async (db) => (await db.query<{ id: string }>(
    `select o.id from organizations o join organization_settings s on s.organization_id = o.id where not s.autonomy_paused`)).rows);
  const results: Record<string, number | string> = {};
  for (const o of orgs) {
    try {
      results[o.id] = await withAgent(o.id, (db) => sendDueMessages(db, o.id));
    } catch (e) {
      results[o.id] = e instanceof Error ? e.message : "erreur";
    }
  }
  return NextResponse.json({ organizations: orgs.length, sent: results });
}
