/**
 * Formation commerciale V2 : LÉA traite les objections par la donnée (base réelle, RLS, IA simulée, envois simulés).
 * JONAS est autonome. Horloge injectée : vendredi 6 nov. 2026, 11:00 à Paris.
 */
import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { withAgent, withUser } from "@/lib/database/client";
import { runAutopilot } from "@/features/agent/autopilot";
import { simulateCustomerReply } from "@/features/conversations/service";
import { getFile } from "@/lib/storage";
import { resetTestDb, ids, privileged } from "./db";

const T0 = new Date("2026-11-06T10:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
let I: Awaited<ReturnType<typeof ids>>;
let convs: { id: string; offer_id: string; customer_id: string }[] = [];

beforeAll(async () => {
  await resetTestDb();
  I = await ids();
  const r = await withAgent(I.orgA, (db) => runAutopilot(db, I.orgA, T0));
  expect(r.errors).toEqual([]);
  // Offres email envoyées, à plusieurs lignes (pour pouvoir arbitrer entre références)
  convs = await q<{ id: string; offer_id: string; customer_id: string }>(
    `select c.id, c.offer_id, c.customer_id from conversations c join offers o on o.id = c.offer_id
     where c.organization_id = $1 and c.channel = 'email' and o.status = 'sent' and (select count(*) from offer_lines l where l.offer_id = o.id) >= 2
     order by o.total_ht desc`, [I.orgA]);
  expect(convs.length).toBeGreaterThanOrEqual(6);
});

const q = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => withUser(I.alice, async (db) => (await db.query<T>(sql, p)).rows);
const reply = (conv: string, body: string, minutes: number) => withUser(I.bruno, (db) => simulateCustomerReply(db, I.orgA, I.bruno, conv, body, { now: at(minutes) }));
const lastOutbound = async (conv: string) =>
  (await q<{ body: string; status: string; sent_autonomously: boolean; attachments: { filename: string }[]; ai_analysis: { playbook?: { strategy: string } | null } }>(
    `select body, status, sent_autonomously, attachments, ai_analysis from messages where conversation_id = $1 and direction = 'outbound' order by created_at desc limit 1`, [conv]))[0]!;

describe("Objection « trop cher » : analyse, offre révisée, documents, défense", () => {
  it("LÉA ne renonce pas : offre révisée moins chère, ancienne offre remplacée, Excel d'analyse joint", async () => {
    const c = convs[0]!;
    const before = (await q<{ total_ht: string; number: string }>(`select total_ht, number from offers where id = $1`, [c.offer_id]))[0]!;
    await reply(c.id, "Bonjour, c'est trop cher pour nous en ce moment.", 30);
    const conv = (await q<{ offer_id: string }>(`select offer_id from conversations where id = $1`, [c.id]))[0]!;
    const revised = (await q<{ id: string; number: string; total_ht: string; status: string; supersedes_offer_id: string; source: string }>(
      `select id, number, total_ht, status, supersedes_offer_id, source from offers where id = $1`, [conv.offer_id]))[0]!;
    const old = (await q<{ status: string }>(`select status from offers where id = $1`, [c.offer_id]))[0]!;
    const m = await lastOutbound(c.id);
    if (m.ai_analysis.playbook?.strategy === "revise") {
      expect(revised.supersedes_offer_id).toBe(c.offer_id);
      expect(old.status).toBe("superseded");
      expect(Number(revised.total_ht)).toBeLessThan(Number(before.total_ht));
      expect(revised.source).toBe("lea");
      expect(revised.status).toBe("sent");
      expect(m.body).toContain(`Nouvelle proposition ${revised.number}`);
      expect(m.attachments.map((a) => a.filename)).toEqual(expect.arrayContaining([expect.stringMatching(/^Analyse-OF-/), expect.stringMatching(/^Offre-OF-.*\.pdf$/)]));
      // Excel d'analyse : colonnes demandées, valeurs inconnues ≠ 0, estimations étiquetées
      const asset = (await q<{ storage_path: string }>(`select storage_path from generated_assets where offer_id = $1 and kind = 'coverage_excel'`, [revised.id]))[0]!;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await getFile(asset.storage_path) as unknown as ArrayBuffer);
      const ws = wb.getWorksheet("Analyse")!;
      expect(ws.getRow(4).values).toEqual(expect.arrayContaining(["Client", "Référence", "Désignation", "Photo", "Dernier achat", "Ventes/jour", "Stock restant connu", "Jours de couverture", "Niveau de confiance", "Quantité recommandée", "Prix HT (€)", "Motif de recommandation", "Nouveautés complémentaires"]));
      const stockCells = [5, 6, 7].map((r) => String(ws.getRow(r).getCell(8).value ?? ""));
      expect(stockCells.every((v) => v === "" || /^Inconnu/.test(v) || /^\d+$/.test(v))).toBe(true);
      expect(wb.getWorksheet("Méthode")!.getCell("A3").value).toMatch(/^H1/);
    } else {
      // Offre déjà ajustée au besoin estimé : LÉA défend la proposition avec les chiffres, sans la brader.
      expect(m.ai_analysis.playbook?.strategy).toBe("hold");
      expect(m.body).toMatch(/unité\(s\)\/jour/);
    }
    expect(m.sent_autonomously).toBe(true);
    expect(m.body).not.toMatch(/\d+\s?%/); // aucune remise proposée en réponse au prix
  });

  it("« trop de stock, il m'en reste 40 » : stock enregistré comme DÉCLARÉ, la réponse le cite et recalcule", async () => {
    const c = convs[1]!;
    const line = (await q<{ description: string }>(`select description from offer_lines where offer_id = $1 order by line_total_ht desc limit 1`, [c.offer_id]))[0]!;
    await reply(c.id, `On a trop de stock en ${line.description}, il m'en reste 40.`, 40);
    const rep = await q<{ qty_on_hand: string; source: string }>(`select qty_on_hand, source from customer_stock_reports where customer_id = $1`, [c.customer_id]);
    expect(rep).toHaveLength(1);
    expect(rep[0]).toMatchObject({ qty_on_hand: "40.000", source: "customer_message" });
    const m = await lastOutbound(c.id);
    expect(m.body).toContain(`Stock déclaré : 40 pièce(s) de « ${line.description}`);
    expect(m.body).not.toMatch(/je vérifie auprès de votre commercial/); // « stock » = celui du client, pas une question
    expect(["revise", "hold"]).toContain(m.ai_analysis.playbook?.strategy);
    if (m.ai_analysis.playbook?.strategy === "hold") {
      expect(m.body).toMatch(/je reviens vers vous le/);
      expect(await q(`select 1 from followup_tasks where customer_id = $1 and kind = 'plan' and title like 'Refaire le point stock%'`, [c.customer_id])).toHaveLength(1);
    }
  });

  it("stock déclaré sans référence : LÉA demande laquelle avant de recalculer", async () => {
    const c = convs[5] ?? convs[1]!;
    await reply(c.id, "Il m'en reste 40, j'ai trop de stock.", 45);
    const m = await lastOutbound(c.id);
    expect(m.body).toContain("(référence à préciser)");
    expect(m.body).toMatch(/de quelle\(s\) référence\(s\) vous reste-t-il 40 pièces/);
    expect(m.ai_analysis.playbook?.strategy).toBe("hold");
  });

  it("« non merci » : refus explicite respecté, aucune offre révisée", async () => {
    const c = convs[2]!;
    const offersBefore = (await q<{ n: number }>(`select count(*)::int n from offers where customer_id = $1`, [c.customer_id]))[0]!.n;
    await reply(c.id, "Non merci, nous ne souhaitons pas donner suite.", 50);
    expect((await q<{ n: number }>(`select count(*)::int n from offers where customer_id = $1`, [c.customer_id]))[0]!.n).toBe(offersBefore);
    const m = await lastOutbound(c.id);
    expect(m.body).not.toMatch(/Nouvelle proposition/);
    expect(m.ai_analysis.playbook ?? null).toBeNull();
  });

  it("après 2 révisions, LÉA n'insiste plus : le commercial reprend la main", async () => {
    const c = convs[3]!;
    for (const [k, txt] of ["C'est trop cher.", "Toujours trop cher.", "Encore trop cher."].entries()) await reply(c.id, txt, 60 + k * 10);
    const chain = await q<{ n: number }>(`select count(*)::int n from offers where customer_id = $1 and supersedes_offer_id is not null`, [c.customer_id]);
    expect(chain[0]!.n).toBeLessThanOrEqual(2);
    const m = await lastOutbound(c.id);
    if (chain[0]!.n === 2) {
      expect(m.ai_analysis.playbook?.strategy).toBe("respect");
      expect(m.status).toBe("pending_approval"); // transfert : un humain reprend
      expect(await q(`select 1 from followup_tasks where conversation_id = $1 and kind = 'escalation'`, [c.id])).not.toHaveLength(0);
    }
  });

  it("organisation supervisée : l'offre révisée attend une validation humaine, rien ne part seul", async () => {
    await privileged((c) => c.query(`update organization_settings set autonomy_level = 'supervised' where organization_id = $1`, [I.orgA]));
    const c = convs[4] ?? convs[0]!;
    await reply(c.id, "Trop cher pour nous.", 120);
    const m = await lastOutbound(c.id);
    expect(m.sent_autonomously).toBe(false);
    expect(m.status).toBe("pending_approval");
    await privileged((c2) => c2.query(`update organization_settings set autonomy_level = 'autonomous' where organization_id = $1`, [I.orgA]));
  });
});
