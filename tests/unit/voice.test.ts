import { describe, expect, it } from "vitest";
import { mockAnalyzeReply, mockObjectionReply, mockOfferEmail } from "@/features/agent/mock-brain";
import { parseVoice, voicePrompt } from "@/features/agent/voice";
import { checkMessage } from "@/features/agent/guards";

const dynamic = parseVoice({ tone: "dynamic", length: "medium", whatsappEmojis: true, assistantTitle: "assistante commerciale" });
const base = {
  customerName: "Maison Martin",
  contact: { salutation: "M.", firstName: "Philippe", lastName: "Martin" },
  offer: { number: "OF-1", validUntil: null, totalHt: "1234.50", lines: [{ reference: "R1", description: "Bougie", quantity: "24.000" }] },
  history: { invoiceCount: 8, usualReferences: ["R1"] },
  newProductNames: [],
  senderName: "Bruno",
  companyName: "JONAS",
};

describe("Voix de LÉA", () => {
  it("réassort, ton dynamique : appel à l'action « OK », arguments factuels, présentation transparente", () => {
    const e = mockOfferEmail({ ...base, voice: dynamic, opportunityType: "reorder", salesFacts: ["« Bougie » fait partie de nos meilleures ventes du moment."] });
    expect(e.subject).toMatch(/^Votre réassort est prêt/);
    expect(e.body).toContain("Répondez simplement « OK »");
    expect(e.body).toContain("meilleures ventes du moment");
    expect(e.body).toContain("Léa de chez JONAS");
    expect(e.body).toContain("Pour Bruno");
    expect(checkMessage(e.body, { allowedDiscountPct: null, personalizedAllowed: true }).ok).toBe(true);
  });
  it("client inactif et nouveauté : accroches différentes", () => {
    expect(mockOfferEmail({ ...base, voice: dynamic, opportunityType: "dormant_customer" }).body).toContain("repartir sur de bonnes bases");
    expect(mockOfferEmail({ ...base, voice: dynamic, opportunityType: "new_product" }).body).toContain("commande test");
  });
  it("e-mail court par défaut : pas de bloc d'arguments", () => {
    const e = mockOfferEmail({ ...base, voice: parseVoice({}), opportunityType: "reorder", salesFacts: ["« Bougie » fait partie de nos meilleures ventes du moment."] });
    expect(e.body).not.toContain("Pourquoi maintenant");
  });
  it("objection prix : faits vérifiés puis ajustement proposé, emoji seulement sur WhatsApp", () => {
    const ctx = { ...base, voice: dynamic, analysis: mockAnalyzeReply("C'est trop cher"), offer: { number: "OF-1", totalHt: "100", validUntil: null }, allowedDiscountPct: null, escalate: false,
      answers: [], unknownLabels: [], turn: 0, salesFacts: ["Stock limité sur « Bougie » : 40 pièces disponibles à ce jour."] };
    const wa = mockObjectionReply({ ...ctx, channel: "whatsapp" });
    expect(wa.body).toContain("👋");
    expect(wa.body).toContain("Stock limité");
    expect(wa.body).toContain("sélection plus courte");
    const mail = mockObjectionReply({ ...ctx, channel: "email" });
    expect(mail.body).not.toMatch(/[👋✅📅]/u);
    expect(checkMessage(mail.body, { allowedDiscountPct: null, personalizedAllowed: true }).ok).toBe(true);
  });
  it("consigne IA : ton, présentation et interdits", () => {
    const p = voicePrompt(dynamic, "JONAS");
    expect(p).toContain("Léa de chez JONAS");
    expect(p).toContain("Ne cite jamais un autre client");
    expect(parseVoice({ tone: "inconnu" }).tone).toBe("warm");
  });
});
