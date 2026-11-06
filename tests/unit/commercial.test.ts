import { describe, expect, it } from "vitest";
import { computeTotals, lineTotal, round2, dec } from "@/lib/money";
import { customerSummary, productHabits, coPurchase, type InvoiceLite, type LineLite } from "@/features/invoices/analytics";
import { resolvePrice } from "@/features/offers/pricing";
import { buildOfferDraft, roundToCase, type BuilderProduct } from "@/features/offers/builder";
import { evaluateDiscount, clampDiscount, JONAS_PILOT_POLICY, DEFAULT_POLICY } from "@/features/offers/policy";
import { detectOpportunities, type EngineProduct } from "@/features/opportunities/engine";

describe("Calculs financiers décimaux", () => {
  it("évite les erreurs de flottants", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(dec("0.1").plus("0.2").toString()).toBe("0.3");
    expect(lineTotal("3", "19.99").toFixed(2)).toBe("59.97");
    expect(lineTotal("7", "1.115", "0").toFixed(2)).toBe("7.81"); // 7.805 → arrondi commercial
    expect(round2("2.675").toFixed(2)).toBe("2.68");
  });
  it("ventile la TVA par taux", () => {
    const t = computeTotals([{ totalHt: "100.00", vatRate: "20" }, { totalHt: "50.00", vatRate: "5.5" }, { totalHt: "0.05", vatRate: "20" }]);
    expect(t.totalHt.toFixed(2)).toBe("150.05");
    expect(t.totalVat.toFixed(2)).toBe("22.76"); // 20.01 + 2.75
    expect(t.totalTtc.toFixed(2)).toBe("172.81");
  });
});

const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);

function history(dates: number[], productIds: string[], extra: Partial<InvoiceLite> = {}) {
  const invoices: InvoiceLite[] = dates.map((d, i) => ({ id: `i${i}`, date: day(d), docType: "invoice", status: "issued", totalHt: "100.00", ...extra }));
  const lines: LineLite[] = invoices.flatMap((inv) => productIds.map((p) => ({ invoiceId: inv.id, productId: p, quantity: "12", unitPriceHt: "5.00", lineTotalHt: "60.00" })));
  return { invoices, lines };
}

describe("Analytique factures", () => {
  it("exclut les annulations et déduit les avoirs", () => {
    const inv: InvoiceLite[] = [
      { id: "a", date: day(10), docType: "invoice", status: "issued", totalHt: "1000.00" },
      { id: "b", date: day(20), docType: "invoice", status: "cancelled", totalHt: "5000.00" },
      { id: "c", date: day(25), docType: "credit_note", status: "issued", totalHt: "200.00" },
      { id: "d", date: day(40), docType: "invoice", status: "issued", totalHt: "500.00" },
    ];
    const s = customerSummary(inv, day(60));
    expect(s.revenue12m).toBe("1300.00");
    expect(s.invoiceCount).toBe(2);
    expect(s.avgBasket).toBe("750.00");
    expect(s.lastPurchase).toBe(day(40));
    expect(s.meanIntervalDays).toBe(30);
  });
  it("calcule produits habituels, cycles et prochain achat", () => {
    const { invoices, lines } = history([0, 30, 60, 90], ["p1"]);
    const [h] = productHabits(invoices, lines, day(100));
    expect(h!.orders).toBe(4);
    expect(h!.meanIntervalDays).toBe(30);
    expect(h!.intervalCv).toBe(0);
    expect(h!.nextExpected).toBe(day(120));
    expect(h!.daysUntilNext).toBe(20);
    expect(h!.avgQtyPerOrder).toBe("12.000");
  });
  it("détecte les co-achats", () => {
    const lines = [1, 2, 3, 4].flatMap((i) => [{ invoiceId: `x${i}`, productId: "a" }, { invoiceId: `x${i}`, productId: "b" }]).concat([{ invoiceId: "y", productId: "c" }]);
    const assoc = coPurchase(lines, 3);
    expect(assoc.get("a")?.[0]?.productId).toBe("b");
  });
});

describe("Résolution des prix", () => {
  const prices = [
    { productId: "p", customerId: "c1", unitPriceHt: "9.00", minQty: 1, validFrom: "2026-01-01", validTo: null },
    { productId: "p", customerId: null, unitPriceHt: "9.50", minQty: 1, validFrom: null, validTo: "2025-12-31" },
  ];
  it("priorise le tarif client valide", () => {
    expect(resolvePrice({ id: "p", salePriceHt: "10.00" }, "c1", prices, "2026-03-01")).toEqual({ unitPriceHt: "9.00", source: "customer_price" });
  });
  it("ignore les tarifs expirés et retombe sur le catalogue", () => {
    expect(resolvePrice({ id: "p", salePriceHt: "10.00" }, "c2", prices, "2026-03-01")).toEqual({ unitPriceHt: "10.00", source: "catalog" });
  });
  it("n'invente jamais de prix", () => {
    expect(resolvePrice({ id: "p", salePriceHt: null }, "c2", prices, "2026-03-01")).toBeNull();
  });
});

describe("Construction d'offre", () => {
  const product = (o: Partial<BuilderProduct>): BuilderProduct => ({
    id: "p1", reference: "R1", name: "Produit 1", salePriceHt: "10.00", vatRate: "20.00", unitsPerCase: 12, minOrderQty: null, availability: "in_stock", qtyAvailable: "500", availableFrom: null, ...o,
  });
  it("arrondit au colis supérieur et respecte le minimum", () => {
    expect(roundToCase("13", 12, null)).toBe("24");
    expect(roundToCase("2", 1, 5)).toBe("5");
    expect(roundToCase("0", 6, null)).toBe("6");
  });
  it("exclut les produits sans prix ou en rupture sans date, signale l'inconnu", () => {
    const d = buildOfferDraft({
      customer: { id: "c", minOrderAmount: "1000.00", francoAmount: null },
      items: [{ productId: "p1", suggestedQty: "10" }, { productId: "p2", suggestedQty: "5" }, { productId: "p3", suggestedQty: "5" }, { productId: "p4", suggestedQty: "3" }],
      products: [product({}), product({ id: "p2", reference: "R2", salePriceHt: null }), product({ id: "p3", reference: "R3", availability: "out_of_stock" }), product({ id: "p4", reference: "R4", availability: "unknown", unitsPerCase: null })],
      prices: [],
      policy: DEFAULT_POLICY,
      date: "2026-11-06",
    });
    expect(d.lines.map((l) => l.reference)).toEqual(["R1", "R4"]);
    expect(d.lines[0]!.quantity).toBe("12");
    expect(d.excluded.map((e) => e.code).sort()).toEqual(["no_price", "out_of_stock"]);
    expect(d.warnings.some((w) => w.code === "availability")).toBe(true);
    expect(d.warnings.some((w) => w.code === "below_minimum")).toBe(true);
    expect(d.totalHt).toBe("150.00");
    expect(d.totalTtc).toBe("180.00");
    expect(d.requiresApproval).toBe(true);
  });
  it("borne la remise au plafond de la politique", () => {
    const d = buildOfferDraft({ customer: { id: "c", minOrderAmount: null, francoAmount: null }, items: [{ productId: "p1", suggestedQty: "12", discountPct: "5" }], products: [product({})], prices: [], policy: JONAS_PILOT_POLICY, date: "2026-11-06" });
    expect(d.lines[0]!.discountPct).toBe("1.00");
    expect(d.lines[0]!.lineTotalHt).toBe("118.80");
    expect(d.warnings.some((w) => w.code === "discount_clamped")).toBe(true);
  });
});

describe("Politique de négociation", () => {
  it("JONAS : 1 % maximum, au-delà transfert, validation humaine", () => {
    expect(evaluateDiscount(JONAS_PILOT_POLICY, 1)).toMatchObject({ kind: "within_policy", pct: "1.00", needsApproval: true });
    expect(evaluateDiscount(JONAS_PILOT_POLICY, 1.5)).toMatchObject({ kind: "escalate", maxPct: "1.00" });
    expect(evaluateDiscount(JONAS_PILOT_POLICY, -3).kind).toBe("escalate");
    expect(clampDiscount(JONAS_PILOT_POLICY, "12")).toBe("1.00");
  });
  it("les paramètres JONAS ne s'appliquent pas par défaut", () => {
    expect(DEFAULT_POLICY.maxAutoDiscountPct).toBe("0");
    expect(evaluateDiscount(DEFAULT_POLICY, 1).kind).toBe("escalate");
  });
});

describe("Moteur d'opportunités", () => {
  const products: EngineProduct[] = [
    { id: "p1", reference: "R1", name: "A", category: "Cuisine", salePriceHt: "5.00", isNew: false, launchedAt: null, availability: "in_stock", status: "active" },
    { id: "pn", reference: "RN", name: "Nouveau", category: "Cuisine", salePriceHt: "8.00", isNew: true, launchedAt: "2026-10-01", availability: "in_stock", status: "active" },
  ];
  const settings = { dormantAfterDays: 120, reorderLookaheadDays: 21 };
  it("détecte un réassort avec valeur estimée et justification", () => {
    const { invoices, lines } = history([0, 30, 60, 90, 120], ["p1"]);
    const opps = detectOpportunities({ today: day(140), customer: { id: "c", name: "Client", status: "active" }, invoices, lines, products, prices: [], settings });
    const r = opps.find((o) => o.type === "reorder")!;
    expect(r.estimatedValueHt).toBe("60.00");
    expect(r.confidence).toBeGreaterThan(0.7);
    expect(r.justification).toContain("tous les 30 jours");
    expect(opps.some((o) => o.type === "new_product" && o.productIds.includes("pn"))).toBe(true);
  });
  it("détecte un client dormant et ne propose pas de réassort", () => {
    const { invoices, lines } = history([0, 30, 60], ["p1"]);
    const opps = detectOpportunities({ today: day(300), customer: { id: "c", name: "Client", status: "active" }, invoices, lines, products, prices: [], settings });
    expect(opps.map((o) => o.type)).toContain("dormant_customer");
    expect(opps.map((o) => o.type)).not.toContain("reorder");
  });
  it("n'estime aucune valeur sans prix connu", () => {
    const { invoices, lines } = history([0, 30, 60, 90, 120], ["p1"]);
    const opps = detectOpportunities({ today: day(140), customer: { id: "c", name: "C", status: "active" }, invoices, lines, products: [{ ...products[0]!, salePriceHt: null }], prices: [], settings });
    expect(opps.find((o) => o.type === "reorder")!.estimatedValueHt).toBeNull();
  });
  it("clé de dédoublonnage stable", () => {
    const { invoices, lines } = history([0, 30, 60, 90, 120], ["p1"]);
    const a = detectOpportunities({ today: day(140), customer: { id: "c", name: "C", status: "active" }, invoices, lines, products, prices: [], settings });
    const b = detectOpportunities({ today: day(141), customer: { id: "c", name: "C", status: "active" }, invoices, lines, products, prices: [], settings });
    expect(a.find((o) => o.type === "reorder")!.dedupeKey).toBe(b.find((o) => o.type === "reorder")!.dedupeKey);
  });
  it("ignore les clients bloqués", () => {
    const { invoices, lines } = history([0, 30, 60, 90, 120], ["p1"]);
    expect(detectOpportunities({ today: day(140), customer: { id: "c", name: "C", status: "blocked" }, invoices, lines, products, prices: [], settings })).toEqual([]);
  });
});
