import { describe, expect, it } from "vitest";
import { D } from "@/lib/money";
import { splitAnnual, buildObjectiveTable } from "@/features/targets/objectives";
import { detectOpportunities, buildCatalogIndex, type EngineProduct } from "@/features/opportunities/engine";

const months = (xs: number[]) => xs.map((x) => new D(x));

describe("Répartition des objectifs mensuels", () => {
  it("saisonnalité N-1 : proportionnelle, somme exactement égale à l'objectif annuel", () => {
    const n1 = months([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 900]); // décembre = 45 %
    const r = splitAnnual("10000.00", n1);
    expect(r.source).toBe("seasonality");
    expect(r.months[11]).toBe("4500.00");
    expect(r.months.reduce((a, m) => a + Number(m), 0).toFixed(2)).toBe("10000.00");
  });
  it("historique N-1 incomplet (un seul mois connu) : pas de concentration de l'objectif, parts égales", () => {
    const r = splitAnnual("12000.00", months([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8860]));
    expect(r.source).toBe("prorata");
    expect(r.months[11]).toBe("1000.00");
  });
  it("sans historique N-1 : parts égales, arrondi reporté sur décembre", () => {
    const r = splitAnnual("1000.00", months(Array(12).fill(0)));
    expect(r.source).toBe("prorata");
    expect(r.months[0]).toBe("83.33");
    expect(r.months[11]).toBe("83.37");
  });
});

describe("Tableau d'objectifs", () => {
  const n1 = months(Array(12).fill(1000));
  it("attendu à date = mois écoulés + mois en cours au prorata ; écart, atteinte, statut, prévision", () => {
    const realized = months([800, 800, 800, 800, 800, 800, 800, 800, 800, 800, 400, 0]); // 15 novembre
    const t = buildObjectiveTable({ year: 2026, today: "2026-11-15", annualTargetHt: "12000.00", monthlyTargets: new Map(), realized, n1 });
    expect(t.summary.expectedToDateHt).toBe("10500.00"); // 10 × 1 000 + 1 000 × 15/30
    expect(t.summary.realizedYtdHt).toBe("8400.00");
    expect(t.summary.gapToDateHt).toBe("-2100.00");
    expect(t.summary.attainmentToDatePct).toBe(80);
    expect(t.summary.status).toBe("behind");
    expect(t.summary.forecastHt).toBe("9600.00"); // 8 400 + 1 500 restants × 0,8
    expect(t.rows[11]!.realizedHt).toBeNull(); // mois futur : inconnu, pas 0
    expect(t.rows[0]!.evolutionPct).toBe(-20);
  });
  it("un objectif mensuel saisi à la main prime sur la répartition automatique", () => {
    const t = buildObjectiveTable({ year: 2026, today: "2026-03-31", annualTargetHt: "12000.00", monthlyTargets: new Map([[3, { targetHt: "3000.00", source: "manual" }]]), realized: months(Array(12).fill(0)), n1 });
    expect(t.rows[2]).toMatchObject({ targetHt: "3000.00", targetSource: "manual" });
    expect(t.rows[3]!.targetSource).toBe("seasonality");
  });
  it("sans objectif : écart et prévision « À confirmer » (null), jamais inventés", () => {
    const t = buildObjectiveTable({ year: 2026, today: "2026-06-30", annualTargetHt: null, monthlyTargets: new Map(), realized: n1, n1 });
    expect(t.summary).toMatchObject({ annualTargetHt: null, gapToDateHt: null, forecastHt: null, status: "unknown" });
  });
});

describe("Dormance relative à la fréquence du client", () => {
  const prod: EngineProduct = { id: "p", reference: "P", name: "P", category: "C", salePriceHt: "5", isNew: false, launchedAt: null, availability: "in_stock", status: "active" };
  const run = (dates: string[]) => {
    const invoices = dates.map((d, k) => ({ id: `i${k}`, date: d, docType: "invoice" as const, status: "issued" as const, totalHt: "100" }));
    const lines = invoices.map((i) => ({ invoiceId: i.id, productId: "p", quantity: "20", unitPriceHt: "5", lineTotalHt: "100" }));
    return detectOpportunities({ today: "2026-11-06", customer: { id: "c", name: "C", status: "active" }, invoices, lines, products: [prod], prices: [], settings: { dormantAfterDays: 120, reorderLookaheadDays: 21 }, index: buildCatalogIndex([prod], []) });
  };
  it("un client hebdomadaire inactif depuis 40 jours est dormant (le seuil fixe de 120 j ne l'aurait pas vu)", () => {
    const d = run(["2026-08-29", "2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26"]).find((o) => o.type === "dormant_customer");
    expect(d).toBeTruthy();
    expect(d!.details).toMatchObject({ basis: "cycle_client", thresholdDays: 21 });
    expect(d!.justification).toMatch(/fois son cycle habituel/);
  });
  it("un client trimestriel inactif depuis 100 jours n'est pas dormant (100 < 2,5 × 90)", () => {
    expect(run(["2025-11-01", "2026-02-01", "2026-05-01", "2026-07-29"]).some((o) => o.type === "dormant_customer")).toBe(false);
  });
});
