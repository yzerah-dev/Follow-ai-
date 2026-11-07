import type { Db } from "@/lib/database/client";
import { audit } from "@/lib/security/audit";
import { sanitizeText } from "@/lib/security/untrusted";
import { dispatchMessage, normalizeAddress } from "./dispatch";
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
 * Ingestion d'un message entrant (webhook fournisseur ou simulation), tous canaux.
 * Identification : email exact (email) ou numéro E.164 (WhatsApp / SMS) d'un contact de l'organisation.
 * Aucune fusion d'identité si plusieurs sociétés possibles → "probable".
 */
export async function ingestInboundMessage(
  db: Db,
  orgId: string,
  input: { channel: "email" | "whatsapp"; from: string; subject: string | null; body: string; providerMessageId: string; simulated: boolean; conversationId?: string | null; receivedAt?: Date },
) {
  const at = (input.receivedAt ?? new Date()).toISOString();
  const from = normalizeAddress(input.channel, input.from) ?? input.from.trim().toLowerCase();
  const dup = (await db.query<{ id: string }>(`select id from messages where organization_id = $1 and channel = $2 and provider_message_id = $3`, [orgId, input.channel, input.providerMessageId])).rows[0];
  if (dup) return { messageId: dup.id, conversationId: null, duplicate: true as const };
  let conversationId = input.conversationId ?? null;
  if (!conversationId) {
    const contact = (await db.query<{ id: string }>(
      input.channel === "email"
        ? `select id from contacts where organization_id = $1 and lower(email) = $2 limit 1`
        : `select id from contacts where organization_id = $1 and (mobile = $2 or regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') in ($2, '0' || substr($2, 4))) limit 1`,
      [orgId, from])).rows[0];
    if (contact) {
      const companies = (await db.query<{ customer_id: string }>(`select customer_id from customer_contacts where contact_id = $1`, [contact.id])).rows;
      const identity = companies.length === 1 ? "verified" : "probable";
      const conv = (await db.query<{ id: string }>(
        `select id from conversations where organization_id = $1 and contact_id = $2 and channel = $3 and status <> 'closed' order by last_message_at desc nulls last limit 1`, [orgId, contact.id, input.channel])).rows[0];
      conversationId = conv?.id ?? (await db.query<{ id: string }>(
        `insert into conversations (organization_id, customer_id, contact_id, channel, subject, status, identity_confidence, last_message_at)
         values ($1,$2,$3,$6,$4,'waiting_us',$5, $7) returning id`,
        [orgId, companies.length === 1 ? companies[0]!.customer_id : null, contact.id, input.subject, identity, input.channel, at])).rows[0]!.id;
    } else {
      conversationId = (await db.query<{ id: string }>(
        `insert into conversations (organization_id, channel, subject, status, identity_confidence, last_message_at) values ($1,$3,$2,'waiting_us','unknown', $4) returning id`,
        [orgId, input.subject, input.channel, at])).rows[0]!.id;
    }
  }
  const msg = await db.query<{ id: string }>(
    `insert into messages (organization_id, conversation_id, direction, channel, from_address, subject, body, status, provider_message_id, received_at)
     values ($1,$2,'inbound',$7,$3,$4,$5,'received',$6, $8) returning id`,
    [orgId, conversationId, from, input.subject ? sanitizeText(input.subject, 300) : null, sanitizeText(input.body, 20000), input.providerMessageId, input.channel, at],
  );
  await db.query(
    `insert into communication_events (organization_id, conversation_id, message_id, event_type, simulated, payload, idempotency_key)
     values ($1,$2,$3,'message.received',$4,$5,$6) on conflict do nothing`,
    [orgId, conversationId, msg.rows[0]!.id, input.simulated, { from, channel: input.channel }, `recv:${input.channel}:${input.providerMessageId}`],
  );
  // Fenêtre WhatsApp : chaque message du client rouvre 24 h de discussion libre.
  await db.query(`update conversations set last_message_at = $2, last_inbound_at = $2, status = 'waiting_us' where id = $1`, [conversationId, at]);
  return { messageId: msg.rows[0]!.id, conversationId, duplicate: false as const };
}

/** Compatibilité : réception d'un email. */
export const ingestInboundEmail = (db: Db, orgId: string, input: Omit<Parameters<typeof ingestInboundMessage>[2], "channel">) =>
  ingestInboundMessage(db, orgId, { ...input, channel: "email" });

/** Outil de démonstration : simule la réponse d'un client à une conversation (son canal), puis LÉA analyse et répond. */
export async function simulateCustomerReply(db: Db, orgId: string, userId: string, conversationId: string, body: string, opts: { now?: Date } = {}) {
  const conv = (await db.query<{ channel: "email" | "whatsapp"; contact_email: string | null; contact_phone: string | null; subject: string | null }>(
    `select c.channel, ct.email as contact_email, coalesce(ct.mobile, ct.phone) as contact_phone, c.subject
     from conversations c left join contacts ct on ct.id = c.contact_id where c.id = $1 and c.organization_id = $2`, [conversationId, orgId])).rows[0];
  const from = conv?.channel === "whatsapp" ? conv.contact_phone : conv?.contact_email;
  if (!conv || !from) throw new Error("Conversation sans contact joignable sur ce canal.");
  const res = await ingestInboundMessage(db, orgId, {
    channel: conv.channel,
    from,
    subject: conv.channel === "email" ? (conv.subject ? `RE: ${conv.subject}` : "RE:") : null,
    body,
    providerMessageId: `sim-inbound-${crypto.randomUUID()}`,
    simulated: true,
    conversationId,
    receivedAt: opts.now,
  });
  await audit(db, orgId, { type: "user", userId }, "demo.reply_simulated", { type: "conversation", id: conversationId }, { channel: conv.channel });
  // La réponse représente le CLIENT : LÉA agit sous sa propre identité (les règles d'autonomie s'appliquent).
  const analysis = await analyzeInbound(db, orgId, res.messageId, { userId: null }, { now: opts.now });
  return { inboundId: res.messageId, ...analysis };
}

/** Un humain reprend la main et répond lui-même dans la discussion (mêmes contrôles d'envoi que LÉA). */
export async function sendManualMessage(db: Db, orgId: string, userId: string, conversationId: string, input: { body: string; subject?: string | null }, opts: { now?: Date } = {}) {
  const conv = (await db.query<{ channel: "email" | "whatsapp"; contact_email: string | null; contact_phone: string | null; subject: string | null; last_from: string | null }>(
    `select c.channel, ct.email as contact_email, coalesce(ct.mobile, ct.phone) as contact_phone, c.subject,
            (select m.from_address from messages m where m.conversation_id = c.id and m.direction = 'inbound' order by m.created_at desc limit 1) as last_from
     from conversations c left join contacts ct on ct.id = c.contact_id where c.id = $1 and c.organization_id = $2`, [conversationId, orgId])).rows[0];
  if (!conv) throw new Error("Conversation introuvable.");
  const to = conv.last_from ?? (conv.channel === "whatsapp" ? conv.contact_phone : conv.contact_email);
  const body = sanitizeText(input.body, conv.channel === "whatsapp" ? 4096 : 8000).trim();
  if (!body) throw new Error("Message vide.");
  const subject = conv.channel === "email" ? (input.subject?.trim() || (conv.subject ? `RE: ${conv.subject}` : "Votre message")) : null;
  const msg = await db.query<{ id: string }>(
    `insert into messages (organization_id, conversation_id, direction, channel, to_address, subject, body, status, ai_generated, created_by)
     values ($1,$2,'outbound',$3,$4,$5,$6,'approved',false,$7) returning id`,
    [orgId, conversationId, conv.channel, to, subject, body, userId],
  );
  // Le commercial a répondu : les messages entrants sont traités, les brouillons de LÉA en attente sont écartés.
  await db.query(`update messages set handled = true where conversation_id = $1 and direction = 'inbound' and not handled`, [conversationId]);
  const res = await dispatchMessage(db, orgId, msg.rows[0]!.id, { type: "user", userId }, { autonomous: false, now: opts.now });
  await audit(db, orgId, { type: "user", userId }, "message.manual_reply", { type: "conversation", id: conversationId }, { channel: conv.channel });
  return res;
}
