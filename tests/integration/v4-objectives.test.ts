/**
 * V4 — objectifs (client, portefeuille, entreprise), compte rendu quotidien, retards d'objectif, dormants, nouveautés personnalisées.
 * Base de démonstration, RLS, IA simulée, horloge fixe.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { withAgent, withUser } from "@/lib/database/client";
import { runAutopilot } from "@/features/agent/autopilot";
import { loadCustomerObjectives, loadOrgObjectives, splitCustomerTarget, saveCustomerMonths, saveSalesTarget } from "@/features/targets/repo";
import { selectForCustomer } from "@/features/selection/pipeline";
import { resetTestDb, ids, privileged, TODAY } from "./db";

let I: Awaited<ReturnType<typeof ids>>;
let hero: string;
const NOW = new Date("2026-11-06T10:00:00Z");
beforeAll(async () => {
  await resetTestDb();
  I = await ids();
  hero = await privileged(async (c) => (await c.query<{ id: string }>(`select id from customers where organization_id = $1 and external_code = 'C00001'`, [I.orgA])).rows[0]!.id);
});
const q = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => withUser(I.alice, async (db) => (await db.query<T>(sql, p)).rows);

describe("Objectifs client : répartition mensuelle et suivi", () => {
  it("répartition selon la saisonnalité N-1 : 12 mois enregistrés, somme = objectif annuel, mois saisis conservés", async () => {
    await withUser(I.bruno, (db) => saveCustomerMonths(db, I.orgA, I.bruno, hero, 2026, [null, null, "5000", null, null, null, null, null, null, null, null, null]));
    const r = await withUser(I.bruno, (db) => splitCustomerTarget(db, I.orgA, I.bruno, hero, 2026));
    expect(["seasonality", "prorata"]).toContain(r.source);
    const rows = await q<{ period_start: string; target_ht: string; source: string }>(`select period_start::text, target_ht::text, source from customer_targets where customer_id = $1 and period_type = 'month' order by period_start`, [hero]);
    expect(rows.find((x) => x.period_start === "2026-03-01")).toMatchObject({ target_ht: "5000.00", source: "manual" });
    const annual = (await q<{ t: string }>(`select target_ht::text t from customer_targets where customer_id = $1 and period_type = 'year'`, [hero]))[0]!.t;
    expect(r.months.reduce((a, m) => a + Number(m), 0).toFixed(2)).toBe(Number(annual).toFixed(2));
    const t = await withUser(I.bruno, (db) => loadCustomerObjectives(db, I.orgA, hero, TODAY));
    expect(t.rows).toHaveLength(12);
    expect(t.rows[2]).toMatchObject({ targetHt: "5000.00", targetSource: "manual" });
    expect(t.rows[11]!.realizedHt).toBeNull();
    expect(Number(t.summary.realizedYtdHt)).toBeGreaterThan(0);
  });
  it("objectifs entreprise / portefeuille : saisis par la direction, jamais par l'agent ni un rôle lecture", async () => {
    await withUser(I.alice, (db) => saveSalesTarget(db, I.orgA, I.alice, { scope: "company", ownerUserId: null, year: 2026, targetHt: "2500000" }));
    await expect(withAgent(I.orgA, (db) => db.query(`insert into sales_targets (organization_id, scope, period_type, period_start, target_ht) values ($1,'company','year','2027-01-01',1)`, [I.orgA]))).rejects.toThrow(/row-level security/);
    await expect(withUser(I.diane, (db) => saveSalesTarget(db, I.orgA, I.diane, { scope: "company", ownerUserId: null, year: 2026, targetHt: "1" }))).rejects.toThrow();
    const o = await withUser(I.alice, (db) => loadOrgObjectives(db, I.orgA, TODAY));
    expect(o.company.explicit).toBe(true);
    expect(o.company.summary.annualTargetHt).toBe("2500000.00");
    expect(o.company.summary.expectedToDateHt).not.toBeNull();
    expect(await withUser(I.chloe, async (db) => (await db.query(`select 1 from sales_targets where organization_id = $1`, [I.orgA])).rowCount)).toBe(0);
  });
});

describe("Tournée quotidienne : retards, dormants, compte rendu", () => {
  it("compte rendu historisé et idempotent (une ligne par jour, mise à jour si la tournée est relancée)", async () => {
    const r = await withAgent(I.orgA, (db) => runAutopilot(db, I.orgA, NOW));
    expect(r.errors).toEqual([]);
    await withAgent(I.orgA, (db) => runAutopilot(db, I.orgA, NOW));
    const briefs = await q<{ payload: { objectives: { annualTargetHt: string | null }; behind: { total: number }; reorders: { total: number }; decisions: { total: number }; source: string } }>(
      `select payload from daily_briefs where organization_id = $1 and brief_date = $2`, [I.orgA, TODAY]);
    expect(briefs).toHaveLength(1);
    expect(briefs[0]!.payload.source).toBe("autopilot");
    expect(briefs[0]!.payload.objectives.annualTargetHt).toBe("2500000.00");
    expect(briefs[0]!.payload.reorders.total).toBeGreaterThan(0);
  });
  it("client en retard : causes analysées (faits confirmés), plan remis au commercial, rendez-vous si besoin", async () => {
    const gaps = await q<{ id: string; customer_id: string; details: { causes?: { text: string; certainty: string }[]; meetingNeeded?: boolean } }>(
      `select id, customer_id, details from opportunities where organization_id = $1 and type = 'target_gap'`, [I.orgA]);
    expect(gaps.length).toBeGreaterThan(0);
    const g = gaps.find((x) => x.details.causes)!;
    expect(g.details.causes!.every((c) => ["confirmé", "estimation"].includes(c.certainty))).toBe(true);
    const plan = await q<{ notes: string }>(`select notes from followup_tasks where idempotency_key = $1`, [`plan:${g.id}`]);
    expect(plan[0]!.notes).toMatch(/Causes possibles/);
    if (g.details.meetingNeeded) expect(await q(`select 1 from followup_tasks where idempotency_key = $1`, [`gap-meeting:${g.id}`])).toHaveLength(1);
  });
  it("client dormant : dossier complet (offre du moteur de sélection + catalogue) et calendrier de suivi", async () => {
    const dormant = await q<{ id: string; customer_id: string; offer_id: string | null }>(`select id, customer_id, offer_id from opportunities where organization_id = $1 and type = 'dormant_customer' and offer_id is not null`, [I.orgA]);
    expect(dormant.length).toBeGreaterThan(0);
    const d = dormant[0]!;
    const kinds = (await q<{ kind: string }>(`select distinct kind from generated_assets where offer_id = $1`, [d.offer_id])).map((k) => k.kind);
    expect(kinds).toEqual(expect.arrayContaining(["offer_pdf", "offer_excel", "catalog"]));
    expect(await q(`select 1 from followup_tasks where idempotency_key like $1`, [`reactivation:${d.id}:%`])).toHaveLength(2);
  });
});

describe("Nouveautés personnalisées", () => {
  it("nombre proportionné à la taille du client et classement propre à chaque client", async () => {
    const custs = await privileged(async (c) => (await c.query<{ id: string }>(`select id from customers where organization_id = $1 order by external_code limit 12`, [I.orgA])).rows.map((r) => r.id));
    const lists: string[][] = [];
    for (const c of custs) {
      const s = await withAgent(I.orgA, (db) => selectForCustomer(db, I.orgA, c, TODAY, { include: { reorder: false, permanent: false, back_in_stock: false, complementary: false } }));
      const bought = (await privileged(async (db) => (await db.query<{ n: number }>(`select count(distinct l.product_id)::int n from invoice_lines l join invoices i on i.id = l.invoice_id where i.customer_id = $1 and i.invoice_date > '2023-11-06'`, [c])).rows[0]!.n));
      const cap = bought < 20 ? 5 : bought < 100 ? 20 : bought < 300 ? 50 : 100;
      expect(s.lines.filter((l) => l.type === "new_product").length).toBeLessThanOrEqual(cap);
      lists.push(s.lines.map((l) => l.productId));
    }
    const nonEmpty = lists.filter((l) => l.length);
    expect(nonEmpty.length).toBeGreaterThan(1);
    expect(new Set(nonEmpty.map((l) => l.join(","))).size).toBeGreaterThan(1); // pas la même sélection pour tous
  });
});
