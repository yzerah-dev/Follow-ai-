/**
 * Vrai WhatsApp (Meta Cloud API) en MODE TEST, réseau vers Meta simulé (aucun compte Meta dans l'environnement de test) :
 * webhook signé → numéro de test reconnu comme client → réponse de LÉA envoyée à Meta ;
 * autres numéros ignorés ; autres conversations toujours simulées ; Excel reçu téléchargé.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { withAgent, withUser } from "@/lib/database/client";
import { saveWhatsAppConnection, linkTestNumbersToCustomer } from "@/features/conversations/whatsapp-connection";
import { simulateCustomerReply } from "@/features/conversations/service";
import { POST } from "@/app/api/webhooks/whatsapp/route";
import { resetTestDb, ids, privileged } from "./db";

let I: Awaited<ReturnType<typeof ids>>;
const TEST_NUMBER = "+33600000001";
const PNID = "100200300";
const SECRET = "test-app-secret";
const sent: { url: string; body: Record<string, unknown> | null }[] = [];
let xlsx: Buffer;

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

beforeAll(async () => {
  await resetTestDb();
  I = await ids();
  process.env.WHATSAPP_APP_SECRET = SECRET;
  // Envois autonomes possibles à toute heure (le test ne dépend pas de l'horloge).
  await privileged((c) => c.query(`update organization_settings set send_window = '{"days":[0,1,2,3,4,5,6],"start":"00:00","end":"23:59"}' where organization_id = $1`, [I.orgA]));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("x");
  ws.getRow(1).values = ["Référence", "Quantité"];
  ws.getRow(2).values = ["JNS-10001", 12];
  xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    sent.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    if (url.endsWith("/media")) return ok({ id: "MEDIA1" });
    if (url.endsWith("/messages")) return ok({ messages: [{ id: `wamid.out.${sent.length}` }] });
    if (url.includes("/998877")) return ok({ url: "https://lookaside.example/file", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", file_size: xlsx.length });
    if (url.startsWith("https://lookaside.example/")) return new Response(new Uint8Array(xlsx));
    return new Response("inconnu", { status: 404 });
  }));
});
afterAll(() => vi.unstubAllGlobals());

const q = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => withUser(I.alice, async (db) => (await db.query<T>(sql, p)).rows);

function webhook(from: string, message: Record<string, unknown>) {
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: PNID }, messages: [{ from, id: `wamid.in.${crypto.randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }] });
  const sig = `sha256=${crypto.createHmac("sha256", SECRET).update(raw).digest("hex")}`;
  return POST(new Request("https://lea.example/api/webhooks/whatsapp", { method: "POST", body: raw, headers: { "x-hub-signature-256": sig, "x-forwarded-for": "1.2.3.4" } }));
}

describe("Vrai WhatsApp en mode test", () => {
  let customerId: string;
  it("connexion réservée aux administrateurs, jeton chiffré, numéro de test rattaché à un client", async () => {
    customerId = (await q<{ id: string }>(`select id from customers where organization_id = $1 and external_code = 'C00001'`, [I.orgA]))[0]!.id;
    const input = { phoneNumberId: PNID, wabaId: null, accessToken: "EAAG-test-token", testMode: true, testNumbers: [TEST_NUMBER], approvedTemplates: [] };
    await expect(withUser(I.bruno, (db) => saveWhatsAppConnection(db, I.orgA, I.bruno, input))).rejects.toThrow(); // commercial : refusé (RLS)
    await withUser(I.alice, async (db) => {
      await saveWhatsAppConnection(db, I.orgA, I.alice, input);
      await linkTestNumbersToCustomer(db, I.orgA, I.alice, customerId, [TEST_NUMBER]);
    });
    const secret = await privileged(async (c) => (await c.query<{ ciphertext: string }>(`select ciphertext from connection_secrets s join communication_connections cc on cc.id = s.connection_id where cc.organization_id = $1 and cc.provider = 'whatsapp_cloud'`, [I.orgA])).rows[0]!);
    expect(secret.ciphertext).not.toContain("EAAG-test-token");
  });

  it("vous écrivez depuis le numéro de test : LÉA vous reconnaît et vous répond pour de vrai (via Meta)", async () => {
    sent.length = 0;
    const p = (await q<{ reference: string }>(`select p.reference from products p where p.organization_id = $1 and exists (select 1 from inventory_snapshots s where s.product_id = p.id and s.qty_available > 0) limit 1`, [I.orgA]))[0]!;
    const res = await webhook(TEST_NUMBER.slice(1), { type: "text", text: { body: `Bonjour Léa, as-tu la référence ${p.reference} en stock ?` } });
    expect((await res.json()).processed).toBe(1);
    const conv = (await q<{ customer_id: string; identity_confidence: string; id: string }>(
      `select c.id, c.customer_id, c.identity_confidence from conversations c join contacts ct on ct.id = c.contact_id where ct.mobile = $1 and c.channel = 'whatsapp'`, [TEST_NUMBER]))[0]!;
    expect(conv).toMatchObject({ customer_id: customerId, identity_confidence: "verified" });
    const out = (await q<{ status: string; body: string }>(`select status, body from messages where conversation_id = $1 and direction = 'outbound' order by created_at desc limit 1`, [conv.id]))[0]!;
    expect(out.status).toBe("sent"); // envoi RÉEL (pas « simulated_sent »)
    const call = sent.find((s) => s.url.endsWith(`/${PNID}/messages`))!;
    expect(call.body).toMatchObject({ to: TEST_NUMBER.slice(1), type: "text" });
    expect(String((call.body as { text: { body: string } }).text.body)).toContain(p.reference);
  });

  it("un autre numéro écrit : ignoré, aucune réponse", async () => {
    sent.length = 0;
    const res = await webhook("33699999999", { type: "text", text: { body: "Bonjour, vous avez des bougies ?" } });
    expect((await res.json()).processed).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("les autres conversations restent simulées tant que le mode test est actif", async () => {
    sent.length = 0;
    const conv = (await q<{ id: string }>(
      `select c.id from conversations c join contacts ct on ct.id = c.contact_id where c.organization_id = $1 and c.channel = 'whatsapp' and ct.mobile <> $2 and c.identity_confidence = 'verified' limit 1`, [I.orgA, TEST_NUMBER]))[0]!;
    expect(conv).toBeTruthy();
    await withUser(I.bruno, (db) => simulateCustomerReply(db, I.orgA, I.bruno, conv.id, "Bonjour, as-tu des bougies en stock ?"));
    const out = (await q<{ status: string }>(`select status from messages where conversation_id = $1 and direction = 'outbound' order by created_at desc limit 1`, [conv.id]))[0]!;
    expect(out.status).toBe("simulated_sent");
    expect(sent).toHaveLength(0);
  });

  it("vous envoyez un Excel : LÉA le télécharge chez Meta et le traite", async () => {
    sent.length = 0;
    const res = await webhook(TEST_NUMBER.slice(1), { type: "document", document: { id: "998877", filename: "mes-quantites.xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
    expect((await res.json()).processed).toBe(1);
    expect(sent.some((s) => s.url.includes("/998877"))).toBe(true);
    const inbound = (await q<{ attachments: { filename: string }[] }>(
      `select m.attachments from messages m join conversations c on c.id = m.conversation_id join contacts ct on ct.id = c.contact_id where ct.mobile = $1 and m.direction = 'inbound' order by m.created_at desc limit 1`, [TEST_NUMBER]))[0]!;
    expect(inbound.attachments[0]!.filename).toBe("mes-quantites.xlsx");
  });

  it("signature Meta invalide : refusé", async () => {
    const res = await POST(new Request("https://lea.example/api/webhooks/whatsapp", { method: "POST", body: "{}", headers: { "x-hub-signature-256": "sha256=00" } }));
    expect(res.status).toBe(401);
    await withAgent(I.orgA, async () => undefined);
  });
});
