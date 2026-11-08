/**
 * Discussions WhatsApp et email de LÉA (base réelle, RLS, IA simulée, envois simulés).
 * JONAS est en mode autonome. Horloge injectée : vendredi 6 nov. 2026, 11:00 à Paris.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { withAgent, withUser } from "@/lib/database/client";
import { runAutopilot } from "@/features/agent/autopilot";
import { ingestInboundMessage, sendManualMessage, simulateCustomerReply, simulateCustomerExcelReply } from "@/features/conversations/service";
import ExcelJS from "exceljs";
import { getFile } from "@/lib/storage";
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
    expect(m.body).toMatch(/^Bonjour .+, j'espère que vous allez bien .+ Je vous ai préparé une sélection de [\d\s,]+€ HT/);
    expect(m.body).not.toMatch(/OF-2026-\d{5}|valable jusqu/); // règles JONAS : ni numéro ni date de fin
    expect(m.body).toContain("Souhaitez-vous que je la valide ?");
    expect(m.body).toMatch(/Merci d'avance pour votre retour,\nLéa de chez .+$/); // nouvelle sollicitation : signée
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
    expect(m.body).not.toContain("Léa de chez"); // réponse dans la discussion : pas de signature
    expect(m.body).not.toMatch(/Bien cordialement/);
    // Une commerciale, pas un automate : elle répond bonjour, remercie et conclut vers la commande.
    expect(m.body).toMatch(/^Bonjour .+ !/);
    expect(m.body).toMatch(/Merci pour votre message/);
    expect(m.body).toMatch(/Souhaitez-vous que je lance la commande \?/);
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
    // Règles JONAS : ni numéro d'offre ni date de fin ; l'Excel est joint pour que le client renvoie ses quantités.
    expect(m.body).not.toMatch(/OF-2026-\d{5}|valable jusqu/);
    expect(m.body).toContain("renvoyez-moi simplement l'Excel avec vos quantités adaptées");
    const att = (await q<{ attachments: { filename: string }[] }>(`select attachments from messages where conversation_id = $1 and direction = 'outbound' order by created_at desc limit 1`, [conv!.id]))[0]!.attachments;
    expect(att.map((a) => a.filename)).toEqual([expect.stringMatching(/\.xlsx$/)]);
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

describe("Le client renvoie l'Excel avec ses quantités", () => {
  it("LÉA met la commande à jour (prix du catalogue, colisage), retire les lignes vidées et répond", async () => {
    const conv = (await q<{ id: string; offer_id: string }>(
      `select c.id, c.offer_id from conversations c join offers o on o.id = c.offer_id join contacts ct on ct.id = c.contact_id
       where c.organization_id = $1 and c.channel = 'whatsapp' and o.status in ('sent','negotiation') and c.id <> $2
         and not exists (select 1 from suppression_entries x where x.organization_id = c.organization_id and x.address = ct.mobile) limit 1`, [I.orgA, waConv]))[0]!;
    expect(conv).toBeTruthy();
    const before = await q<{ product_id: string; reference: string; quantity: string; unit_price_ht: string; units_per_case: number | null }>(
      `select ol.product_id, p.reference, ol.quantity::text, ol.unit_price_ht::text, p.units_per_case from offer_lines ol join products p on p.id = ol.product_id where ol.offer_id = $1 order by ol.line_no`, [conv.offer_id]);
    expect(before.length).toBeGreaterThanOrEqual(2);
    const asset = (await q<{ storage_path: string }>(`select storage_path from generated_assets where offer_id = $1 and kind = 'offer_excel' order by created_at desc limit 1`, [conv.offer_id]))[0]!;

    // Le client : 1re ligne à 1 pièce (hors colisage) avec un prix bidon, 2e ligne vidée.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await getFile(asset.storage_path)) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    ws.getRow(8).getCell(6).value = 1;
    ws.getRow(8).getCell(7).value = 0.01;
    ws.getRow(9).getCell(6).value = null;
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const r = await withUser(I.bruno, (db) => simulateCustomerExcelReply(db, I.orgA, I.bruno, conv.id, { filename: "mes-quantites.xlsx", buffer }, "Voici mes quantités", { now: at(400) }));
    expect(r.status).toBe("revised");
    expect(r.dispatch?.status).toBe("sent");
    const revised = r.revisedOfferId!;
    const offers = await q<{ id: string; status: string; supersedes_offer_id: string | null }>(`select id, status, supersedes_offer_id from offers where id = any($1::uuid[])`, [[conv.offer_id, revised]]);
    expect(offers.find((o) => o.id === conv.offer_id)!.status).toBe("superseded");
    expect(offers.find((o) => o.id === revised)!.supersedes_offer_id).toBe(conv.offer_id);
    const after = await q<{ product_id: string; quantity: string; unit_price_ht: string }>(`select product_id, quantity::text, unit_price_ht::text from offer_lines where offer_id = $1`, [revised]);
    const first = after.find((l) => l.product_id === before[0]!.product_id)!;
    expect(Number(first.quantity)).toBe(Math.max(1, before[0]!.units_per_case ?? 1)); // arrondi au colisage
    expect(Number(first.unit_price_ht)).not.toBe(0.01); // le prix du fichier est ignoré
    expect(after.some((l) => l.product_id === before[1]!.product_id)).toBe(false); // ligne vidée → retirée
    expect(after.length).toBe(before.length - 1);
    const m = await lastOutbound(conv.id);
    expect(m.body).toMatch(/^Merci .+, c'est noté ! J'ai mis à jour votre commande avec vos quantités/);
    expect(m.body).toContain("Retiré à votre demande");
    expect(m.body).not.toMatch(/OF-2026-\d{5}/);
    expect((await q<{ c: string }>(`select offer_id::text c from conversations where id = $1`, [conv.id]))[0]!.c).toBe(revised);
    const inbound = (await q<{ attachments: { filename: string }[] }>(`select attachments from messages where conversation_id = $1 and direction = 'inbound' order by created_at desc limit 1`, [conv.id]))[0]!;
    expect(inbound.attachments[0]!.filename).toBe("mes-quantites.xlsx");
  });

  it("fichier illisible : LÉA demande l'Excel d'origine, aucune offre créée", async () => {
    const conv = (await q<{ id: string; offer_id: string }>(`select c.id, c.offer_id from conversations c join offers o on o.id = c.offer_id where c.organization_id = $1 and c.channel = 'whatsapp' and o.status in ('sent','negotiation') limit 1`, [I.orgA]))[0]!;
    const n = async () => Number((await q<{ n: string }>(`select count(*) n from offers where organization_id = $1`, [I.orgA]))[0]!.n);
    const before = await n();
    const r = await withUser(I.bruno, (db) => simulateCustomerExcelReply(db, I.orgA, I.bruno, conv.id, { filename: "photo.xlsx", buffer: Buffer.from("pas un excel") }, "", { now: at(420) }));
    expect(r.status).toBe("unreadable");
    expect(await n()).toBe(before);
    expect((await lastOutbound(conv.id)).body).toContain("Je n'arrive pas à le lire");
  });
});
