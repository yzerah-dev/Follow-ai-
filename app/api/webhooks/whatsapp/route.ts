import { NextResponse } from "next/server";
import { withAgent, withPrivileged } from "@/lib/database/client";
import { parseWhatsAppWebhook, verifyMetaSignature } from "@/lib/integrations/whatsapp-cloud";
import { ingestInboundMessage } from "@/features/conversations/service";
import { analyzeInbound } from "@/features/agent/lea";
import { rateLimit } from "@/lib/security/rate-limit";
import { safeEqual } from "@/lib/security/crypto";

/**
 * Webhook WhatsApp Business Platform (Meta).
 *  GET  : vérification de l'abonnement (hub.verify_token = WHATSAPP_VERIFY_TOKEN).
 *  POST : messages entrants, signature X-Hub-Signature-256 (WHATSAPP_APP_SECRET) obligatoire.
 * Le numéro destinataire (phone_number_id) identifie l'organisation ; tout le reste est traité sous l'identité agent (RLS).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const token = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
  if (u.searchParams.get("hub.mode") === "subscribe" && token && safeEqual(u.searchParams.get("hub.verify_token") ?? "", token))
    return new NextResponse(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  return new NextResponse("Interdit", { status: 403 });
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`wa-webhook:${ip}`, 600, 60_000).ok) return new NextResponse("Trop de requêtes", { status: 429 });
  const raw = await req.text();
  if (raw.length > 500_000) return new NextResponse("Trop volumineux", { status: 413 });
  if (!verifyMetaSignature(process.env.WHATSAPP_APP_SECRET ?? "", raw, req.headers.get("x-hub-signature-256"))) return new NextResponse("Signature invalide", { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Charge utile invalide", { status: 400 });
  }
  const inbound = parseWhatsAppWebhook(payload);
  let processed = 0;
  for (const m of inbound) {
    // Seule lecture privilégiée : retrouver l'organisation propriétaire du numéro WhatsApp.
    const org = await withPrivileged(async (db) =>
      (await db.query<{ organization_id: string }>(
        `select organization_id from communication_connections where channel = 'whatsapp' and provider = 'whatsapp_cloud' and status = 'connected' and config->>'phoneNumberId' = $1 limit 1`,
        [m.phoneNumberId])).rows[0]?.organization_id,
    );
    if (!org) continue;
    await withAgent(org, async (db) => {
      const r = await ingestInboundMessage(db, org, { channel: "whatsapp", from: m.from, subject: null, body: m.body, providerMessageId: m.providerMessageId, simulated: false,
        receivedAt: m.timestamp ? new Date(Number(m.timestamp) * 1000) : undefined });
      if (!r.duplicate) await analyzeInbound(db, org, r.messageId, { userId: null });
    });
    processed++;
  }
  // Meta exige une réponse 200 rapide, même pour les événements ignorés (accusés de lecture, statuts).
  return NextResponse.json({ ok: true, processed });
}
