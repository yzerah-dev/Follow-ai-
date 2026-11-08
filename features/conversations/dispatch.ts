/**
 * Cœur d'envoi des messages — commun à la validation humaine et à l'envoi autonome de LÉA, pour tous les canaux.
 * Contrôles systématiques : liste d'opposition, consentement par canal (prospection), connexion utilisable,
 * WhatsApp : fenêtre de service de 24 h (sinon modèle approuvé obligatoire) ;
 * envois autonomes : plage horaire et quota quotidien (sinon programmation).
 */
import type { Db } from "@/lib/database/client";
import { audit, type AuditActor } from "@/lib/security/audit";
import { adapterFor } from "@/lib/integrations/registry";
import { readConnectionSecret } from "@/lib/integrations/secrets";
import type { Channel, MessageTemplate } from "@/lib/integrations/types";
import { toE164 } from "@/lib/phone";
import { loadAutonomy } from "@/features/settings/policy-repo";
import { inSendWindow, nextSendTime } from "@/features/agent/autonomy";
import { applyOfferDiscount } from "@/features/offers/service";

export class DispatchBlocked extends Error {}

export type DispatchResult =
  | { status: "sent"; simulated: boolean }
  | { status: "scheduled"; scheduledAt: string; reason: string };

const DAY = 86_400_000;
export const SUPPORTED_CHANNELS: Channel[] = ["email", "whatsapp"];

/** WhatsApp : message libre autorisé seulement dans les 24 h qui suivent le dernier message du client. */
export function whatsappWindowOpen(lastInboundAt: string | Date | null, now: Date): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - new Date(lastInboundAt).getTime() < DAY;
}

export function normalizeAddress(channel: Channel, raw: string): string | null {
  if (channel === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim()) ? raw.trim().toLowerCase() : null;
  return toE164(raw);
}

type Meta = { template?: MessageTemplate | null; discountPct?: number | null; kind?: string; attempt?: number; attachOffer?: boolean; attachExcel?: boolean };

export async function dispatchMessage(
  db: Db,
  orgId: string,
  messageId: string,
  actor: AuditActor,
  opts: { autonomous: boolean; now?: Date; subject?: string | null; body?: string },
): Promise<DispatchResult> {
  const now = opts.now ?? new Date();
  const m = (await db.query<{ id: string; status: string; channel: Channel; to_address: string | null; subject: string | null; body: string; conversation_id: string; offer_id: string | null; contact_id: string | null; customer_id: string | null; last_inbound_at: string | null; ai_analysis: Meta | null }>(
    `select m.id, m.status, c.channel, m.to_address, m.subject, m.body, m.conversation_id, c.offer_id, c.contact_id, c.customer_id, c.last_inbound_at, m.ai_analysis
     from messages m join conversations c on c.id = m.conversation_id where m.id = $1 and m.organization_id = $2 and m.direction = 'outbound'`, [messageId, orgId])).rows[0];
  if (!m) throw new DispatchBlocked("Message introuvable.");
  if (!["pending_approval", "approved"].includes(m.status)) throw new DispatchBlocked("Ce message a déjà été traité.");
  if (!SUPPORTED_CHANNELS.includes(m.channel)) throw new DispatchBlocked(`Canal « ${m.channel} » : envoi non disponible.`);
  const meta = m.ai_analysis ?? {};
  const subject = m.channel === "email" ? (opts.subject !== undefined ? opts.subject : m.subject) : null;
  const body = opts.body ?? m.body;
  if (!m.to_address) throw new DispatchBlocked("Aucun destinataire : complétez le contact avant l'envoi.");
  const to = normalizeAddress(m.channel, m.to_address);
  if (!to) throw new DispatchBlocked("Adresse ou numéro du destinataire invalide.");

  if ((await db.query(`select 1 from suppression_entries where organization_id = $1 and channel = $2 and address = $3`, [orgId, m.channel, to])).rowCount)
    throw new DispatchBlocked("Ce destinataire est inscrit sur la liste d'opposition : envoi bloqué.");
  const isReply = (await db.query(`select 1 from messages where conversation_id = $1 and direction = 'inbound'`, [m.conversation_id])).rowCount;
  if (!isReply && m.contact_id) {
    const consent = (await db.query<{ consent_email: boolean; consent_whatsapp: boolean }>(`select consent_email, consent_whatsapp from contacts where id = $1`, [m.contact_id])).rows[0];
    const ok = m.channel === "email" ? consent?.consent_email : consent?.consent_whatsapp;
    if (!ok) throw new DispatchBlocked(`Pas d'autorisation de prospection ${m.channel === "email" ? "email" : "WhatsApp"} enregistrée pour ce contact : envoi bloqué.`);
  }

  const conn = (await db.query<{ id: string; provider: string; status: string; config: { approvedTemplates?: string[]; phoneNumberId?: string } }>(
    `select id, provider, status, config from communication_connections
     where organization_id = $1 and channel = $2 and (status = 'connected' or simulation_enabled) order by (status = 'connected') desc limit 1`, [orgId, m.channel])).rows[0];
  if (!conn) throw new DispatchBlocked(`Aucune connexion ${m.channel === "email" ? "email" : "WhatsApp"} active ni mode simulation : configurez-la dans « Connexions ».`);

  // WhatsApp : hors fenêtre de 24 h, seul un modèle approuvé peut être envoyé.
  let template: MessageTemplate | null = null;
  if (m.channel === "whatsapp" && !whatsappWindowOpen(m.last_inbound_at, now)) {
    template = meta.template ?? null;
    if (!template) throw new DispatchBlocked("WhatsApp : plus de 24 h depuis le dernier message du client, un modèle approuvé est obligatoire.");
    if (!(conn.config.approvedTemplates ?? []).includes(template.name)) throw new DispatchBlocked(`WhatsApp : le modèle « ${template.name} » n'est pas approuvé pour ce numéro.`);
  }

  const real = conn.status === "connected";
  const adapter = real
    ? adapterFor(m.channel, conn.provider, await readConnectionSecret(orgId, conn.id), conn.config as Record<string, unknown>)
    : adapterFor(m.channel, "simulated");
  if (!adapter) throw new DispatchBlocked("Connecteur indisponible.");

  const settings = await loadAutonomy(db, orgId);
  if (opts.autonomous) {
    // Plage horaire et quota : on programme au lieu d'envoyer (jamais d'envoi hors cadre).
    const sentToday = (await db.query<{ n: number }>(
      `select count(*)::int as n from messages where organization_id = $1 and sent_autonomously and sent_at >= date_trunc('day', $2::timestamptz)`, [orgId, now.toISOString()])).rows[0]!.n;
    let reason: string | null = null;
    if (!inSendWindow(now, settings.sendWindow, settings.timezone)) reason = "Hors plage d'envoi : programmé.";
    else if (sentToday >= settings.dailySendLimit) reason = "Quota quotidien atteint : programmé.";
    if (reason) {
      const base = reason.startsWith("Quota") ? new Date(new Date(now).setUTCHours(24, 0, 0, 0)) : now;
      const at = nextSendTime(base, settings.sendWindow, settings.timezone);
      if (!at) throw new DispatchBlocked("Aucune plage d'envoi configurée.");
      await db.query(`update messages set status = 'approved', subject = $2, body = $3, scheduled_at = $4 where id = $1`, [messageId, subject, body, at.toISOString()]);
      return { status: "scheduled", scheduledAt: at.toISOString(), reason };
    }
  }

  const docs = m.offer_id
    ? (await db.query<{ filename: string; storage_path: string; mime_type: string; kind: string }>(
        `select filename, storage_path, mime_type, kind from generated_assets where offer_id = $1 and validation_status = 'approved' and kind in ('offer_pdf','offer_excel','coverage_excel') order by kind`, [m.offer_id])).rows
    : [];
  // Email : PDF + Excel. WhatsApp : un seul document — l'Excel de l'offre pour une relance (le client le renvoie avec ses quantités),
  // sinon le PDF (en-tête document du modèle d'offre, ou document dans la fenêtre de 24 h).
  const waDoc = meta.attachExcel ? docs.filter((d) => d.kind === "offer_excel") : docs.filter((d) => d.mime_type === "application/pdf");
  const attachments = (m.channel === "email" ? docs : template || meta.attachOffer || meta.attachExcel ? waDoc.slice(0, 1) : [])
    .map((a) => ({ filename: a.filename, storagePath: a.storage_path, mimeType: a.mime_type }));
  const result = await adapter.send({ organizationId: orgId, messageId, channel: m.channel, to, subject, body, template, attachments });
  await db.query(
    `update messages set status = $2, subject = $3, body = $4, provider_message_id = $5, sent_at = $7, scheduled_at = null, sent_autonomously = $8,
       attachments = $6, to_address = $9, from_address = coalesce(from_address, $10) where id = $1`,
    [messageId, result.simulated ? "simulated_sent" : "sent", subject, body, result.providerMessageId, JSON.stringify(attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType }))),
      now.toISOString(), opts.autonomous, to, m.channel === "email" ? "commercial@follow.ai" : "LÉA (WhatsApp Business)"],
  );
  await db.query(`update conversations set status = 'waiting_customer', last_message_at = $2 where id = $1`, [m.conversation_id, now.toISOString()]);
  await db.query(
    `insert into communication_events (organization_id, connection_id, conversation_id, message_id, event_type, simulated, payload, idempotency_key)
     values ($1,$2,$3,$4,'message.sent',$5,$6,$7)`,
    [orgId, conn.id, m.conversation_id, messageId, result.simulated, { channel: m.channel, to, attachments: attachments.length, autonomous: opts.autonomous, template: template?.name ?? null }, `sent:${messageId}`],
  );
  if (m.offer_id && meta.discountPct && Number(meta.discountPct) > 0) await applyOfferDiscount(db, orgId, m.offer_id, Number(meta.discountPct), actor);
  if (m.offer_id) await db.query(`update offers set status = 'sent', sent_at = coalesce(sent_at, $2) where id = $1 and status = 'approved'`, [m.offer_id, now.toISOString()]);
  if (m.customer_id) {
    // Une seule relance en attente par conversation ; une relance envoyée porte son numéro (meta.attempt).
    await db.query(`update followup_tasks set status = 'done' where conversation_id = $1 and kind = 'followup' and status = 'pending'`, [m.conversation_id]);
    const nextAttempt = meta.kind === "followup" ? Number(meta.attempt ?? 1) + 1 : 1;
    await db.query(
      `insert into followup_tasks (organization_id, customer_id, conversation_id, offer_id, kind, title, due_at, idempotency_key, created_by_agent, attempt)
       values ($1,$2,$3,$4,'followup','Relancer si pas de réponse', $6::timestamptz + make_interval(days => $7), $5, true, $8) on conflict (organization_id, idempotency_key) do nothing`,
      [orgId, m.customer_id, m.conversation_id, m.offer_id, `followup:${messageId}`, now.toISOString(), settings.followupAfterDays, nextAttempt],
    );
  }
  await audit(db, orgId, actor, `${opts.autonomous ? "lea.autonomous_" : ""}${result.simulated ? "message.sent_simulated" : "message.sent"}`, { type: "message", id: messageId }, { channel: m.channel, attachments: attachments.length });
  return { status: "sent", simulated: result.simulated };
}
