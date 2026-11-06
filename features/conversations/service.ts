import type { Db } from "@/lib/database/client";
import { audit } from "@/lib/security/audit";
import { sanitizeText } from "@/lib/security/untrusted";
import { adapterFor } from "@/lib/integrations/registry";
import { analyzeInbound } from "@/features/agent/lea";

export type MessageDecision = { decision: "approved" | "rejected"; note?: string; editedBody?: string; editedSubject?: string };

/**
 * Validation humaine d'un message préparé par LÉA, puis envoi par le canal configuré.
 * Contrôles : approbation en attente, liste d'opposition, consentement, connexion utilisable.
 */
export async function decideMessage(db: Db, orgId: string, userId: string, messageId: string, d: MessageDecision) {
  const m = (await db.query<{ id: string; status: string; channel: "email"; to_address: string | null; subject: string | null; body: string; conversation_id: string; offer_id: string | null; contact_id: string | null; customer_id: string | null }>(
    `select m.id, m.status, m.channel, m.to_address, m.subject, m.body, m.conversation_id, c.offer_id, c.contact_id, c.customer_id
     from messages m join conversations c on c.id = m.conversation_id where m.id = $1 and m.organization_id = $2`, [messageId, orgId])).rows[0];
  if (!m) throw new Error("Message introuvable.");
  if (m.status !== "pending_approval") throw new Error("Ce message n'est pas en attente de validation.");
  const approval = (await db.query<{ id: string }>(`select id from approvals where organization_id = $1 and subject_id = $2 and status = 'pending'`, [orgId, messageId])).rows[0];
  if (!approval) throw new Error("Aucune demande de validation en attente.");

  if (d.decision === "rejected") {
    await db.query(`update approvals set status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3 where id = $1`, [approval.id, userId, d.note ?? null]);
    await db.query(`update messages set status = 'draft' where id = $1`, [messageId]);
    await audit(db, orgId, { type: "user", userId }, "message.rejected", { type: "message", id: messageId });
    return { sent: false as const };
  }

  const subject = d.editedSubject !== undefined ? sanitizeText(d.editedSubject, 160) : m.subject;
  const body = d.editedBody !== undefined ? sanitizeText(d.editedBody, 8000) : m.body;
  if (!m.to_address) throw new Error("Aucune adresse destinataire : complétez le contact avant l'envoi.");
  const to = m.to_address.trim().toLowerCase();

  const suppressed = (await db.query(`select 1 from suppression_entries where organization_id = $1 and channel = 'email' and address = $2`, [orgId, to])).rowCount;
  if (suppressed) throw new Error("Ce destinataire est inscrit sur la liste d'opposition : envoi bloqué.");
  const isReply = (await db.query(`select 1 from messages where conversation_id = $1 and direction = 'inbound'`, [m.conversation_id])).rowCount;
  if (!isReply && m.contact_id) {
    const consent = (await db.query<{ consent_email: boolean }>(`select consent_email from contacts where id = $1`, [m.contact_id])).rows[0];
    if (!consent?.consent_email) throw new Error("Pas d'autorisation de prospection email enregistrée pour ce contact : envoi bloqué.");
  }

  const conn = (await db.query<{ id: string; provider: string; status: string; simulation_enabled: boolean }>(
    `select id, provider, status, simulation_enabled from communication_connections
     where organization_id = $1 and channel = 'email' and (status = 'connected' or simulation_enabled) order by (status = 'connected') desc limit 1`, [orgId])).rows[0];
  if (!conn) throw new Error("Aucune connexion email active ni mode simulation : configurez une connexion dans « Connexions ».");
  const adapter = conn.status === "connected" ? adapterFor("email", conn.provider) : adapterFor("email", "simulated");
  if (!adapter) throw new Error("Connecteur email indisponible.");

  const attachments = m.offer_id
    ? (await db.query<{ filename: string; storage_path: string; mime_type: string }>(
        `select filename, storage_path, mime_type from generated_assets where offer_id = $1 and validation_status = 'approved' and kind in ('offer_pdf','offer_excel')`, [m.offer_id])).rows.map((a) => ({ filename: a.filename, storagePath: a.storage_path, mimeType: a.mime_type }))
    : [];

  await db.query(`update approvals set status = 'approved', decided_by = $2, decided_at = now(), decision_note = $3 where id = $1`, [approval.id, userId, d.note ?? null]);
  const result = await adapter.send({ organizationId: orgId, messageId, to, subject, body, attachments });
  await db.query(
    `update messages set status = $2, subject = $3, body = $4, provider_message_id = $5, sent_at = now(), attachments = $6, from_address = coalesce(from_address, 'commercial@follow.ai') where id = $1`,
    [messageId, result.simulated ? "simulated_sent" : "sent", subject, body, result.providerMessageId, JSON.stringify(attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType })))],
  );
  await db.query(`update conversations set status = 'waiting_customer', last_message_at = now() where id = $1`, [m.conversation_id]);
  await db.query(
    `insert into communication_events (organization_id, connection_id, conversation_id, message_id, event_type, simulated, payload, idempotency_key)
     values ($1,$2,$3,$4,'message.sent',$5,$6,$7)`,
    [orgId, conn.id, m.conversation_id, messageId, result.simulated, { to, attachments: attachments.length }, `sent:${messageId}`],
  );
  if (m.offer_id) await db.query(`update offers set status = 'sent', sent_at = coalesce(sent_at, now()) where id = $1 and status = 'approved'`, [m.offer_id]);
  if (m.customer_id)
    await db.query(
      `insert into followup_tasks (organization_id, customer_id, conversation_id, offer_id, kind, title, due_at, idempotency_key, created_by_agent)
       values ($1,$2,$3,$4,'followup','Relancer si pas de réponse', now() + interval '5 days', $5, true) on conflict (organization_id, idempotency_key) do nothing`,
      [orgId, m.customer_id, m.conversation_id, m.offer_id, `followup:${messageId}`],
    );
  await audit(db, orgId, { type: "user", userId }, result.simulated ? "message.sent_simulated" : "message.sent", { type: "message", id: messageId }, { to, attachments: attachments.length });
  return { sent: true as const, simulated: result.simulated };
}

/**
 * Ingestion d'un message entrant (webhook fournisseur ou simulation).
 * Identification : correspondance exacte de l'adresse email d'un contact de l'organisation.
 * Aucune fusion d'identité si plusieurs sociétés possibles → "probable".
 */
export async function ingestInboundEmail(
  db: Db,
  orgId: string,
  input: { from: string; subject: string | null; body: string; providerMessageId: string; simulated: boolean; conversationId?: string | null },
) {
  const from = input.from.trim().toLowerCase();
  const dup = (await db.query<{ id: string }>(`select id from messages where organization_id = $1 and channel = 'email' and provider_message_id = $2`, [orgId, input.providerMessageId])).rows[0];
  if (dup) return { messageId: dup.id, duplicate: true as const };
  let conversationId = input.conversationId ?? null;
  let identity: "verified" | "probable" | "unknown" = "unknown";
  if (!conversationId) {
    const contact = (await db.query<{ id: string }>(`select id from contacts where organization_id = $1 and lower(email) = $2`, [orgId, from])).rows[0];
    if (contact) {
      const companies = (await db.query<{ customer_id: string }>(`select customer_id from customer_contacts where contact_id = $1`, [contact.id])).rows;
      identity = companies.length === 1 ? "verified" : "probable";
      const conv = (await db.query<{ id: string }>(
        `select id from conversations where organization_id = $1 and contact_id = $2 and channel = 'email' and status <> 'closed' order by last_message_at desc nulls last limit 1`, [orgId, contact.id])).rows[0];
      conversationId = conv?.id ?? (await db.query<{ id: string }>(
        `insert into conversations (organization_id, customer_id, contact_id, channel, subject, status, identity_confidence, last_message_at)
         values ($1,$2,$3,'email',$4,'waiting_us',$5, now()) returning id`,
        [orgId, companies.length === 1 ? companies[0]!.customer_id : null, contact.id, input.subject, identity])).rows[0]!.id;
    } else {
      conversationId = (await db.query<{ id: string }>(
        `insert into conversations (organization_id, channel, subject, status, identity_confidence, last_message_at) values ($1,'email',$2,'waiting_us','unknown', now()) returning id`,
        [orgId, input.subject])).rows[0]!.id;
    }
  }
  const msg = await db.query<{ id: string }>(
    `insert into messages (organization_id, conversation_id, direction, channel, from_address, subject, body, status, provider_message_id, received_at)
     values ($1,$2,'inbound','email',$3,$4,$5,'received',$6, now()) returning id`,
    [orgId, conversationId, from, input.subject ? sanitizeText(input.subject, 300) : null, sanitizeText(input.body, 20000), input.providerMessageId],
  );
  await db.query(
    `insert into communication_events (organization_id, conversation_id, message_id, event_type, simulated, payload, idempotency_key)
     values ($1,$2,$3,'message.received',$4,$5,$6) on conflict do nothing`,
    [orgId, conversationId, msg.rows[0]!.id, input.simulated, { from }, `recv:${input.providerMessageId}`],
  );
  await db.query(`update conversations set last_message_at = now(), status = 'waiting_us' where id = $1`, [conversationId]);
  return { messageId: msg.rows[0]!.id, conversationId, duplicate: false as const };
}

/** Outil de démonstration : simule la réponse d'un client à une conversation, puis déclenche l'analyse de LÉA. */
export async function simulateCustomerReply(db: Db, orgId: string, userId: string, conversationId: string, body: string) {
  const conv = (await db.query<{ contact_email: string | null; subject: string | null }>(
    `select c2.email as contact_email, c.subject from conversations c left join contacts c2 on c2.id = c.contact_id where c.id = $1 and c.organization_id = $2`, [conversationId, orgId])).rows[0];
  if (!conv?.contact_email) throw new Error("Conversation sans contact email.");
  const res = await ingestInboundEmail(db, orgId, {
    from: conv.contact_email,
    subject: conv.subject ? `RE: ${conv.subject}` : "RE:",
    body,
    providerMessageId: `sim-inbound-${crypto.randomUUID()}`,
    simulated: true,
    conversationId,
  });
  await audit(db, orgId, { type: "user", userId }, "demo.reply_simulated", { type: "conversation", id: conversationId });
  const analysis = await analyzeInbound(db, orgId, res.messageId, { userId });
  return { inboundId: res.messageId, ...analysis };
}
