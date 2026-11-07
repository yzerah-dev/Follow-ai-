import { describe, expect, it } from "vitest";
import { computeCoverage, type CoverageInput } from "@/features/analytics/coverage";
import { runPlaybook, coverageArgument, MAX_REVISIONS, type PlaybookLine } from "@/features/agent/playbook";
import { mockAnalyzeReply, mockObjectionReply } from "@/features/agent/mock-brain";
import { checkMessage } from "@/features/agent/guards";

const TODAY = "2026-11-06";
const cov = (over: Partial<CoverageInput>) =>
  computeCoverage({ productId: "p", reference: "R", name: "Produit", unitsPerCase: 6, minOrderQty: null, purchases: [], report: null, today: TODAY, ...over });

// Commandes régulières de 60 unités tous les 30 jours → 2 unités/jour estimées
const regular = [
  { date: "2026-07-09", qty: "60" }, { date: "2026-08-08", qty: "60" }, { date: "2026-09-07", qty: "60" }, { date: "2026-10-07", qty: "60" },
];

describe("Couverture de stock", () => {
  it("estimation à partir des achats : ventes/jour, stock estimé, couverture, quantité recommandée au colisage", () => {
    const r = cov({ purchases: regular });
    expect(r.rateSource).toBe("estimated");
    expect(r.dailyRate).toBe("2.00"); // 180 unités sur 90 jours (hors dernière commande)
    expect(r.stockSource).toBe("estimated");
    expect(r.stockOnHand).toBe("0"); // 60 − 2 × 30 jours
    expect(r.coverageDays).toBe(0);
    expect(r.risk).toBe("high");
    expect(r.targetDays).toBe(30);
    expect(r.recommendedQty).toBe("60");
    expect(r.confidence).toBe("high");
    expect(r.hypotheses).toHaveLength(2);
  });
  it("inconnu ≠ zéro : une seule commande → ventes, stock et couverture inconnus", () => {
    const r = cov({ purchases: [{ date: "2026-10-01", qty: "24" }] });
    expect(r.dailyRate).toBeNull();
    expect(r.stockOnHand).toBeNull();
    expect(r.coverageDays).toBeNull();
    expect(r.recommendedQty).toBeNull();
    expect(r.risk).toBe("unknown");
    expect(r.confidence).toBe("low");
  });
  it("stock déclaré par le client : remplace l'hypothèse, marqué « déclaré », jamais « vérifié » sans sorties caisse", () => {
    const r = cov({ purchases: regular, report: { qtyOnHand: "40", unitsSoldPerDay: null, reportedAt: "2026-11-06T09:00:00Z", source: "customer_message" } });
    expect(r.stockSource).toBe("declared");
    expect(r.stockOnHand).toBe("40");
    expect(r.coverageDays).toBe(20);
    expect(r.risk).toBe("medium");
    expect(r.confidence).toBe("declared");
    expect(r.recommendedQty).toBe("24"); // 2 × 30 − 40 = 20 → colis de 6
    const v = cov({ purchases: regular, report: { qtyOnHand: "40", unitsSoldPerDay: "1", reportedAt: "2026-11-06T09:00:00Z", source: "sell_out_import" } });
    expect(v.confidence).toBe("verified");
    expect(v.coverageDays).toBe(40);
  });
  it("rotation lente : client qui ne recommande plus", () => {
    const r = cov({ purchases: [{ date: "2026-03-01", qty: "30" }, { date: "2026-04-01", qty: "30" }, { date: "2026-05-01", qty: "30" }] });
    expect(r.slowMover).toBe(true);
    expect(r.reason).toMatch(/ralentit/);
  });
  it("argument chiffré toujours accompagné de son niveau de certitude", () => {
    expect(coverageArgument(cov({ purchases: regular }))).toMatch(/estimation d'après vos achats/);
  });
});

const lines: PlaybookLine[] = [
  { productId: "a", name: "Poêle 28", quantity: "60", unitPriceHt: "10" },
  { productId: "b", name: "Torchons", quantity: "60", unitPriceHt: "2" },
  { productId: "c", name: "Bougie", quantity: "30", unitPriceHt: "5" },
];
const coverage = new Map([
  ["a", { ...cov({ purchases: regular }), productId: "a", name: "Poêle 28" }], // rupture : 60 recommandées
  ["b", { ...cov({ purchases: regular, report: { qtyOnHand: "40", unitsSoldPerDay: null, reportedAt: "2026-11-06T09:00:00Z", source: "customer_message" } }), productId: "b", name: "Torchons" }], // 24 recommandées
  ["c", { ...cov({ purchases: [{ date: "2026-03-01", qty: "30" }, { date: "2026-04-01", qty: "30" }, { date: "2026-05-01", qty: "30" }] }), productId: "c", name: "Bougie" }], // rotation lente
]);
const base = { lines, coverage, budgetHt: null, priorRevisions: 0, alternatives: [], today: TODAY };

describe("Playbook des objections", () => {
  it("« trop cher » : garde le fort potentiel, retire la rotation lente, offre révisée moins chère et jamais au-delà du besoin", () => {
    const r = runPlaybook({ ...base, objection: "too_expensive" });
    expect(r.strategy).toBe("revise");
    expect(r.items.map((i) => i.productId)).toEqual(["a", "b"]);
    expect(r.items.find((i) => i.productId === "b")!.qty).toBe("24.000");
    expect(r.removed.map((x) => x.name)).toEqual(["Bougie"]);
    expect(Number(r.estimatedTotalHt)).toBeLessThan(Number(r.originalTotalHt));
    expect(r.counterArguments.join(" ")).toMatch(/estimation|déclaré/);
  });
  it("« pas de budget » avec un montant : la proposition tient dans le budget", () => {
    const r = runPlaybook({ ...base, objection: "budget", budgetHt: "620" });
    expect(Number(r.estimatedTotalHt)).toBeLessThanOrEqual(620);
    expect(r.items.map((i) => i.productId)).toEqual(["a"]); // priorité à la rupture imminente
  });
  it("« trop de stock » : seules les références à couvrir restent ; sinon reprise de contact datée, sans offre", () => {
    const r = runPlaybook({ ...base, objection: "stock_available" });
    expect(r.strategy).toBe("revise");
    expect(r.items.map((i) => i.productId)).toEqual(["a", "b"]);
    const covered = new Map([["a", { ...cov({ purchases: regular, report: { qtyOnHand: "200", unitsSoldPerDay: null, reportedAt: "2026-11-06T09:00:00Z", source: "customer_message" } }), productId: "a" }]]);
    const h = runPlaybook({ ...base, lines: [lines[0]!], coverage: covered, objection: "stock_available" });
    expect(h.strategy).toBe("hold");
    expect(h.followUpDate).toBe("2026-12-21"); // couverture de 100 jours : reprise de contact plafonnée à 45 jours
  });
  it("« pas besoin » : aucune offre envoyée d'office ; un point d'attention chiffré + rendez-vous court ; sans risque, décision respectée", () => {
    const r = runPlaybook({ ...base, objection: "no_need" });
    expect(r.strategy).toBe("hold"); // pas de pression : pas de nouvelle offre
    expect(r.counterArguments).toHaveLength(1);
    expect(r.counterArguments[0]).toMatch(/Poêle 28/); // la référence en rupture imminente
    expect(r.question).toMatch(/15 minutes/);
    const calm = new Map([["b", coverage.get("b")!]]);
    expect(runPlaybook({ ...base, lines: [lines[1]!], coverage: calm, objection: "no_need" }).strategy).toBe("respect");
  });
  it("« ça ne se vend pas » : la référence lente est retirée et remplacée par des références qui tournent", () => {
    const r = runPlaybook({ ...base, objection: "not_selling", alternatives: [{ productId: "n", name: "Nouveauté X", unitPriceHt: "4", minQty: "12", reason: "Nouveauté adaptée à votre assortiment." }] });
    expect(r.strategy).toBe("revise");
    expect(r.removed.map((x) => x.name)).toContain("Bougie");
    expect(r.items.map((i) => i.productId)).toContain("n");
  });
  it(`n'insiste pas après ${MAX_REVISIONS} révisions`, () => {
    expect(runPlaybook({ ...base, objection: "too_expensive", priorRevisions: MAX_REVISIONS }).strategy).toBe("respect");
  });
});

describe("Analyse des objections et rédaction", () => {
  it("reconnaît « ça ne se vend pas » et le stock déclaré", () => {
    expect(mockAnalyzeReply("Franchement ça ne se vend pas chez nous").objection).toBe("not_selling");
    const s = mockAnalyzeReply("J'ai trop de stock, il m'en reste 40");
    expect(s.objection).toBe("stock_available");
    expect(s.requestedQuantity).toMatch(/^40/);
    expect(mockAnalyzeReply("Non merci, nous ne souhaitons pas donner suite").objection).toBe("refusal");
  });
  it("réponse argumentée : stock déclaré, chiffres estimés étiquetés, offre révisée, question de décision ; aucune remise", () => {
    const pb = runPlaybook({ ...base, objection: "stock_available" });
    const r = mockObjectionReply({
      analysis: mockAnalyzeReply("J'ai trop de stock, il m'en reste 40"), customerName: "Bazar", contact: { salutation: "Mme", firstName: null, lastName: "Robert" },
      offer: { number: "OF-2", totalHt: "450", validUntil: null }, allowedDiscountPct: null, escalate: false, senderName: "Bruno", companyName: "JONAS", channel: "email",
      answers: [], unknownLabels: [], turn: 0,
      playbook: { strategy: pb.strategy, counterArguments: pb.counterArguments, removed: pb.removed, question: pb.question, followUpDate: pb.followUpDate,
        declaredStock: { qty: "40", productName: "Torchons" }, revised: { number: "OF-2", totalHt: pb.estimatedTotalHt!, originalTotalHt: pb.originalTotalHt, documents: ["Analyse-OF-2.xlsx"] } },
    });
    expect(r.body).toContain("Stock déclaré : 40 pièce(s) de « Torchons »");
    expect(r.body).toContain("Nouvelle proposition OF-2");
    expect(r.body).toContain("analyse de couverture");
    expect(r.body).toMatch(/estimations calculées à partir de vos achats/);
    expect(r.body).toContain("Un « OK » suffit");
    expect(r.proposedDiscountPct).toBeNull();
    expect(checkMessage(r.body, { allowedDiscountPct: null, personalizedAllowed: true }).ok).toBe(true);
  });
  it("refus explicite : jamais d'insistance", () => {
    const r = mockObjectionReply({
      analysis: mockAnalyzeReply("Non merci"), customerName: "Bazar", contact: null, offer: null, allowedDiscountPct: null, escalate: false, senderName: "Bruno", companyName: "JONAS",
      channel: "email", answers: [], unknownLabels: [], turn: 0, playbook: null,
    });
    expect(r.body).not.toMatch(/proposition|commande/i);
  });
});
