import { describe, expect, it } from "vitest";
import { computeTargetProgress, periodEnd } from "@/features/customers/targets";
import { detectOpportunities, scoreOpportunity, type EngineProduct } from "@/features/opportunities/engine";
import { isPermanent, permanentProducts, MISSION_OF } from "@/features/opportunities/missions";
import { productHabits, type InvoiceLite, type LineLite } from "@/features/invoices/analytics";

const inv = (id: string, date: string, ht: string, extra: Partial<InvoiceLite> = {}): InvoiceLite => ({ id, date, docType: "invoice", status: "issued", totalHt: ht, ...extra });

describe("Mission 6 — objectifs de CA", () => {
  it("fin de période", () => {
    expect(periodEnd({ periodType: "year", periodStart: "2026-01-01" })).toBe("2026-12-31");
    expect(periodEnd({ periodType: "month", periodStart: "2026-02-01" })).toBe("2026-02-28");
  });

  it("prorata temporis sans historique N-1 : réalisé, attendu, écart, prévision", () => {
    // 1er juillet = 182 jours sur 365 → 49,9 % de la période
    const invoices = [inv("a", "2026-02-10", "10000.00"), inv("b", "2026-05-10", "20000.00"), inv("c", "2026-03-01", "5000.00", { status: "cancelled" }), inv("d", "2026-04-01", "2000.00", { docType: "credit_note" })];
    const p = computeTargetProgress(invoices, { periodType: "year", periodStart: "2026-01-01", targetHt: "100000" }, "2026-07-01");
    expect(p.method).toBe("prorata");
    expect(p.realizedHt).toBe("28000.00"); // annulée exclue, avoir déduit
    expect(p.expectedToDateHt).toBe("49863.01"); // 100 000 × 182/365
    expect(p.gapHt).toBe("-21863.01");
    expect(p.status).toBe("behind");
    expect(p.forecastHt).toBe("56153.85"); // 28 000 / (182/365)
  });

  it("saisonnalité N-1 si l'historique couvre l'an dernier", () => {
    const invoices = [inv("p1", "2025-01-15", "30000.00"), inv("p2", "2025-09-15", "70000.00"), inv("n1", "2026-01-20", "33000.00")];
    const p = computeTargetProgress(invoices, { periodType: "year", periodStart: "2026-01-01", targetHt: "110000" }, "2026-06-30");
    expect(p.method).toBe("seasonality_n1");
    expect(p.elapsedShare).toBe(0.3); // 30 % du CA N-1 réalisé à cette date
    expect(p.expectedToDateHt).toBe("33000.00");
    expect(p.status).toBe("on_track");
    expect(p.forecastHt).toBe("110000.00");
  });

  it("trop tôt dans la période : « À confirmer »", () => {
    const p = computeTargetProgress([], { periodType: "year", periodStart: "2026-01-01", targetHt: "50000" }, "2026-01-05");
    expect(p.status).toBe("unknown");
    expect(p.forecastHt).toBeNull();
  });
});

describe("Mission 2 — produits permanents", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);
  const invoices: InvoiceLite[] = [0, 30, 61, 90].map((d, i) => inv(`i${i}`, day(d), "100"));
  const lines: LineLite[] = invoices.flatMap((i) => [
    { invoiceId: i.id, productId: "regulier", quantity: "13", unitPriceHt: "5", lineTotalHt: "65" },
    ...(i.id === "i0" || i.id === "i3" ? [{ invoiceId: i.id, productId: "ponctuel", quantity: "2", unitPriceHt: "5", lineTotalHt: "10" }] : []),
  ]);
  it("régularité et quantité conseillée au colis", () => {
    const habits = productHabits(invoices, lines, day(100));
    expect(habits.filter(isPermanent).map((h) => h.productId)).toEqual(["regulier"]);
    const [p] = permanentProducts(habits, new Map([["regulier", { unitsPerCase: 12, minOrderQty: null }]]));
    expect(p!.suggestedQty).toBe("24");
    expect(p!.dueSoon).toBe(true);
  });
});

describe("Moteur — missions 3, 5, 6 et priorisation", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);
  const products: EngineProduct[] = [{ id: "p1", reference: "R1", name: "A", category: "Cuisine", salePriceHt: "50.00", isNew: false, launchedAt: null, availability: "in_stock", status: "active" }];
  const invoices = [0, 30, 60, 90, 120, 150].map((d, i) => inv(`i${i}`, day(d), "6000.00"));
  const lines: LineLite[] = invoices.map((i) => ({ invoiceId: i.id, productId: "p1", quantity: "120", unitPriceHt: "50.00", lineTotalHt: "6000.00" }));
  const base = { customer: { id: "c", name: "Client", status: "active" }, invoices, lines, products, prices: [], settings: { dormantAfterDays: 120, reorderLookaheadDays: 21 } };

  it("retour en stock d'un produit habituel", () => {
    const opps = detectOpportunities({ ...base, today: day(160), restocks: [{ productId: "p1", restockedAt: day(150) }] });
    const b = opps.find((o) => o.type === "back_in_stock")!;
    expect(b.estimatedValueHt).toBe("6000.00");
    expect(b.details.mission).toBe("complementary");
  });

  it("rendez-vous : compte important jamais rencontré, argumentaire contextualisé", () => {
    const opps = detectOpportunities({ ...base, today: day(160), lastMeetingAt: null, meetingIntervalDays: 180 });
    const a = opps.find((o) => o.type === "appointment")!;
    expect(a.title).toContain("non rencontré");
    expect(a.justification).toContain("Aucun rendez-vous enregistré");
    expect(a.details.format).toBe("visio");
    const recent = detectOpportunities({ ...base, today: day(160), lastMeetingAt: day(100), meetingIntervalDays: 180 });
    expect(recent.some((o) => o.type === "appointment")).toBe(false);
  });

  it("objectif en retard : plan chiffré borné par les leviers, jamais inventé", () => {
    const opps = detectOpportunities({ ...base, today: day(160), target: { periodType: "year", periodStart: "2026-01-01", targetHt: "200000" } });
    const t = opps.find((o) => o.type === "target_gap")!;
    const reorder = opps.find((o) => o.type === "reorder")!;
    expect(t.estimatedValueHt).toBe(reorder.estimatedValueHt); // retard > levier : la valeur = ce que couvrent les leviers
    expect(t.recommendedAction).toContain("Plan d'accélération");
    const none = detectOpportunities({ ...base, products: [{ ...products[0]!, salePriceHt: null }], today: day(160), target: { periodType: "year", periodStart: "2026-01-01", targetHt: "200000" } });
    expect(none.find((o) => o.type === "target_gap")!.estimatedValueHt).toBeNull();
  });

  it("refus ou opposition : aucune opportunité proactive", () => {
    expect(detectOpportunities({ ...base, today: day(160), blockedReason: "Pause après un refus." })).toEqual([]);
  });

  it("priorité = potentiel × urgence × probabilité, sans potentiel inventé", () => {
    expect(scoreOpportunity(null, 0.5, 0)).toEqual({ priority: 53, potential: 0.2, urgency: 1, probability: 0.5 });
    expect(scoreOpportunity("10000", 0.9, 30).priority).toBeGreaterThan(scoreOpportunity("100", 0.9, 30).priority);
    expect(scoreOpportunity("10000", 0.9, 0).priority).toBeGreaterThan(scoreOpportunity("10000", 0.9, 45).priority);
    const opps = detectOpportunities({ ...base, today: day(160) });
    for (const o of opps) expect(o.details.scoring).toBeTruthy();
  });

  it("chaque type est rattaché à une des missions", () => {
    for (const t of ["dormant_customer", "reorder", "cross_sell", "back_in_stock", "new_product", "appointment", "target_gap"]) expect(MISSION_OF[t]).toBeTruthy();
  });
});
