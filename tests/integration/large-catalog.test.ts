/**
 * Grands catalogues V3 (base de démonstration, RLS) : moteur de sélection, offre complète sans doublon,
 * éditeur d'offre (prix vérifiés serveur, colisage, révision, historique), générations asynchrones avec reprise.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { withAgent, withUser } from "@/lib/database/client";
import { selectForCustomer } from "@/features/selection/pipeline";
import { createOfferFromSelection } from "@/features/selection/offer";
import { applyLineChanges, loadEditorLines, StaleRevisionError } from "@/features/offers/editor";
import { enqueueAssetsJob, runAssetsJob, jobStatus } from "@/features/creative-studio/jobs";
import { resetTestDb, ids, privileged, TODAY } from "./db";

let I: Awaited<ReturnType<typeof ids>>;
let hero: string;
let offerId: string;

beforeAll(async () => {
  await resetTestDb();
  I = await ids();
  hero = await privileged(async (c) => (await c.query<{ id: string }>(`select id from customers where organization_id = $1 and external_code = 'C00001'`, [I.orgA])).rows[0]!.id);
});
const q = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => withUser(I.alice, async (db) => (await db.query<T>(sql, p)).rows);

describe("Moteur de sélection", () => {
  it("sélection complète, une ligne par produit, motifs d'exclusion, répartition par catégorie", async () => {
    const s = await withAgent(I.orgA, (db) => selectForCustomer(db, I.orgA, hero, TODAY, { maxLines: 500 }));
    expect(s.lines.length).toBeGreaterThan(0);
    expect(new Set(s.lines.map((l) => l.productId)).size).toBe(s.lines.length);
    for (const l of s.lines) {
      expect(Number(l.unitPriceHt)).toBeGreaterThan(0); // prix vérifié, jamais inventé
      expect(l.justification.length).toBeGreaterThan(10);
      expect(["reorder", "permanent", "back_in_stock", "complementary", "new_product"]).toContain(l.type);
    }
    expect(s.byCategory.reduce((a, c) => a + c.lines, 0)).toBe(s.lines.length);
    expect(s.excluded.every((e) => e.reason.length > 5)).toBe(true);
  });
  it("respecte le budget et le nombre de lignes demandés", async () => {
    const all = await withAgent(I.orgA, (db) => selectForCustomer(db, I.orgA, hero, TODAY));
    const half = (Number(all.totalHt) / 2).toFixed(2);
    const b = await withAgent(I.orgA, (db) => selectForCustomer(db, I.orgA, hero, TODAY, { budgetHt: half }));
    expect(Number(b.totalHt)).toBeLessThanOrEqual(Number(half));
    expect(b.truncated.byBudget).toBeGreaterThan(0);
    const two = await withAgent(I.orgA, (db) => selectForCustomer(db, I.orgA, hero, TODAY, { maxLines: 2 }));
    expect(two.lines).toHaveLength(Math.min(2, all.lines.length));
  });
  it("offre complète : lignes enrichies (type, historique, confiance), sans doublon", async () => {
    const o = await withAgent(I.orgA, (db) => createOfferFromSelection(db, I.orgA, null, hero, TODAY, { maxLines: 300 }));
    offerId = o.offerId;
    const lines = await withUser(I.bruno, (db) => loadEditorLines(db, offerId));
    expect(lines.length).toBe(o.selection.lines.length);
    expect(lines.every((l) => l.recommendationType && l.confidence)).toBe(true);
    expect(lines.some((l) => l.purchaseCount && l.lastOrderDate)).toBe(true);
    await expect(privileged((c) => c.query(`insert into offer_lines (organization_id, offer_id, line_no, product_id, description, quantity, unit_price_ht, price_source, vat_rate, line_total_ht) select organization_id, offer_id, 999, product_id, description, 1, 1, 'catalog', 20, 1 from offer_lines where offer_id = $1 limit 1`, [offerId]))).rejects.toThrow(/duplicate|unique/i);
  });
});

describe("Éditeur d'offre volumineuse", () => {
  it("modification en masse : colisage appliqué, prix re-vérifié, totaux recalculés, historique", async () => {
    const lines = await withUser(I.bruno, (db) => loadEditorLines(db, offerId));
    const rev = (await q<{ revision: number }>(`select revision from offers where id = $1`, [offerId]))[0]!.revision;
    const target = lines.find((l) => (l.unitsPerCase ?? 1) > 1) ?? lines[0]!;
    const r = await withUser(I.bruno, (db) => applyLineChanges(db, I.orgA, I.bruno, offerId, rev, [
      { op: "update", productId: target.productId, quantity: "1" },
      { op: "remove", productId: lines.at(-1)!.productId },
    ]));
    expect(r.revision).toBe(rev + 1);
    const after = await withUser(I.bruno, (db) => loadEditorLines(db, offerId));
    const t = after.find((l) => l.productId === target.productId)!;
    expect(Number(t.quantity)).toBe(target.unitsPerCase ?? 1); // arrondi au colis
    expect(t.unitPriceHt).toBe(target.unitPriceHt); // le prix vient du serveur, pas du client
    expect(after).toHaveLength(lines.length - 1);
    const total = (await q<{ total_ht: string }>(`select total_ht from offers where id = $1`, [offerId]))[0]!.total_ht;
    expect(Number(total)).toBeCloseTo(after.reduce((a, l) => a + Number(l.lineTotalHt), 0), 2);
    const hist = await q<{ action: string }>(`select action from offer_line_changes where offer_id = $1`, [offerId]);
    expect(hist.map((h) => h.action).sort()).toEqual(["remove", "update"]);
  });
  it("doublon refusé, produit sans prix refusé, révision périmée refusée", async () => {
    const lines = await withUser(I.bruno, (db) => loadEditorLines(db, offerId));
    const rev = (await q<{ revision: number }>(`select revision from offers where id = $1`, [offerId]))[0]!.revision;
    const noPrice = (await privileged(async (c) => (await c.query<{ id: string }>(
      `insert into products (organization_id, reference, name, status, availability) values ($1, 'SANS-PRIX', 'Produit sans prix', 'active', 'in_stock') returning id`, [I.orgA])).rows[0]!.id));
    const r = await withUser(I.bruno, (db) => applyLineChanges(db, I.orgA, I.bruno, offerId, rev, [{ op: "add", productId: lines[0]!.productId }, { op: "add", productId: noPrice }]));
    expect(r.rejected.map((x) => x.reason)).toEqual(expect.arrayContaining([expect.stringMatching(/doublon/), expect.stringMatching(/Prix inconnu/)]));
    await expect(withUser(I.bruno, (db) => applyLineChanges(db, I.orgA, I.bruno, offerId, rev, [{ op: "update", productId: lines[0]!.productId, quantity: "12" }]))).rejects.toBeInstanceOf(StaleRevisionError);
  });
  it("lecture seule : un rôle lecture ne peut pas modifier", async () => {
    const rev = (await q<{ revision: number }>(`select revision from offers where id = $1`, [offerId]))[0]!.revision;
    const l = (await withUser(I.bruno, (db) => loadEditorLines(db, offerId)))[0]!;
    await expect(withUser(I.diane, (db) => applyLineChanges(db, I.orgA, I.diane, offerId, rev, [{ op: "update", productId: l.productId, quantity: "24" }]))).rejects.toThrow();
  });
});

describe("Générations asynchrones", () => {
  it("progression étape par étape, puis reprise après échec sans refaire les étapes réussies", async () => {
    const jobId = await withUser(I.bruno, (db) => enqueueAssetsJob(db, I.orgA, I.bruno, offerId, ["offer_excel", "synthesis_pdf", "priority_pdf", "email_txt"]));
    const r = await runAssetsJob(jobId, (fn) => withUser(I.bruno, fn));
    expect(r.status).toBe("succeeded");
    const s = (await withUser(I.bruno, (db) => jobStatus(db, I.orgA, jobId)))!;
    expect(s).toMatchObject({ status: "succeeded", progress: 4, total: 4 });
    expect(s.assets.map((a) => a.kind).sort()).toEqual(["email_txt", "offer_excel", "priority_pdf", "synthesis_pdf"]);
    // Reprise : une tâche en échec après la 1re étape ne refait que la suite
    const j2 = await withUser(I.bruno, (db) => enqueueAssetsJob(db, I.orgA, I.bruno, offerId, ["offer_pdf", "synthesis_pdf"]));
    await privileged((c) => c.query(`update creative_jobs set status = 'failed', attempts = 1, progress = 1, result = '{"done":["offer_pdf"]}' where id = $1`, [j2]));
    expect((await runAssetsJob(j2, (fn) => withUser(I.bruno, fn))).status).toBe("succeeded");
    const s2 = (await withUser(I.bruno, (db) => jobStatus(db, I.orgA, j2)))!;
    expect(s2.assets.map((a) => a.kind)).toEqual(["synthesis_pdf"]);
    expect(s2.progress).toBe(2);
    // Une tâche d'une autre organisation est invisible
    expect(await withUser(I.chloe, (db) => jobStatus(db, I.orgB, jobId))).toBeNull();
  });
});
