/**
 * Scénario principal (niveau services, base PostgreSQL réelle, RLS active, IA simulée) :
 * réassort détecté → offre → PDF + Excel → email → validation → envoi simulé → réponse → objection
 * → réponse approuvée → demande de commande → indicateurs.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { withUser } from "@/lib/database/client";
import { createOfferFromOpportunity, decideOffer, acceptOfferAndPrepareOrder } from "@/features/offers/service";
import { generateOfferAssets, decideAsset } from "@/features/creative-studio/service";
import { draftOfferEmail } from "@/features/agent/lea";
import { decideMessage, simulateCustomerReply } from "@/features/conversations/service";
import { getDashboard } from "@/features/dashboard/queries";
import { resetTestDb, ids, TODAY } from "./db";
import ExcelJS from "exceljs";
import { getFile } from "@/lib/storage";

let I: Awaited<ReturnType<typeof ids>>;

beforeAll(async () => {
  await resetTestDb();
  I = await ids();
});

describe("Scénario commercial complet", () => {
  it("de l'opportunité de réassort à la demande de commande", async () => {
    // 1-3. Tableau de bord : LÉA a identifié le réassort du client vedette
    const before = await withUser(I.bruno, (db) => getDashboard(db, I.orgA, TODAY));
    const opp = before.opportunities.find((o) => o.customerName === "Maison Martin & Fils" && o.type === "reorder");
    expect(opp, "opportunité de réassort détectée").toBeTruthy();
    expect(opp!.title).toBe("Réassort probable de 4 références");
    expect(Number(opp!.estimatedValueHt)).toBeGreaterThan(0);

    // 4-6. Offre préparée à partir de l'historique (prix résolus, colisage respecté)
    const offer = await withUser(I.bruno, (db) => createOfferFromOpportunity(db, I.orgA, { userId: I.bruno }, opp!.id, TODAY));
    expect(offer.draft!.lines).toHaveLength(4);
    for (const l of offer.draft!.lines) expect(l.priceSource).not.toBeNull();

    // 7-8. Supports : PDF + Excel illustré, contrôlés automatiquement
    const assets = await withUser(I.bruno, (db) => generateOfferAssets(db, I.orgA, I.bruno, offer.offerId, ["offer_pdf", "offer_excel"]));
    expect(assets).toHaveLength(2);
    for (const a of assets) expect(a.validation?.ok).toBe(true);
    const pdfPath = await withUser(I.bruno, async (db) => (await db.query<{ storage_path: string }>(`select storage_path from generated_assets where id = $1`, [assets[0]!.id])).rows[0]!.storage_path);
    expect((await getFile(pdfPath)).subarray(0, 5).toString()).toBe("%PDF-");
    const xlsxPath = await withUser(I.bruno, async (db) => (await db.query<{ storage_path: string }>(`select storage_path from generated_assets where id = $1`, [assets[1]!.id])).rows[0]!.storage_path);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await getFile(xlsxPath)) as unknown as ArrayBuffer);
    expect(wb.worksheets[0]!.getCell("B8").value).toBe(offer.draft!.lines[0]!.reference);
    for (const a of assets) await withUser(I.bruno, (db) => decideAsset(db, I.orgA, I.bruno, a.id, "approved"));

    // 9. Email rédigé par LÉA (personnalisé car historique suffisant, vouvoiement)
    await withUser(I.bruno, (db) => decideOffer(db, I.orgA, I.bruno, offer.offerId, "approved"));
    const draft = await withUser(I.bruno, (db) => draftOfferEmail(db, I.orgA, offer.offerId, { userId: I.bruno }));
    const msg = await withUser(I.bruno, async (db) => (await db.query<{ body: string; status: string; ai_analysis: { personalizationBasis: string } }>(`select body, status, ai_analysis from messages where id = $1`, [draft.messageId])).rows[0]!);
    expect(msg.status).toBe("pending_approval");
    expect(msg.body).toContain("Bonjour Monsieur Martin");
    expect(msg.body).toContain("Au regard de vos derniers achats");
    expect(msg.ai_analysis.personalizationBasis).toBe("purchase_history");

    // 10-11. Validation humaine → envoi simulé (pièces jointes validées)
    const sent = await withUser(I.bruno, (db) => decideMessage(db, I.orgA, I.bruno, draft.messageId, { decision: "approved" }));
    expect(sent).toEqual({ sent: true, simulated: true });
    const offerStatus = await withUser(I.bruno, async (db) => (await db.query<{ status: string }>(`select status from offers where id = $1`, [offer.offerId])).rows[0]!.status);
    expect(offerStatus).toBe("sent");

    // 12-14. Réponse fictive avec objection prix + demande de remise hors plafond
    const reply = await withUser(I.bruno, (db) => simulateCustomerReply(db, I.orgA, I.bruno, draft.conversationId, "Bonjour, votre offre est trop chère, pouvez-vous nous faire une remise de 5 % ? Sinon nous verrons ailleurs."));
    expect(reply.analysis.intent).toBe("objection");
    expect(reply.analysis.requestedDiscountPct).toBe(5);
    expect(reply.escalated).toBe(true);
    const answer = await withUser(I.bruno, async (db) => (await db.query<{ body: string; status: string }>(`select body, status from messages where id = $1`, [reply.replyMessageId])).rows[0]!);
    expect(answer.status).toBe("pending_approval");
    expect(answer.body).not.toMatch(/5\s?%/); // jamais au-delà du plafond JONAS (1 %)
    const escalation = await withUser(I.bruno, async (db) => (await db.query(`select 1 from followup_tasks where kind = 'escalation' and organization_id = $1`, [I.orgA])).rowCount);
    expect(escalation).toBe(1);

    // 15. Approbation de la réponse
    await withUser(I.bruno, (db) => decideMessage(db, I.orgA, I.bruno, reply.replyMessageId!, { decision: "approved" }));

    // 16. Le client accepte → demande de commande
    const accept = await withUser(I.bruno, (db) => simulateCustomerReply(db, I.orgA, I.bruno, draft.conversationId, "C'est validé pour nous, vous pouvez lancer la commande."));
    expect(accept.analysis.intent).toBe("accept");
    const order = await withUser(I.bruno, (db) => acceptOfferAndPrepareOrder(db, I.orgA, I.bruno, offer.offerId));
    expect(order.number).toMatch(/^CMD-\d{4}-\d{5}$/);

    // 17. Le tableau de bord reflète le résultat
    const after = await withUser(I.bruno, (db) => getDashboard(db, I.orgA, TODAY));
    expect(Number(after.results.wonAmountHt)).toBeCloseTo(Number(offer.draft!.totalHt), 2);
    expect(after.results.orderRequests).toBe(1);
    expect(after.opportunities.find((o) => o.id === opp!.id)).toBeUndefined();
  });
});
