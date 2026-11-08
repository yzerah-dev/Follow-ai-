import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseClientOfferExcel, parseQuantity, ClientExcelUnreadable } from "@/features/offers/client-excel";
import { excelReplyText } from "@/features/agent/excel-return";

async function xlsx(rows: (string | number | null)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Offre");
  ws.getCell("A1").value = "JONAS — Proposition commerciale";
  rows.forEach((r, i) => (ws.getRow(7 + i).values = r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("Excel renvoyé par le client", () => {
  it("lit référence + quantité sous l'en-tête, ignore le reste (prix compris)", async () => {
    const buf = await xlsx([
      ["Photo", "Référence", "EAN", "Désignation", "Colisage", "Quantité suggérée", "Prix HT (€)"],
      ["", "JNS-1", "2000011010010", "Bougie", 12, 24, 0.01],
      ["", "JNS-2", null, "Torchon", 6, "", 3.5],
      ["", "JNS-3", null, "Vase", 6, "abc", 9],
      ["", null, "2000011010034", "Lampe", 1, "1 200", 5],
    ]);
    const r = await parseClientOfferExcel(buf);
    expect(r.rows).toEqual([
      { row: 8, reference: "JNS-1", ean: "2000011010010", quantity: "24" },
      { row: 9, reference: "JNS-2", ean: null, quantity: null },
      { row: 11, reference: null, ean: "2000011010034", quantity: "1200" },
    ]);
    expect(r.invalid).toEqual([{ row: 10, reference: "JNS-3", value: "abc" }]);
  });
  it("une colonne ajoutée par le client (« Quantité commandée ») prime sur la quantité suggérée", async () => {
    const r = await parseClientOfferExcel(await xlsx([["Référence", "Quantité suggérée", "Quantité commandée"], ["JNS-1", 24, 36]]));
    expect(r.rows[0]!.quantity).toBe("36");
  });
  it("fichier sans colonnes reconnaissables ou corrompu : illisible", async () => {
    await expect(parseClientOfferExcel(await xlsx([["Produit", "Nombre"], ["x", 1]]))).rejects.toBeInstanceOf(ClientExcelUnreadable);
    await expect(parseClientOfferExcel(Buffer.from("pas un excel"))).rejects.toBeInstanceOf(ClientExcelUnreadable);
  });
  it("quantités : entiers positifs uniquement", () => {
    expect(parseQuantity("48")).toEqual({ ok: true, qty: "48" });
    expect(parseQuantity("48,0")).toEqual({ ok: true, qty: "48" });
    expect(parseQuantity("")).toEqual({ ok: true, qty: null });
    expect(parseQuantity("-3").ok).toBe(false);
    expect(parseQuantity("2,5").ok).toBe(false);
  });
  it("réponse WhatsApp : commande mise à jour, arrondis, retraits, points transmis, sans signature", () => {
    const t = excelReplyText({
      status: "revised", channel: "whatsapp", hello: "Bonjour Monsieur Martin,", lineCount: 3, totalHt: "1234.50", companyName: "JONAS", voice: {},
      change: { added: [], removed: ["Vase"], rounded: [{ name: "Bougie", asked: "50", final: "60" }], excluded: [], unknown: ["XYZ-9"], invalid: [] },
    });
    expect(t).toMatch(/^Merci Monsieur Martin, c'est noté ! J'ai mis à jour votre commande avec vos quantités : 3 références pour 1\s234,50\s€ HT\./);
    expect(t).toContain("Quantités arrondies au colisage : Bougie 50 → 60.");
    expect(t).toContain("Retiré à votre demande : Vase.");
    expect(t).toContain("Je n'ai pas reconnu la référence XYZ-9 : je vérifie avec votre commercial.");
    expect(t).toContain("Souhaitez-vous que je la valide ?");
    expect(t).not.toContain("Léa de chez");
  });
});
