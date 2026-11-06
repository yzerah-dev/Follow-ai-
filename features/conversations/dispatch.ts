/**
 * Cœur d'envoi des messages — commun à la validation humaine et à l'envoi autonome de LÉA.
 * Contrôles systématiques : liste d'opposition, consentement (prospection), connexion utilisable,
 * et pour les envois autonomes : plage horaire et quota quotidien (sinon programmation).
 */
import type { Db } from "@/lib/database/client";
import { audit, type AuditActor } from "@/lib/security/audit";
import { adapterFor } from "@/lib/integrations/registry";
import { loadAutonomy } from "@/features/settings/policy-repo";
import { inSendWindow, nextSendTime } from "@/features/agent/autonomy";
import { applyOfferDiscount } from "@/features/offers/service";

export class DispatchBlocked extends Error {}

export type DispatchResult =
  | { status: "sent"; simulated: boolean }
  | { status: "scheduled"; scheduledAt: string; reason: string };

export async function dispatchMessage(
  db: Db,
  orgId: string,
  messageId: string,
  actor: AuditActor,
  opts: { autonomous: boolean; now?: Date; subject?: string | null; body?: string },
): Promise<DispatchResult> {
  const now = opts.now ?? new Date();
  const m = (await db.query<{ id: string; status: string; to_address: string | null; subject: string | null; body: string; conversation_id: string; offer_id: string | null; contact_id: string | null; customer_id: string | null }>(
    `select m.id, m.status, m.to_address, m.subject, m.body, m.conversation_id, c.offer_id, c.contact_id, c.customer_id
     from messages m join conversations c on c.id = m.conversation_id where m.id = $1 and m.organization_id = $2 and m.direction = 'outbound'`, [messageId, orgId])).rows[0];
  if (!m) throw new DispatchBlocked("Message introuvable.");
  if (!["pending_approval", "approved"].includes(m.status)) throw new DispatchBlocked("Ce message a déjà été traité.");
  const subject = opts.subject !== undefined ? opts.subject : m.subject;
  const body = opts.body ?? m.body;
  if (!m.to_address) throw new DispatchBlocked("Aucune adresse destinataire : complétez le contact avant l'envoi.");
  const to = m.to_address.trim().toLowerCase();

  if ((await db.query(`select 1 from suppression_entries where organization_id = $1 and channel = 'email' and address = $2`, [orgId, to])).rowCount)
    throw new DispatchBlocked("Ce destinataire est inscrit sur la liste d'opposition : envoi bloqué.");
  const isReply = (await db.query(`select 1 from messages where conversation_id = $1 and direction = 'inbound'`, [m.conversation_id])).rowCount;
  if (!isReply && m.contact_id) {
    const consent = (await db.query<{ consent_email: boolean }>(`select consent_email from contacts where id = $1`, [m.contact_id])).rows[0];
    if (!consent?.consent_email) throw new DispatchBlocked("Pas d'autorisation de prospection email enregistrée pour ce contact : envoi bloqué.");
  }
  const conn = (await db.query<{ id: string; provider: string; status: string }>(
    `select id, provider, status from communication_connections
     where organization_id = $1 and channel = 'email' and (status = 'connected' or simulation_enabled) order by (status = 'connected') desc limit 1`, [orgId])).rows[0];
  if (!conn) throw new DispatchBlocked("Aucune connexion email active ni mode simulation : configurez une connexion dans « Connexions ».");
  const adapter = conn.status === "connected" ? adapterFor("email", conn.provider) : adapterFor("email", "simulated");
  if (!adapter) throw new DispatchBlocked("Connecteur email indisponible.");

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

  const attachments = m.offer_id
    ? (await db.query<{ filename: string; storage_path: string; mime_type: string }>(
        `select filename, storage_path, mime_type from generated_assets where offer_id = $1 and validation_status = 'approved' and kind in ('offer_pdf','offer_excel')`, [m.offer_id])).rows.map((a) => ({ filename: a.filename, storagePath: a.storage_path, mimeType: a.mime_type }))
    : [];
  const result = await adapter.send({ organizationId: orgId, messageId, to, subject, body, attachments });
  await db.query(
    `update messages set status = $2, subject = $3, body = $4, provider_message_id = $5, sent_at = $7, scheduled_at = null, sent_autonomously = $8,
       attachments = $6, from_address = coalesce(from_address, 'commercial@follow.ai') where id = $1`,
    [messageId, result.simulated ? "simulated_sent" : "sent", subject, body, result.providerMessageId, JSON.stringify(attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType }))), now.toISOString(), opts.autonomous],
  );
  await db.query(`update conversations set status = 'waiting_customer', last_message_at = $2 where id = $1`, [m.conversation_id, now.toISOString()]);
  await db.query(
    `insert into communication_events (organization_id, connection_id, conversation_id, message_id, event_type, simulated, payload, idempotency_key)
     values ($1,$2,$3,$4,'message.sent',$5,$6,$7)`,
    [orgId, conn.id, m.conversation_id, messageId, result.simulated, { to, attachments: attachments.length, autonomous: opts.autonomous }, `sent:${messageId}`],
  );
  if (m.offer_id) {
    const pct = (await db.query<{ pct: string | null }>(`select ai_analysis->>'discountPct' as pct from messages where id = $1`, [messageId])).rows[0]?.pct;
    if (pct && Number(pct) > 0) await applyOfferDiscount(db, orgId, m.offer_id, Number(pct), actor);
  }
  if (m.offer_id) await db.query(`update offers set status = 'sent', sent_at = coalesce(sent_at, $2) where id = $1 and status = 'approved'`, [m.offer_id, now.toISOString()]);
  if (m.customer_id) {
    // Une relance programmée remplace la précédente (une seule en attente par conversation).
    await db.query(`update followup_tasks set status = 'done' where conversation_id = $1 and kind = 'followup' and status = 'pending'`, [m.conversation_id]);
    // Une relance envoyée porte son numéro (ai_analysis.attempt) : la suivante sera n+1.
    const meta = (await db.query<{ kind: string | null; attempt: string | null }>(`select ai_analysis->>'kind' as kind, ai_analysis->>'attempt' as attempt from messages where id = $1`, [messageId])).rows[0];
    const nextAttempt = meta?.kind === "followup" ? Number(meta.attempt ?? 1) + 1 : 1;
    await db.query(
      `insert into followup_tasks (organization_id, customer_id, conversation_id, offer_id, kind, title, due_at, idempotency_key, created_by_agent, attempt)
       values ($1,$2,$3,$4,'followup','Relancer si pas de réponse', $6::timestamptz + make_interval(days => $7), $5, true, $8) on conflict (organization_id, idempotency_key) do nothing`,
      [orgId, m.customer_id, m.conversation_id, m.offer_id, `followup:${messageId}`, now.toISOString(), settings.followupAfterDays, nextAttempt],
    );
  }
  await audit(db, orgId, actor, `${opts.autonomous ? "lea.autonomous_" : ""}${result.simulated ? "message.sent_simulated" : "message.sent"}`, { type: "message", id: messageId }, { to, attachments: attachments.length });
  return { status: "sent", simulated: result.simulated };
}
