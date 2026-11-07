/**
 * Discussions WhatsApp et email de LÉA (base réelle, RLS, IA simulée, envois simulés).
 * JONAS est en mode autonome. Horloge injectée : vendredi 6 nov. 2026, 11:00 à Paris.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { withAgent, withUser } from "@/lib/database/client";
import { runAutopilot } from "@/features/agent/autopilot";
import { ingestInboundMessage, sendManualMessage, simulateCustomerReply } from "@/features/conversations/service";
import { analyzeInbound } from "@/features/agent/lea";
import { resetTestDb, ids, privileged } from "./db";

const T0 = new Date("2026-11-06T10:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
let I: Awaited<ReturnType<typeof ids>>;
let waConv: string;

beforeAll(async () => {
  await resetTestDb();
  I = await ids();
  // Quota relevé pour que la journée de LÉA couvre aussi les clients joignables uniquement par WhatsApp.
  await privileged((c) => c.query(`update organization_settings set daily_offer_limit = 200 where organization_id = $1`, [I.orgA]));
});

const q = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => withUser(I.alice, async (db) => (await db.query<T>(sql, p)).rows);
const lastOutbound = async (conv: string) =>
  (await q<{ body: string; status: string; channel: string; subject: string | null; sent_autonomously: boolean; ai_analysis: { template?: { name: string } | null; answers?: string[]; unknown?: string[] } }>(
    `select body, status, channel, subject, sent_autonomously, ai_analysis from messages where conversation_id = $1 and direction = 'outbound' order by created_at desc limit 1`, [conv]))[0]!;

describe("WhatsApp : LÉA engage et mène la discussion", () => {
  it("premier contact WhatsApp avec le modèle approuvé et le PDF de l'offre", async () => {
    const r = await withAgent(I.orgA, (db) => runAutopilot(db, I.orgA, T0));
    expect(r.errors).toEqual([]);
    const convs = await q<{ id: string; customer_id: string }>(`select id, customer_id from conversations where organization_id = $1 and channel = 'whatsapp' and offer_id is not null`, [I.orgA]);
    expect(convs.length).toBeGreaterThan(0);
    waConv = convs[0]!.id;
    const m = await lastOutbound(waConv);
    expect(m).toMatchObject({ channel: "whatsapp", status: "simulated_sent", subject: null, sent_autonomously: true });
    expect(m.ai_analysis.template?.name).toBe("offre_disponible");
    expect(m.body).toMatch(/^Bonjour .+ 👋 .+ Je vous ai préparé la proposition OF-2026-\d{5} : /);
    expect(m.body).toContain("Je vous la valide ?");
    const att = (await q<{ attachments: { filename: string }[] }>(`select attachments from messages where conversation_id = $1 and direction = 'outbound'`, [waConv]))[0]!.attachments;
    expect(att.map((a) => a.filename)).toEqual([expect.stringMatching(/\.pdf$/)]); // WhatsApp : PDF seulement
  });

  it("le client pose des questions : LÉA répond avec les vraies données, en style WhatsApp", async () => {
    const r = await withUser(I.bruno, (db) => simulateCustomerReply(db, I.orgA, I.bruno, waConv, "Bonjour, c'est bien disponible en stock ? Et quel est mon franco de port ?", { now: at(30) }));
    expect(r.analysis.intent).toBe("question");
    expect(r.dispatch?.status).toBe("sent");
    const m = await lastOutbound(waConv);
    expect(m.channel).toBe("whatsapp");
    expect(m.subject).toBeNull();
    expect(m.ai_analysis.template ?? null).toBeNull(); // fenêtre de 24 h ouverte : message libre
    expect(m.body).toMatch(/disponib|stock|réapprovisionnement/);
    const facts = (await q<{ franco: string | null }>(`select cu.franco_amount as franco from conversations c join customers cu on cu.id = c.customer_id where c.id = $1`, [waConv]))[0]!;
    if (facts.franco) expect(m.body).toContain("franco");
    else expect(m.body).toContain("je vérifie auprès de votre commercial");
    expect(m.body).toContain("— LÉA, assistante commerciale de");
    expect(m.body).not.toMatch(/Bien cordialement/);
    // Une commerciale, pas un automate : elle répond bonjour, remercie et conclut vers la commande.
    expect(m.body).toMatch(/^Bonjour .+ !/);
    expect(m.body).toMatch(/Merci pour votre message/);
    expect(m.body).toMatch(/On lance la commande \?/);
  });

  it("question sans donnée fiable : LÉA ne l'invente pas, prévient le client et le commercial", async () => {
    const r = await withUser(I.bruno, (db) => simulateCustomerReply(db, I.orgA, I.bruno, waConv, "Et quel délai de livraison ?", { now: at(40) }));
    expect(r.dispatch?.status).toBe("sent");
    const m = await lastOutbound(waConv);
    expect(m.body).toContain("délai de livraison");
    expect(m.body).toContain("je vérifie auprès de votre commercial");
    expect(m.body).not.toMatch(/\d+\s?(jours|semaines|h)\b/); // aucun délai inventé
    expect(m.body.startsWith("Bonjour")).toBe(false); // pas de formule répétée au fil de la discussion
    expect(await q(`select 1 from followup_tasks where conversation_id = $1 and kind = 'reply' and status = 'pending'`, [waConv])).toHaveLength(1);
  });

  it("accord sur WhatsApp : confirmation et demande de commande", async () => {
    const r = await withUser(I.bruno, (db) => simulateCustomerReply(db, I.orgA, I.bruno, waConv, "Ok c'est validé pour nous, vous pouvez lancer la commande.", { now: at(50) }));
    expect(r.analysis.intent).toBe("accept");
    expect(r.orderNumber).toMatch(/^CMD-/);
    expect((await lastOutbound(waConv)).body).toContain("prise en compte");
    const thread = await q<{ direction: string }>(`select direction from messages where conversation_id = $1 order by created_at`, [waConv]);
    expect(thread.map((t) => t.direction)).toEqual(["outbound", "inbound", "outbound", "inbound", "outbound", "inbound", "outbound"]);
  });

  it("règle des 24 h : plus de message libre, un humain ne peut pas écrire hors fenêtre", async () => {
    await expect(withUser(I.bruno, (db) => sendManualMessage(db, I.orgA, I.bruno, waConv, { body: "Petite question" }, { now: at(120) })))
      .resolves.toMatchObject({ status: "sent" }); // < 24 h après le dernier message du client
  });

  it("STOP sur WhatsApp : liste d'opposition WhatsApp, envois bloqués", async () => {
    const conv = (await q<{ id: string }>(`select id from conversations where organization_id = $1 and channel = 'whatsapp' and offer_id is not null and id <> $2 limit 1`, [I.orgA, waConv]))[0]!;
    const r = await withUser(I.bruno, (db) => simulateCustomerReply(db, I.orgA, I.bruno, conv.id, "STOP", { now: at(60) }));
    expect(r.analysis.intent).toBe("unsubscribe");
    const s = await q<{ channel: string; address: string }>(`select channel, address from suppression_entries where organization_id = $1 and channel = 'whatsapp'`, [I.orgA]);
    expect(s).toHaveLength(1);
    expect(s[0]!.address).toMatch(/^\+336\d{8}$/);
    await expect(withUser(I.bruno, (db) => sendManualMessage(db, I.orgA, I.bruno, conv.id, { body: "Bonjour" }))).rejects.toThrow(/opposition/);
  });
});

describe("Fenêtre WhatsApp et inconnus", () => {
  it("hors fenêtre de 24 h : message libre refusé, la relance passe par le modèle approuvé", async () => {
    const conv = (await q<{ id: string }>(
      `select c.id from conversations c where c.organization_id = $1 and c.channel = 'whatsapp' and c.offer_id is not null and c.last_inbound_at is null and c.status = 'waiting_customer' limit 1`, [I.orgA]))[0];
    expect(conv).toBeTruthy();
    // Aucun message du client : fenêtre fermée → un humain ne peut pas écrire librement.
    await expect(withUser(I.bruno, (db) => sendManualMessage(db, I.orgA, I.bruno, conv!.id, { body: "Bonjour" }))).rejects.toThrow(/24 h/);
    // 6 jours plus tard : LÉA relance avec « relance_offre ».
    const r = await withAgent(I.orgA, (db) => runAutopilot(db, I.orgA, new Date(T0.getTime() + 6 * 86_400_000)));
    expect(r.followupsSent).toBeGreaterThan(0);
    const m = await lastOutbound(conv!.id);
    expect(m.ai_analysis.template?.name).toBe("relance_offre");
    expect(m.status).toBe("simulated_sent");
  });

  it("numéro inconnu : conversation non identifiée, réponse soumise à validation", async () => {
    const r = await withAgent(I.orgA, async (db) => {
      const inbound = await ingestInboundMessage(db, I.orgA, { channel: "whatsapp", from: "33799999999", subject: null, body: "Bonjour, vous avez des bougies en stock ?", providerMessageId: "wamid.TEST1", simulated: true, receivedAt: at(5) });
      return analyzeInbound(db, I.orgA, inbound.messageId, { userId: null }, { now: at(5) });
    });
    expect(r.decision?.mode).toBe("approval");
    const conv = (await q<{ identity_confidence: string; customer_id: string | null }>(`select c.identity_confidence, c.customer_id from conversations c join messages m on m.conversation_id = c.id where m.provider_message_id = 'wamid.TEST1'`))[0]!;
    expect(conv).toEqual({ identity_confidence: "unknown", customer_id: null });
  });

  it("idempotence : un webhook rejoué ne crée pas de doublon", async () => {
    const again = await withAgent(I.orgA, (db) => ingestInboundMessage(db, I.orgA, { channel: "whatsapp", from: "33799999999", subject: null, body: "x", providerMessageId: "wamid.TEST1", simulated: true }));
    expect(again.duplicate).toBe(true);
  });
});

describe("Email : LÉA répond aussi aux questions par email", () => {
  it("question sur la validité et le montant → réponse factuelle", async () => {
    const conv = (await q<{ id: string }>(`select id from conversations where organization_id = $1 and channel = 'email' and offer_id is not null and status = 'waiting_customer' limit 1`, [I.orgA]))[0]!;
    const r = await withUser(I.bruno, (db) => simulateCustomerReply(db, I.orgA, I.bruno, conv.id, "Bonjour, jusqu'à quand l'offre est-elle valable et quel est le montant total ?", { now: at(90) }));
    expect(r.dispatch?.status).toBe("sent");
    const m = await lastOutbound(conv.id);
    expect(m.channel).toBe("email");
    expect(m.body).toMatch(/valable jusqu'au \d{1,2} \p{L}+ 2026/u);
    expect(m.body).toMatch(/€ HT, soit .+ € TTC/);
    expect(m.body).toMatch(/Bien cordialement|À très vite/);
  });
});
