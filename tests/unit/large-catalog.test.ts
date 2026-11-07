import { describe, expect, it } from "vitest";
import { buildOfferDraft, type BuilderProduct } from "@/features/offers/builder";
import { DEFAULT_POLICY } from "@/features/offers/policy";
import { mockOfferEmail } from "@/features/agent/mock-brain";
import { buildCatalogIndex, detectOpportunities, DEFAULT_LIMITS, type EngineProduct } from "@/features/opportunities/engine";

const product = (i: number): BuilderProduct => ({
  id: `p${i}`, reference: `R${i}`, name: `Produit ${i}`, salePriceHt: "2.50", vatRate: "20.00", unitsPerCase: 6, minOrderQty: null, availability: "in_stock", qtyAvailable: null, availableFrom: null,
});

describe("Offres volumineuses", () => {
  it("500 lignes : aucune limite arbitraire, totaux décimaux exacts, construction rapide", () => {
    const products = Array.from({ length: 500 }, (_, i) => product(i));
    const t = performance.now();
    const d = buildOfferDraft({ customer: { id: "c", minOrderAmount: null, francoAmount: null }, items: products.map((p) => ({ productId: p.id, suggestedQty: "7" })), products, prices: [], policy: DEFAULT_POLICY, date: "2026-11-06" });
    expect(performance.now() - t).toBeLessThan(500);
    expect(d.lines).toHaveLength(500);
    expect(d.totalHt).toBe("15000.00"); // 500 × 12 (colis de 6) × 2,50
  });
  it("doublons fusionnés : une seule ligne par produit, quantités additionnées, signalé", () => {
    const d = buildOfferDraft({ customer: { id: "c", minOrderAmount: null, francoAmount: null }, items: [{ productId: "p1", suggestedQty: "6" }, { productId: "p1", suggestedQty: "6" }], products: [product(1)], prices: [], policy: DEFAULT_POLICY, date: "2026-11-06" });
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]!.quantity).toBe("12");
    expect(d.warnings.map((w) => w.code)).toContain("duplicate_merged");
  });
  it("email d'une offre de 200 lignes : résumé par catégorie, jamais la liste complète", () => {
    const lines = Array.from({ length: 25 }, (_, i) => ({ reference: `R${i}`, description: `Produit ${i}`, quantity: "12" }));
    const e = mockOfferEmail({ customerName: "Grand compte", contact: null, offer: { number: "OF-1", validUntil: null, totalHt: "9000", lineCount: 200, categories: [{ name: "Cuisine", lines: 120 }, { name: "Ménage", lines: 80 }], lines },
      history: { invoiceCount: 40, usualReferences: ["R1"] }, newProductNames: [], senderName: "Bruno", companyName: "JONAS" });
    expect(e.body).toContain("200 références réparties en 2 catégorie(s) : Cuisine (120), Ménage (80)");
    expect(e.body).toContain("… et 194 autre(s) référence(s)");
    expect(e.body.split("\n").filter((l) => l.startsWith("• "))).toHaveLength(6);
  });
});

describe("Moteur d'opportunités : plafonds dimensionnés pour les grands catalogues", () => {
  it("plusieurs dizaines de nouveautés peuvent être proposées (plus de plafond à 4)", () => {
    expect(DEFAULT_LIMITS.newProducts).toBeGreaterThanOrEqual(40);
    const products: EngineProduct[] = Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, reference: `N${i}`, name: `Nouveauté ${i}`, category: "Cuisine", salePriceHt: "3", isNew: true, launchedAt: "2026-10-20", availability: "in_stock", status: "active" }));
    products.push({ id: "b", reference: "B", name: "Habituel", category: "Cuisine", salePriceHt: "3", isNew: false, launchedAt: null, availability: "in_stock", status: "active" });
    const invoices = ["2026-08-01", "2026-09-01", "2026-10-01"].map((d, k) => ({ id: `i${k}`, date: d, docType: "invoice" as const, status: "issued" as const, totalHt: "30" }));
    const lines = invoices.map((i) => ({ invoiceId: i.id, productId: "b", quantity: "10", unitPriceHt: "3", lineTotalHt: "30" }));
    const out = detectOpportunities({ today: "2026-11-06", customer: { id: "c", name: "Client", status: "active" }, invoices, lines, products, prices: [], settings: { dormantAfterDays: 120, reorderLookaheadDays: 21 }, index: buildCatalogIndex(products, []) });
    const news = out.find((o) => o.type === "new_product")!;
    expect(news.productIds).toHaveLength(40);
    expect(news.justification).toMatch(/et 32 autre\(s\)/);
  });
});
