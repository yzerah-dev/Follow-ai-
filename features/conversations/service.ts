import type { Db } from "@/lib/database/client";
import { audit } from "@/lib/security/audit";
import { sanitizeText } from "@/lib/security/untrusted";
import { dispatchMessage } from "./dispatch";
import { analyzeInbound } from "@/features/agent/lea";

export type MessageDecision = { decision: "approved" | "rejected"; note?: string; editedBody?: string; editedSubject?: string };

/**
 * Validation humaine d'un message préparé par LÉA, puis envoi (contrôles dans dispatchMessage).
 */
export async function decideMessage(db: Db, orgId: string, userId: string, messageId: string, d: MessageDecision) {
  const m = (await db.query<{ status: string }>(`select status from messages where id = $1 and organization_id = $2`, [messageId, orgId])).rows[0];
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
  await db.query(`update approvals set status = 'approved', decided_by = $2, decided_at = now(), decision_note = $3 where id = $1`, [approval.id, userId, d.note ?? null]);
  const res = await dispatchMessage(db, orgId, messageId, { type: "user", userId }, {
    autonomous: false,
    subject: d.editedSubject !== undefined ? sanitizeText(d.editedSubject, 160) : undefined,
    body: d.editedBody !== undefined ? sanitizeText(d.editedBody, 8000) : undefined,
  });
  return { sent: true as const, simulated: res.status === "sent" ? res.simulated : true };
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
export async function simulateCustomerReply(db: Db, orgId: string, userId: string, conversationId: string, body: string, opts: { now?: Date } = {}) {
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
  const analysis = await analyzeInbound(db, orgId, res.messageId, { userId: null }, { now: opts.now });
  return { inboundId: res.messageId, ...analysis };
}
