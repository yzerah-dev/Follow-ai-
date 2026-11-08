import { NextResponse } from "next/server";
import { z } from "zod";
import { withAgent } from "@/lib/database/client";
import { verifyWebhook } from "@/lib/security/crypto";
import { ingestInboundEmail } from "@/features/conversations/service";
import { analyzeInbound } from "@/features/agent/lea";
import { handleClientExcel, isExcelFile } from "@/features/agent/excel-return";
import { MAX_CLIENT_EXCEL_BYTES } from "@/features/offers/client-excel";
import { rateLimit } from "@/lib/security/rate-limit";

/**
 * Webhook authentifié de réception d'emails (passerelle fournisseur → Follow.AI).
 * Signature HMAC-SHA256 obligatoire (en-tête X-Follow-Signature: t=..,v1=..), anti-rejeu 5 min,
 * idempotence via providerMessageId. Le contenu est traité comme donnée non fiable.
 */
const payload = z.object({
  organizationId: z.uuid(),
  from: z.email().max(320),
  subject: z.string().max(500).nullable().optional(),
  body: z.string().max(100_000),
  providerMessageId: z.string().min(1).max(300),
  /** Pièces jointes (base64). Seul un Excel (.xlsx) est exploité : l'Excel de la sélection renvoyé avec les quantités du client. */
  attachments: z.array(z.object({ filename: z.string().min(1).max(200), mimeType: z.string().max(200).optional(), contentBase64: z.string().max(Math.ceil(MAX_CLIENT_EXCEL_BYTES * 1.4)) })).max(10).optional(),
});

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`webhook:${ip}`, 120, 60_000).ok) return new NextResponse("Trop de requêtes", { status: 429 });
  const raw = await req.text();
  if (raw.length > 6_000_000) return new NextResponse("Trop volumineux", { status: 413 });
  if (!verifyWebhook(process.env.WEBHOOK_SIGNING_SECRET ?? "", raw, req.headers.get("x-follow-signature"))) return new NextResponse("Signature invalide", { status: 401 });
  let data: z.infer<typeof payload>;
  try {
    data = payload.parse(JSON.parse(raw));
  } catch {
    return new NextResponse("Charge utile invalide", { status: 400 });
  }
  const res = await withAgent(data.organizationId, async (db) => {
    const r = await ingestInboundEmail(db, data.organizationId, { from: data.from, subject: data.subject ?? null, body: data.body, providerMessageId: data.providerMessageId, simulated: false });
    if (r.duplicate) return r;
    const excel = data.attachments?.find((a) => isExcelFile(a.filename, a.mimeType));
    // Excel renvoyé avec les quantités : LÉA met l'offre à jour ; sinon analyse habituelle du message.
    if (excel) await handleClientExcel(db, data.organizationId, r.messageId, { filename: excel.filename, buffer: Buffer.from(excel.contentBase64, "base64") });
    else await analyzeInbound(db, data.organizationId, r.messageId, { userId: null });
    return r;
  });
  return NextResponse.json({ ok: true, messageId: res.messageId, duplicate: res.duplicate });
}
