/**
 * Connexion WhatsApp Business (Cloud API de Meta) d'une organisation, avec MODE TEST.
 *
 * Activer cette connexion = activer des envois WhatsApp RÉELS (règle 6) : réservé aux administrateurs (RLS), avec
 * confirmation explicite, et tracé dans l'audit. Le jeton d'accès est chiffré (connection_secrets), jamais affiché.
 * Mode test : les envois réels ne partent QUE vers les numéros de test ; les autres conversations restent simulées,
 * et les messages reçus d'autres numéros sont ignorés.
 */
import type { Db } from "@/lib/database/client";
import { audit } from "@/lib/security/audit";
import { toE164 } from "@/lib/phone";
import { writeConnectionSecret } from "@/lib/integrations/secrets";
import { WHATSAPP_TEMPLATES } from "./templates";

export type WhatsAppConfig = {
  phoneNumberId?: string;
  wabaId?: string;
  testMode?: boolean;
  testNumbers?: string[];
  approvedTemplates?: string[];
  templatesStatus?: string;
};

/** Mode test : seuls les numéros de test reçoivent et envoient des messages réels. */
export function isTestNumberAllowed(config: WhatsAppConfig | null | undefined, e164: string | null): boolean {
  if (!config?.testMode) return true;
  return !!e164 && (config.testNumbers ?? []).includes(e164);
}

/** « 06 12 34 56 78, +33 6 98… » → numéros E.164 valides, dédoublonnés (10 maximum). */
export function parseTestNumbers(raw: string): { numbers: string[]; invalid: string[] } {
  const parts = raw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  const numbers: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    const e = toE164(p);
    if (e && /^\+\d{8,15}$/.test(e)) numbers.push(e);
    else invalid.push(p);
  }
  return { numbers: [...new Set(numbers)].slice(0, 10), invalid };
}

export type WhatsAppConnectionInput = {
  phoneNumberId: string;
  wabaId: string | null;
  accessToken: string | null; // null : conserver le jeton déjà enregistré
  testMode: boolean;
  testNumbers: string[];
  approvedTemplates: string[];
};

export async function saveWhatsAppConnection(db: Db, orgId: string, userId: string, input: WhatsAppConnectionInput) {
  if (!/^\d{5,30}$/.test(input.phoneNumberId)) throw new Error("Identifiant du numéro (Phone number ID) invalide : uniquement des chiffres.");
  if (input.testMode && !input.testNumbers.length) throw new Error("Mode test : indiquez au moins un numéro de test.");
  const templates = input.approvedTemplates.filter((t) => t in WHATSAPP_TEMPLATES);
  const existing = (await db.query<{ id: string }>(`select id from communication_connections where organization_id = $1 and channel = 'whatsapp' and provider = 'whatsapp_cloud'`, [orgId])).rows[0];
  if (!existing && !input.accessToken) throw new Error("Jeton d'accès requis pour la première connexion.");
  const config: WhatsAppConfig = {
    phoneNumberId: input.phoneNumberId, wabaId: input.wabaId ?? undefined, testMode: input.testMode, testNumbers: input.testNumbers,
    approvedTemplates: templates, templatesStatus: templates.length ? "déclarés approuvés par l'administrateur" : "aucun modèle approuvé",
  };
  // RLS : seuls les administrateurs de l'organisation peuvent créer ou modifier une connexion.
  const id = (await db.query<{ id: string }>(
    `insert into communication_connections (organization_id, channel, provider, status, simulation_enabled, display_name, config, last_checked_at)
     values ($1, 'whatsapp', 'whatsapp_cloud', 'connected', false, 'WhatsApp Business', $2, now())
     on conflict (organization_id, channel, provider) do update set status = 'connected', config = excluded.config, last_error = null, updated_at = now(), last_checked_at = now()
     returning id`, [orgId, config])).rows[0]!.id;
  if (input.accessToken) await writeConnectionSecret(orgId, id, { accessToken: input.accessToken });
  await audit(db, orgId, { type: "user", userId }, "connection.whatsapp_real_enabled", { type: "communication_connection", id },
    { phoneNumberId: input.phoneNumberId, testMode: input.testMode, testNumbers: input.testNumbers.length, approvedTemplates: templates, tokenUpdated: !!input.accessToken });
  return id;
}

export async function disconnectWhatsApp(db: Db, orgId: string, userId: string) {
  const r = await db.query<{ id: string }>(`update communication_connections set status = 'not_connected', updated_at = now() where organization_id = $1 and channel = 'whatsapp' and provider = 'whatsapp_cloud' returning id`, [orgId]);
  if (r.rows[0]) await audit(db, orgId, { type: "user", userId }, "connection.whatsapp_real_disabled", { type: "communication_connection", id: r.rows[0].id });
}

/**
 * Rattache les numéros de test à un client (contact WhatsApp consentant) : quand vous écrivez depuis ce numéro,
 * LÉA vous reconnaît comme ce client (identité vérifiée) et répond avec ses données (commandes, factures, stock).
 */
export async function linkTestNumbersToCustomer(db: Db, orgId: string, userId: string, customerId: string, numbers: string[]) {
  const cu = (await db.query<{ id: string }>(`select id from customers where id = $1 and organization_id = $2`, [customerId, orgId])).rows[0];
  if (!cu) throw new Error("Client introuvable.");
  for (const n of numbers) {
    const contactId = (await db.query<{ id: string }>(`select id from contacts where organization_id = $1 and mobile = $2 limit 1`, [orgId, n])).rows[0]?.id
      ?? (await db.query<{ id: string }>(
        `insert into contacts (organization_id, first_name, last_name, mobile, consent_whatsapp, consent_source, consent_at, preferred_channel)
         values ($1, 'Numéro', 'de test', $2, true, 'numéro de test déclaré par l''administrateur', now(), 'whatsapp') returning id`, [orgId, n])).rows[0]!.id;
    await db.query(`update contacts set consent_whatsapp = true, consent_source = coalesce(consent_source, 'numéro de test'), consent_at = coalesce(consent_at, now()) where id = $1`, [contactId]);
    // Un numéro de test appartient à un seul client : l'identité reste « vérifiée ».
    await db.query(`delete from customer_contacts where contact_id = $1 and customer_id <> $2`, [contactId, customerId]);
    await db.query(`insert into customer_contacts (organization_id, customer_id, contact_id, is_primary, can_receive_offers) values ($1,$2,$3,false,true) on conflict do nothing`, [orgId, customerId, contactId]);
  }
  await audit(db, orgId, { type: "user", userId }, "connection.whatsapp_test_numbers_linked", { type: "customer", id: customerId }, { count: numbers.length });
}
