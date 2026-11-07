/**
 * Les 6 missions de LÉA sur base réelle (RLS, IA simulée, envois simulés).
 * Horloge injectée : vendredi 6 nov. 2026 11:00 (Paris).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { withAgent, withUser } from "@/lib/database/client";
import { runAutopilot } from "@/features/agent/autopilot";
import { runOpportunityScan } from "@/features/opportunities/service";
import { draftMeetingProposal } from "@/features/agent/lea";
import { simulateCustomerReply } from "@/features/conversations/service";
import { acceptOfferAndPrepareOrder } from "@/features/offers/service";
import { getCustomer } from "@/features/customers/queries";
import { getLeaPerformance } from "@/features/dashboard/performance";
import { resetTestDb, ids, privileged, TODAY } from "./db";

const NOW = new Date("2026-11-06T10:00:00Z");
let I: Awaited<ReturnType<typeof ids>>;
let hero: string;

beforeAll(async () => {
  await resetTestDb();
  I = await ids();
  hero = await privileged(async (c) => (await c.query<{ id: string }>(`select id from customers where organization_id = $1 and external_code = 'C00001'`, [I.orgA])).rows[0]!.id);
});

const q = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => withUser(I.alice, async (db) => (await db.query<T>(sql, p)).rows);

describe("Détection quotidienne des 6 missions", () => {
  it("chaque mission produit des opportunités justifiées, priorisées et dédoublonnées", async () => {
    const byType = Object.fromEntries((await q<{ type: string; n: number }>(`select type, count(*)::int n from opportunities where organization_id = $1 and status = 'open' group by type`, [I.orgA])).map((r) => [r.type, r.n]));
    for (const t of ["dormant_customer", "reorder", "cross_sell", "back_in_stock", "new_product", "appointment", "target_gap"]) expect(byType[t], t).toBeGreaterThan(0);
    const scored = await q<{ ok: boolean }>(`select bool_and(details ? 'scoring' and details ? 'mission') as ok from opportunities where organization_id = $1`, [I.orgA]);
    expect(scored[0]!.ok).toBe(true);
    // Recalcul : aucune création en double
    const again = await withAgent(I.orgA, (db) => runOpportunityScan(db, I.orgA, TODAY));
    expect(again.created).toBe(0);
  });

  it("fiche client : objectif, réalisé, écart, prévision, permanents, plan de développement", async () => {
    const c = await withUser(I.bruno, (db) => getCustomer(db, I.orgA, hero, TODAY));
    const t = c!.growth.targets[0]!.progress;
    expect(t.periodType).toBe("year");
    expect(t.status).toBe("behind");
    expect(Number(t.gapHt)).toBeLessThan(0);
    expect(t.forecastHt).not.toBeNull();
    expect(c!.growth.permanents.length).toBe(4);
    expect(c!.growth.permanents.every((p) => Number(p.suggestedQty) % 6 === 0 || Number(p.suggestedQty) % 24 === 0 || Number(p.suggestedQty) > 0)).toBe(true);
    expect(c!.growth.targetGap?.justification).toMatch(/Réalisé .* pour un attendu à date de/);
    expect(c!.growth.plan.some((p) => p.type === "reorder" && p.valueHt)).toBe(true);
    expect(c!.growth.lastMeeting).toBeNull(); // aucun rendez-vous : affiché « À confirmer »
  });

  it("client sans objectif : aucun écart ni prévision inventés", async () => {
    const without = await privileged(async (c) => (await c.query<{ id: string }>(
      `select cu.id from customers cu where cu.organization_id = $1 and not exists (select 1 from customer_targets t where t.customer_id = cu.id) limit 1`, [I.orgA])).rows[0]!.id);
    const c = await withUser(I.bruno, (db) => getCustomer(db, I.orgA, without, TODAY));
    expect(c!.growth.targets).toEqual([]);
    expect(c!.growth.targetGap).toBeNull();
  });
});

describe("Mission 5 — rendez-vous", () => {
  it("invitation au client sans analyse interne, argumentaire chiffré au commercial", async () => {
    const opp = (await q<{ id: string; customer_id: string }>(`select id, customer_id from opportunities where organization_id = $1 and type = 'appointment' and status = 'open' order by priority desc limit 1`, [I.orgA]))[0]!;
    const r = await withAgent(I.orgA, (db) => draftMeetingProposal(db, I.orgA, opp.id, { autonomous: false, now: NOW }));
    if (r.channel === "phone") {
      expect(await q(`select 1 from followup_tasks where idempotency_key = $1`, [`meeting-call:${opp.id}`])).toHaveLength(1);
      return;
    }
    const m = (await q<{ body: string; status: string }>(`select body, status from messages where id = $1`, [r.messageId]))[0]!;
    expect(m.status).toBe("pending_approval"); // brouillon non autonome : validation humaine
    expect(m.body).toMatch(/rendez-vous|point de 20 minutes/);
    expect(m.body).not.toMatch(/baisse|retard|objectif|chiffre d'affaires/i);
    const task = (await q<{ notes: string }>(`select notes from followup_tasks where idempotency_key = $1`, [`meeting-prep:${opp.id}`]))[0]!;
    expect(task.notes).toMatch(/Argumentaire : CA facturé sur 12 mois/);
  });
});

describe("Respect des refus, préférences et pression commerciale", () => {
  it("un refus met le client en pause : plus aucune opportunité proactive", async () => {
    const conv = await withAgent(I.orgA, async (db) => {
      const c = (await db.query<{ id: string }>(
        `select cv.id from conversations cv join customers cu on cu.id = cv.customer_id where cv.organization_id = $1 and cv.channel = 'email' and cv.contact_id is not null and cu.id <> $2 limit 1`, [I.orgA, hero])).rows[0];
      return c?.id;
    });
    expect(conv).toBeTruthy();
    const customerId = (await q<{ customer_id: string }>(`select customer_id from conversations where id = $1`, [conv]))[0]!.customer_id;
    // une réponse de LÉA a déjà été envoyée dans cette conversation de démonstration : simuler le refus du client
    await withUser(I.bruno, (db) => simulateCustomerReply(db, I.orgA, I.bruno, conv!, "Non merci, nous ne souhaitons pas donner suite.", { now: NOW }));
    const cu = (await q<{ solicit_paused_until: string | null }>(`select solicit_paused_until from customers where id = $1`, [customerId]))[0]!;
    expect(cu.solicit_paused_until! > TODAY).toBe(true);
    await withAgent(I.orgA, (db) => runOpportunityScan(db, I.orgA, TODAY));
    expect(await q(`select 1 from opportunities where customer_id = $1 and status = 'open'`, [customerId])).toHaveLength(0);
  });

  it("« ne plus solliciter » : le client sort de toutes les missions", async () => {
    const id = (await q<{ id: string }>(`select customer_id as id from opportunities where organization_id = $1 and status = 'open' and customer_id <> $2 limit 1`, [I.orgA, hero]))[0]!.id;
    await withUser(I.alice, (db) => db.query(`update customers set do_not_solicit = true where id = $1`, [id]));
    await withAgent(I.orgA, (db) => runOpportunityScan(db, I.orgA, TODAY));
    expect(await q(`select 1 from opportunities where customer_id = $1 and status = 'open'`, [id])).toHaveLength(0);
  });

  it("organisation supervisée : LÉA prépare chaque jour, rien ne part sans validation", async () => {
    const r = await withAgent(I.orgB, (db) => runAutopilot(db, I.orgB, NOW));
    expect(r.skipped).toBeUndefined();
    expect(r.offersCreated).toBeGreaterThan(0);
    expect(r.offersPendingApproval).toBe(r.offersCreated);
    expect(r.emailsSent).toBe(0);
    expect(await withUser(I.chloe, async (db) => (await db.query(`select 1 from messages where sent_autonomously`)).rowCount)).toBe(0);
    const pending = await withUser(I.chloe, async (db) => (await db.query<{ n: number }>(`select count(*)::int n from approvals where status = 'pending'`)).rows[0]!.n);
    expect(pending).toBeGreaterThanOrEqual(r.offersCreated);
    expect(r.plansCreated + r.meetingsProposed).toBeGreaterThan(0);
  });

  it("pression commerciale : un client sollicité n'est pas relancé par une autre mission le lendemain", async () => {
    const day1 = await withAgent(I.orgA, (db) => runAutopilot(db, I.orgA, NOW));
    expect(day1.emailsSent).toBeGreaterThan(0);
    const contacted = await q<{ customer_id: string }>(`select distinct c.customer_id from messages m join conversations c on c.id = m.conversation_id where m.organization_id = $1 and m.sent_autonomously`, [I.orgA]);
    const day2 = await withAgent(I.orgA, (db) => runAutopilot(db, I.orgA, new Date(NOW.getTime() + 86_400_000)));
    expect(day2.pressureSkipped).toBeGreaterThan(0);
    const twice = await q<{ customer_id: string; n: number }>(
      `select c.customer_id, count(*)::int n from messages m join conversations c on c.id = m.conversation_id
       where m.organization_id = $1 and m.sent_autonomously and m.reply_to_message_id is null and coalesce(m.ai_analysis->>'kind','') <> 'followup'
       group by 1 having count(*) > 1`, [I.orgA]);
    expect(twice.filter((t) => contacted.some((c) => c.customer_id === t.customer_id))).toEqual([]);
  });
});

describe("Mesure des conversions et du CA attribuable", () => {
  it("commande et CA facturé attribués à la mission, plafonnés à l'offre", async () => {
    const offer = (await q<{ id: string; customer_id: string; total_ht: string; sent_at: string }>(
      `select o.id, o.customer_id, o.total_ht, o.sent_at from offers o join opportunities op on op.id = o.opportunity_id
       where o.organization_id = $1 and op.type = 'reorder' and o.sent_at is not null limit 1`, [I.orgA]))[0]!;
    await withUser(I.bruno, (db) => acceptOfferAndPrepareOrder(db, I.orgA, I.bruno, offer.id));
    // Facture ERP émise 10 jours après l'envoi, sur les produits de l'offre, pour un montant supérieur à l'offre
    await withUser(I.alice, async (db) => {
      const line = (await db.query<{ product_id: string; unit_price_ht: string }>(`select product_id, unit_price_ht from offer_lines where offer_id = $1 limit 1`, [offer.id])).rows[0]!;
      const inv = (await db.query<{ id: string }>(
        `insert into invoices (organization_id, invoice_number, customer_id, invoice_date, total_ht, total_vat, total_ttc) values ($1,'ATTR-1',$2,($3::timestamptz + interval '10 days')::date, 999999, 0, 999999) returning id`,
        [I.orgA, offer.customer_id, offer.sent_at])).rows[0]!;
      await db.query(`insert into invoice_lines (organization_id, invoice_id, line_no, product_id, description, quantity, unit_price_ht, line_total_ht) values ($1,$2,1,$3,'x',10000,$4,999999)`, [I.orgA, inv.id, line.product_id, line.unit_price_ht]);
    });
    const perf = await withUser(I.alice, (db) => getLeaPerformance(db, I.orgA, 90));
    const permanents = perf.find((p) => p.mission === "permanents")!;
    expect(permanents.offersSent).toBeGreaterThan(0);
    expect(permanents.won).toBeGreaterThanOrEqual(1);
    expect(Number(permanents.ordersHt)).toBeGreaterThanOrEqual(Number(offer.total_ht) - 0.01);
    // plafonné au montant de l'offre (jamais 999 999)
    expect(Number(permanents.invoicedHt)).toBeLessThan(999999);
    expect(Number(permanents.invoicedHt)).toBeGreaterThanOrEqual(Number(offer.total_ht) - 0.01);
  });
});

describe("Accueil (direction artistique) : données réelles uniquement", () => {
  it("indicateurs, priorités, évolution et répartition calculés depuis la base", async () => {
    const { getHomeData } = await import("@/features/dashboard/home");
    const { listOpportunities } = await import("@/features/dashboard/queries");
    const h = await withUser(I.alice, (db) => getHomeData(db, I.orgA, TODAY));
    expect(h.evolution).toHaveLength(6);
    expect(h.clients.active).toBeGreaterThan(0);
    expect(h.priorities.length).toBeGreaterThan(0);
    expect(h.priorities.length).toBeLessThanOrEqual(5);
    for (const p of h.priorities) expect(p.action).not.toBe("Agir");
    const pct = h.repartition.reduce((a, r) => a + r.pct, 0);
    expect(pct).toBeGreaterThan(99.5);
    expect(pct).toBeLessThan(100.5);
    // Filtre par mission : ne renvoie que la mission demandée
    const react = await withUser(I.alice, (db) => listOpportunities(db, I.orgA, { mission: "reactivation" }));
    expect(react.length).toBeGreaterThan(0);
    expect(react.every((o) => o.mission === "reactivation")).toBe(true);
    // Isolation : une autre organisation ne voit rien des données de JONAS
    const other = await withUser(I.chloe, (db) => getHomeData(db, I.orgA, TODAY));
    expect(other.priorities).toHaveLength(0);
    expect(other.caMonth).toBe("0.00");
  });
});
