/**
 * Mode autonome de LÉA (base réelle, RLS, IA simulée).
 * JONAS : autonome, remise 1 % sans validation. Beta : supervisé.
 * Horloge injectée : vendredi 6 nov. 2026 11:00 (Paris) = dans la plage d'envoi.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { withAgent, withUser } from "@/lib/database/client";
import { runAutopilot, sendDueMessages } from "@/features/agent/autopilot";
import { simulateCustomerReply } from "@/features/conversations/service";
import { resetTestDb, ids, privileged } from "./db";

const FRIDAY = new Date("2026-11-06T10:00:00Z");
const SATURDAY = new Date("2026-11-07T10:00:00Z");
let I: Awaited<ReturnType<typeof ids>>;

beforeAll(async () => {
  await resetTestDb();
  I = await ids();
});

const q = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => withUser(I.alice, async (db) => (await db.query<T>(sql, p)).rows);
const heroConversation = async () =>
  (await q<{ id: string; offer_id: string }>(`select cv.id, cv.offer_id from conversations cv join customers c on c.id = cv.customer_id where c.external_code = 'C00001' and cv.offer_id is not null`))[0]!;

describe("LÉA autonome — journée de travail", () => {
  it("prépare, valide, compose et envoie seule les offres, sans aucune action humaine", async () => {
    const r = await withAgent(I.orgA, (db) => runAutopilot(db, I.orgA, FRIDAY));
    expect(r.skipped).toBeUndefined();
    expect(r.errors).toEqual([]);
    expect(r.offersCreated).toBeGreaterThan(0);
    expect(r.offersCreated).toBeLessThanOrEqual(20); // quota quotidien
    expect(r.emailsSent).toBe(r.offersCreated - r.offersPendingApproval);

    const hero = await heroConversation();
    const msg = (await q<{ status: string; sent_autonomously: boolean; body: string; attachments: unknown[] }>(`select status, sent_autonomously, body, attachments from messages where conversation_id = $1`, [hero.id]))[0]!;
    expect(msg).toMatchObject({ status: "simulated_sent", sent_autonomously: true });
    expect(msg.body).toContain("Bonjour Monsieur Martin");
    expect(msg.body).toContain("LÉA");
    expect(msg.attachments).toHaveLength(2); // PDF + Excel validés automatiquement (contrôles OK)
    const offer = (await q<{ status: string }>(`select status from offers where id = $1`, [hero.offer_id]))[0]!;
    expect(offer.status).toBe("sent");
    const pending = await q(`select 1 from approvals where organization_id = $1 and status = 'pending' and subject_type in ('offer','message')`, [I.orgA]);
    expect(pending.length).toBe(r.offersPendingApproval);
    const followup = await q<{ due_at: string }>(`select due_at from followup_tasks where conversation_id = $1 and kind = 'followup' and status = 'pending'`, [hero.id]);
    expect(followup).toHaveLength(1);
  });

  it("ne refait rien en double le même jour (quota atteint)", async () => {
    const r = await withAgent(I.orgA, (db) => runAutopilot(db, I.orgA, new Date(FRIDAY.getTime() + 3600_000)));
    expect(r.offersCreated).toBe(0);
  });

  it("remise de 1 % : envoyée seule et appliquée à l'offre", async () => {
    const hero = await heroConversation();
    const before = (await q<{ total_ht: string }>(`select total_ht from offers where id = $1`, [hero.offer_id]))[0]!.total_ht;
    const r = await withUser(I.bruno, (db) => simulateCustomerReply(db, I.orgA, I.bruno, hero.id, "Bonjour, c'est un peu trop cher. Pouvez-vous faire un geste de 1 % ?", { now: FRIDAY }));
    expect(r.decision?.mode).toBe("auto");
    expect(r.dispatch?.status).toBe("sent");
    const reply = (await q<{ body: string; status: string }>(`select body, status from messages where id = $1`, [r.replyMessageId]))[0]!;
    expect(reply.status).toBe("simulated_sent");
    expect(reply.body).toMatch(/1\s?%/);
    const after = (await q<{ total_ht: string; discount_total_ht: string }>(`select total_ht, discount_total_ht from offers where id = $1`, [hero.offer_id]))[0]!;
    expect(Number(after.total_ht)).toBeLessThan(Number(before));
    expect(Number(after.discount_total_ht)).toBeGreaterThan(0);
    const lines = await q<{ discount_pct: string }>(`select distinct discount_pct from offer_lines where offer_id = $1`, [hero.offer_id]);
    expect(lines.map((l) => l.discount_pct)).toEqual(["1.00"]);
  });

  it("remise de 5 % : rien n'est envoyé, le commercial reprend la main", async () => {
    const hero = await heroConversation();
    const r = await withUser(I.bruno, (db) => simulateCustomerReply(db, I.orgA, I.bruno, hero.id, "Il me faut 5 % de remise, sinon je vais ailleurs.", { now: FRIDAY }));
    expect(r.escalated).toBe(true);
    expect(r.decision?.mode).toBe("approval");
    expect(r.dispatch).toBeNull();
    const reply = (await q<{ status: string }>(`select status from messages where id = $1`, [r.replyMessageId]))[0]!;
    expect(reply.status).toBe("pending_approval");
    expect(await q(`select 1 from followup_tasks where kind = 'escalation' and conversation_id = $1`, [hero.id])).toHaveLength(1);
  });

  it("accord du client : réponse envoyée et demande de commande créée par LÉA", async () => {
    const hero = await heroConversation();
    const r = await withUser(I.bruno, (db) => simulateCustomerReply(db, I.orgA, I.bruno, hero.id, "C'est validé pour nous, vous pouvez lancer la commande.", { now: FRIDAY }));
    expect(r.analysis.intent).toBe("accept");
    expect(r.orderNumber).toMatch(/^CMD-/);
    expect(r.dispatch?.status).toBe("sent");
    const order = (await q<{ total_ht: string; created_by: string | null }>(`select o.total_ht, o.created_by from order_requests o where o.offer_id = $1`, [hero.offer_id]))[0]!;
    const offer = (await q<{ total_ht: string; status: string }>(`select total_ht, status from offers where id = $1`, [hero.offer_id]))[0]!;
    expect(order.total_ht).toBe(offer.total_ht); // remise de 1 % incluse
    expect(order.created_by).toBeNull();
    expect(offer.status).toBe("accepted");
  });

  it("hors plage d'envoi : programmé puis envoyé à l'ouverture", async () => {
    const conv = (await q<{ id: string }>(
      `select cv.id from conversations cv join customers c on c.id = cv.customer_id where cv.organization_id = $1 and cv.offer_id is not null and c.external_code <> 'C00001' and cv.status = 'waiting_customer' limit 1`, [I.orgA]))[0]!;
    const r = await withUser(I.bruno, (db) => simulateCustomerReply(db, I.orgA, I.bruno, conv.id, "Bonjour, pourrions-nous organiser un rendez-vous en visio ?", { now: SATURDAY }));
    expect(r.dispatch?.status).toBe("scheduled");
    if (r.dispatch?.status !== "scheduled") return;
    expect(new Date(r.dispatch.scheduledAt).toISOString()).toBe("2026-11-09T07:30:00.000Z"); // lundi 8h30 Paris
    expect(await withAgent(I.orgA, (db) => sendDueMessages(db, I.orgA, new Date("2026-11-08T10:00:00Z")))).toBe(0);
    expect(await withAgent(I.orgA, (db) => sendDueMessages(db, I.orgA, new Date("2026-11-09T07:35:00Z")))).toBe(1);
    expect(await q(`select 1 from followup_tasks where kind = 'meeting' and conversation_id = $1`, [conv.id])).toHaveLength(1);
  });

  it("relances : 2 relances automatiques maximum, puis le commercial", async () => {
    const day = (n: number) => new Date(FRIDAY.getTime() + n * 86_400_000);
    const r1 = await withAgent(I.orgA, (db) => runAutopilot(db, I.orgA, day(6))); // jeudi 12
    expect(r1.followupsSent).toBeGreaterThan(0);
    const r2 = await withAgent(I.orgA, (db) => runAutopilot(db, I.orgA, day(13))); // jeudi 19
    expect(r2.followupsSent).toBeGreaterThan(0);
    const attempts = await q<{ attempt: string }>(`select distinct ai_analysis->>'attempt' as attempt from messages where organization_id = $1 and ai_analysis->>'kind' = 'followup' and sent_autonomously`, [I.orgA]);
    expect(attempts.map((a) => a.attempt).sort()).toEqual(["1", "2"]);
    await withAgent(I.orgA, (db) => runAutopilot(db, I.orgA, day(20))); // jeudi 26 : 3e relance → validation humaine
    const third = await q<{ status: string }>(`select status from messages where organization_id = $1 and ai_analysis->>'kind' = 'followup' and ai_analysis->>'attempt' = '3'`, [I.orgA]);
    expect(third.length).toBeGreaterThan(0);
    expect(third.every((m) => m.status === "pending_approval")).toBe(true);
  });

  it("interrupteur : LÉA suspendue n'envoie plus rien", async () => {
    await privileged((c) => c.query(`update organization_settings set autonomy_paused = true where organization_id = $1`, [I.orgA]));
    const r = await withAgent(I.orgA, (db) => runAutopilot(db, I.orgA, new Date("2026-12-01T10:00:00Z")));
    expect(r.skipped).toMatch(/suspendue/);
    await privileged((c) => c.query(`update organization_settings set autonomy_paused = false where organization_id = $1`, [I.orgA]));
  });
});

describe("Organisation supervisée (Beta) : les réglages JONAS ne s'appliquent pas", () => {
  it("le pilote automatique n'envoie rien et les réponses attendent une validation", async () => {
    const r = await withAgent(I.orgB, (db) => runAutopilot(db, I.orgB, FRIDAY));
    expect(r.skipped).toMatch(/supervisé/);
    expect(await withUser(I.chloe, async (db) => (await db.query(`select 1 from messages where sent_autonomously`)).rowCount)).toBe(0);
  });
});
