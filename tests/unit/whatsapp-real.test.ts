import { describe, expect, it, vi } from "vitest";
import { WhatsAppCloudAdapter, parseWhatsAppWebhook } from "@/lib/integrations/whatsapp-cloud";
import { isTestNumberAllowed, parseTestNumbers } from "@/features/conversations/whatsapp-connection";

vi.mock("@/lib/storage", () => ({ getFile: async () => Buffer.from("PDFDATA") }));

describe("Webhook Meta : document envoyé par le client", () => {
  it("extrait le fichier (Excel) et sa légende", () => {
    const [m] = parseWhatsAppWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "123" }, messages: [{
      from: "33612345678", id: "wamid.1", timestamp: "1763600000", type: "document",
      document: { id: "998877", filename: "mes-quantites.xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", caption: "Voici mes quantités" } }] } }] }] });
    expect(m).toMatchObject({ from: "33612345678", body: "Voici mes quantités", document: { mediaId: "998877", filename: "mes-quantites.xlsx" } });
  });
  it("sans légende : nom du fichier ; message texte : pas de document", () => {
    const [d] = parseWhatsAppWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "1" }, messages: [{ from: "1", id: "a", type: "document", document: { id: "5", filename: "x.xlsx" } }] } }] }] });
    expect(d!.body).toBe("📎 x.xlsx");
    const [t] = parseWhatsAppWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "1" }, messages: [{ from: "1", id: "b", type: "text", text: { body: "Bonjour" } }] } }] }] });
    expect(t!.document).toBeNull();
  });
});

describe("Mode test", () => {
  it("numéros de test normalisés, invalides signalés", () => {
    expect(parseTestNumbers("06 12 34 56 78, +33 6 98 76 54 32; 06 12 34 56 78, abc")).toEqual({ numbers: ["+33612345678", "+33698765432"], invalid: ["abc"] });
  });
  it("seuls les numéros de test passent quand le mode test est actif", () => {
    const cfg = { testMode: true, testNumbers: ["+33612345678"] };
    expect(isTestNumberAllowed(cfg, "+33612345678")).toBe(true);
    expect(isTestNumberAllowed(cfg, "+33699999999")).toBe(false);
    expect(isTestNumberAllowed({ testMode: false }, "+33699999999")).toBe(true);
  });
});

describe("Connecteur Meta (réseau simulé)", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  it("message libre avec document : envoi du fichier, du texte, puis du document", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const http = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : "form" });
      return url.endsWith("/media") ? ok({ id: "MEDIA1" }) : ok({ messages: [{ id: `wamid.${calls.length}` }] });
    });
    const a = new WhatsAppCloudAdapter({ phoneNumberId: "123", accessToken: "T" }, http as unknown as typeof fetch);
    const r = await a.send({ organizationId: "o", messageId: "m", channel: "whatsapp", to: "+33612345678", subject: null, body: "Voici votre bon de commande.", template: null,
      attachments: [{ filename: "Bon.pdf", storagePath: "o/x/Bon.pdf", mimeType: "application/pdf" }] });
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["media", "messages", "messages"]);
    expect(calls[1]!.body).toMatchObject({ type: "text", to: "33612345678", text: { body: "Voici votre bon de commande." } });
    expect(calls[2]!.body).toMatchObject({ type: "document", document: { id: "MEDIA1", filename: "Bon.pdf" } });
    expect(r.providerMessageId).toBe("wamid.2");
  });
  it("téléchargement d'un fichier reçu, taille bornée", async () => {
    const http = vi.fn(async (url: string) => (url.includes("/998877") ? ok({ url: "https://lookaside.example/f", mime_type: "application/vnd.ms-excel", file_size: 4 }) : new Response(Buffer.from("XLSX"))));
    const a = new WhatsAppCloudAdapter({ phoneNumberId: "123", accessToken: "T" }, http as unknown as typeof fetch);
    expect((await a.downloadMedia("998877", 1000)).data.toString()).toBe("XLSX");
    await expect(a.downloadMedia("998877", 2)).rejects.toThrow(/volumineux/);
    await expect(a.downloadMedia("../x", 1000)).rejects.toThrow(/invalide/);
  });
});
