import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { toE164, isMobileFr, formatPhone } from "@/lib/phone";
import { WhatsAppCloudAdapter, parseWhatsAppWebhook, verifyMetaSignature } from "@/lib/integrations/whatsapp-cloud";
import { buildTemplate } from "@/features/conversations/templates";
import { whatsappWindowOpen, normalizeAddress } from "@/features/conversations/dispatch";
import { answerFromFacts, detectTopics, type Facts } from "@/features/agent/answers";
import { mockObjectionReply, mockAnalyzeReply } from "@/features/agent/mock-brain";

describe("Téléphones", () => {
  it("normalise en E.164", () => {
    expect(toE164("06 12 34 56 78")).toBe("+33612345678");
    expect(toE164("+33 6 12 34 56 78")).toBe("+33612345678");
    expect(toE164("0033612345678")).toBe("+33612345678");
    expect(toE164("33612345678")).toBe("+33612345678"); // wa_id
    expect(toE164("abc")).toBeNull();
    expect(isMobileFr("+33612345678")).toBe(true);
    expect(isMobileFr("+33142345678")).toBe(false);
    expect(formatPhone("+33612345678")).toBe("+33 6 12 34 56 78");
    expect(normalizeAddress("whatsapp", "06 12 34 56 78")).toBe("+33612345678");
    expect(normalizeAddress("email", " Jean@X.FR ")).toBe("jean@x.fr");
  });
});

describe("Règle WhatsApp des 24 h", () => {
  const now = new Date("2026-11-06T10:00:00Z");
  it("ouverte < 24 h après le dernier message du client, fermée sinon", () => {
    expect(whatsappWindowOpen("2026-11-05T10:30:00Z", now)).toBe(true);
    expect(whatsappWindowOpen("2026-11-05T09:59:00Z", now)).toBe(false);
    expect(whatsappWindowOpen(null, now)).toBe(false);
  });
});

describe("Modèles WhatsApp", () => {
  it("remplit les variables et nettoie les paramètres", () => {
    const t = buildTemplate("relance_offre", ["Monsieur\nMartin", "OF-2026-00001", "JONAS"]);
    expect(t.text).toBe("Bonjour Monsieur Martin, j'espère que vous allez bien ! Je me permets de revenir vers vous au sujet de la proposition OF-2026-00001, elle est toujours valable. Souhaitez-vous que je vous prépare la commande ?\nMerci d'avance pour votre retour,\nLéa de chez JONAS");
    expect(t.template).toEqual({ name: "relance_offre", language: "fr", params: ["Monsieur Martin", "OF-2026-00001", "JONAS"] });
    expect(() => buildTemplate("relance_offre", ["x"])).toThrow(/3 paramètre/);
  });
});

describe("WhatsApp Cloud API (Meta)", () => {
  it("vérifie la signature X-Hub-Signature-256", () => {
    const body = '{"entry":[]}';
    const sig = `sha256=${crypto.createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    expect(verifyMetaSignature("app-secret", body, sig)).toBe(true);
    expect(verifyMetaSignature("app-secret", body + " ", sig)).toBe(false);
    expect(verifyMetaSignature("autre", body, sig)).toBe(false);
    expect(verifyMetaSignature("app-secret", body, null)).toBe(false);
  });
  it("extrait les messages entrants et ignore les statuts", () => {
    const payload = { entry: [{ changes: [{ value: { metadata: { phone_number_id: "PNID" }, contacts: [{ profile: { name: "Jean" } }], messages: [{ from: "33612345678", id: "wamid.1", timestamp: "1700000000", type: "text", text: { body: "Bonjour" } }] } }, { value: { metadata: { phone_number_id: "PNID" }, statuses: [{ id: "x" }] } }] }] };
    expect(parseWhatsAppWebhook(payload)).toEqual([{ phoneNumberId: "PNID", from: "33612345678", providerMessageId: "wamid.1", body: "Bonjour", timestamp: "1700000000", profileName: "Jean" }]);
  });
  it("construit les charges utiles texte et modèle", () => {
    const base = { organizationId: "o", messageId: "m", channel: "whatsapp" as const, to: "+33612345678", subject: null, body: "Salut", attachments: [] };
    expect(WhatsAppCloudAdapter.payload({ ...base, template: null })).toEqual({ messaging_product: "whatsapp", to: "33612345678", type: "text", text: { preview_url: false, body: "Salut" } });
    const p = WhatsAppCloudAdapter.payload({ ...base, template: { name: "relance_offre", language: "fr", params: ["A", "B", "C"] } }) as { type: string; template: { components: { type: string }[] } };
    expect(p.type).toBe("template");
    expect(p.template.components.map((c) => c.type)).toEqual(["body"]);
  });
  it("envoie via l'API (fetch simulé) et renvoie l'identifiant Meta", async () => {
    const calls: { url: string; body: string }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.OUT" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const a = new WhatsAppCloudAdapter({ phoneNumberId: "PNID", accessToken: "tok" }, fake);
    const r = await a.send({ organizationId: "o", messageId: "m", channel: "whatsapp", to: "+33612345678", subject: null, body: "Bonjour", template: null, attachments: [] });
    expect(r).toEqual({ providerMessageId: "wamid.OUT", simulated: false });
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v21.0/PNID/messages");
  });
});

describe("Réponses factuelles", () => {
  const facts: Facts = {
    offer: { number: "OF-1", validUntil: "2026-12-06", totalHt: "1000.00", totalTtc: "1200.00", lines: [
      { reference: "R1", description: "Bougie parfumée", quantity: "24", unitPriceHt: "5.5000", unitsPerCase: 12, availability: "in_stock", qtyAvailable: "100", availableFrom: null },
      { reference: "R2", description: "Couronne Lin", quantity: "48", unitPriceHt: "10.0000", unitsPerCase: null, availability: "unknown", qtyAvailable: null, availableFrom: null },
    ] },
    customer: { francoAmount: "800.00", minOrderAmount: null, paymentTerms: "30 jours fin de mois" },
  };
  it("détecte les sujets", () => {
    expect(detectTopics("C'est dispo en stock ? Et le franco ?").sort()).toEqual(["availability", "franco"]);
    expect(detectTopics("Jusqu'à quand c'est valable, et quel délai de livraison ?").sort()).toEqual(["delivery_time", "validity"]);
  });
  it("répond avec les données et signale l'inconnu", () => {
    const r = answerFromFacts(["franco", "payment", "validity", "price", "delivery_time", "minimum"], facts, "le prix de la bougie ?");
    expect(r.answers).toContain("Votre franco de port est de 800,00 € HT : cette commande l'atteint, le port est offert.");
    expect(r.answers).toContain("Vos conditions de paiement : 30 jours fin de mois.");
    expect(r.answers).toContain("La proposition OF-1 est valable jusqu'au 6 décembre 2026.");
    expect(r.answers).toContain("Bougie parfumée (réf. R1) : 5,50 € HT l'unité.");
    expect(r.answers.some((a) => a.includes("Couronne"))).toBe(false); // seule la ligne citée
    expect(r.unknown.sort()).toEqual(["delivery_time", "minimum"]);
  });
  it("disponibilité inconnue : jamais affirmée", () => {
    const r = answerFromFacts(["availability"], facts, "c'est en stock ?");
    expect(r.answers).toEqual(["Bougie parfumée : disponible en stock pour la quantité proposée."]);
    expect(r.unknown).toEqual(["availability"]);
    expect(r.unknownLabels).toEqual(["la disponibilité de Couronne Lin"]);
  });
});

describe("Style des réponses selon le canal", () => {
  const ctx = {
    analysis: mockAnalyzeReply("Quel est mon franco ?"), customerName: "C", contact: { salutation: "M.", firstName: "Jean", lastName: "Martin" },
    offer: { number: "OF-1", totalHt: "100", validUntil: null }, allowedDiscountPct: null, escalate: false, senderName: "LÉA", companyName: "JONAS",
    answers: ["Votre franco de port est de 800,00 € HT."], unknownLabels: [] as string[],
  };
  it("WhatsApp : réponse non signée, salue quand le client salue, remercie et conclut vers la commande", () => {
    const first = mockObjectionReply({ ...ctx, channel: "whatsapp", turn: 0 });
    expect(first.body.startsWith("Bonjour Monsieur Martin !")).toBe(true);
    expect(first.body).not.toContain("—"); // une réponse dans la discussion n'est pas signée
    expect(first.body).not.toContain("LÉA");
    expect(first.body).not.toContain("Bien cordialement");
    expect(first.body).toContain("Merci pour votre message");
    expect(first.body).toContain("Souhaitez-vous que je lance la commande ?");
    expect(first.body).not.toContain("•");
    // En cours de discussion : pas de « Bonjour » répété… sauf si le client vient de dire bonjour.
    const later = mockObjectionReply({ ...ctx, channel: "whatsapp", turn: 2 });
    expect(later.body.startsWith("Merci pour votre message")).toBe(true);
    const greeted = mockObjectionReply({ ...ctx, channel: "whatsapp", turn: 2, clientGreeted: true });
    expect(greeted.body.startsWith("Bonjour Monsieur Martin !")).toBe(true);
  });
  it("Email : formules complètes", () => {
    const e = mockObjectionReply({ ...ctx, channel: "email", turn: 0 });
    expect(e.body).toContain("Bonjour Monsieur Martin,");
    expect(e.body).toContain("Bien cordialement,");
  });
});

describe("accroche du premier message WhatsApp", () => {
  it("donne une raison d'acheter, issue des faits du système", async () => {
    const { offerHook } = await import("@/features/agent/lea");
    expect(offerHook({ opportunityType: "reorder", salesFacts: [], usualInOffer: 3, newProductNames: [] })).toMatch(/fin de stock/);
    expect(offerHook({ opportunityType: null, salesFacts: ["Stock limité sur « Bougie » : 40 pièces disponibles à ce jour."], usualInOffer: 0, newProductNames: [] })).toMatch(/^Stock limité.+prévenir/);
    expect(offerHook({ opportunityType: "new_product", salesFacts: [], usualInOffer: 0, newProductNames: ["Lampe Lin"] })).toContain("« Lampe Lin »");
    expect(offerHook({ opportunityType: null, salesFacts: [], usualInOffer: 0, newProductNames: [] })).toBe("J'ai sélectionné pour vous des références adaptées à votre magasin.");
  });
});

describe("objection prix formulée simplement", () => {
  it("« c'est un peu cher » est une objection prix, pas une lecture humaine", async () => {
    const { mockAnalyzeReply } = await import("@/features/agent/mock-brain");
    for (const t of ["Bonjour Léa, c'est un peu cher pour moi en ce moment", "C'est cher", "Votre prix est assez cher", "c'est pas donné"]) expect(mockAnalyzeReply(t).objection).toBe("too_expensive");
  });
});
