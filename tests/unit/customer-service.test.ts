import { describe, expect, it } from "vitest";
import { detectServiceRequests, stockSentence } from "@/features/agent/customer-service";

describe("Service client : détection des demandes du client", () => {
  it.each([
    ["Quand je reçois ma commande ?", ["order_status"]],
    ["Bonjour, ma commande est partie ?", ["order_status"]],
    ["As tu cette référence en stock ? JNS-10008", ["stock"]],
    ["Vous avez encore des bougies vintage ?", ["stock"]],
    ["Envoie moi ma facture", ["invoice"]],
    ["Envoie moi mon bon de commande", ["order_form"]],
    ["Envoie-moi ma facture et le bon de commande stp", ["order_form", "invoice"]],
  ])("« %s »", (text, kinds) => {
    expect(detectServiceRequests(text)).toEqual(kinds);
  });
  it("une objection ou une simple réponse n'est pas une demande de service", () => {
    expect(detectServiceRequests("C'est trop cher pour moi")).toEqual([]);
    expect(detectServiceRequests("OK pour la commande")).toEqual([]);
  });
});

describe("Service client : réponse stock, jamais inventée", () => {
  const p = { id: "1", reference: "JNS-1", name: "Bougie", availability: "in_stock", available_from: null, units_per_case: 12, status: "active", qty_available: "240.000", captured_at: "2026-11-19" };
  it("quantité et date du relevé", () => {
    expect(stockSentence(p).text).toBe("Oui, « Bougie » (réf. JNS-1) est disponible : 240 pièces en stock (stock du 19 novembre), vendu par colis de 12.");
  });
  it("rupture avec ou sans date de retour", () => {
    expect(stockSentence({ ...p, qty_available: "0", available_from: "2026-12-02" }).text).toContain("en rupture pour le moment, de retour à partir du 2 décembre");
    const r = stockSentence({ ...p, qty_available: "0" });
    expect(r.text).toContain("je vérifie la date de retour avec votre commercial");
    expect(r.unknown).toBe(true);
  });
  it("disponibilité inconnue : transmise au commercial", () => {
    const r = stockSentence({ ...p, availability: "unknown", qty_available: null });
    expect(r).toMatchObject({ available: false, unknown: true });
  });
});
