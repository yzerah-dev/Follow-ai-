/**
 * Excel renvoyé par le client avec ses quantités (règle JONAS : « renvoyez-moi l'Excel avec vos quantités adaptées »).
 *
 * Contenu NON FIABLE : on ne lit que deux informations, la référence (ou l'EAN) et la quantité.
 * Les prix, remises, totaux ou textes du fichier sont ignorés : les prix viennent toujours du catalogue.
 * Le texte du fichier n'est jamais transmis à l'IA.
 */
import ExcelJS from "exceljs";

export const MAX_CLIENT_EXCEL_BYTES = 3 * 1024 * 1024;
const MAX_ROWS = 1000;

export type ClientExcelRow = { row: number; reference: string | null; ean: string | null; quantity: string | null };
export type ClientExcel = { rows: ClientExcelRow[]; invalid: { row: number; reference: string; value: string }[] };

export class ClientExcelUnreadable extends Error {}

function text(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined) return text(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    return "";
  }
  return String(v).trim();
}

/** Quantité saisie par le client : entier ≥ 0 (« 48 », « 48,0 », « 1 200 »). Vide → null (ligne retirée). */
export function parseQuantity(raw: string): { ok: true; qty: string | null } | { ok: false } {
  const s = raw.replace(/[\s  ]/g, "").replace(",", ".");
  if (!s) return { ok: true, qty: null };
  if (!/^\d+(\.0+)?$/.test(s)) return { ok: false };
  return { ok: true, qty: String(Number.parseInt(s, 10)) };
}

/** Repère l'en-tête (colonne référence + colonne quantité) dans les 30 premières lignes de chaque feuille. */
export async function parseClientOfferExcel(buffer: Buffer): Promise<ClientExcel> {
  if (buffer.length > MAX_CLIENT_EXCEL_BYTES) throw new ClientExcelUnreadable("Fichier trop volumineux.");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ClientExcelUnreadable("Fichier Excel illisible.");
  }
  for (const ws of wb.worksheets) {
    for (let h = 1; h <= Math.min(30, ws.rowCount); h++) {
      const headers = new Map<number, string>();
      ws.getRow(h).eachCell((cell, col) => headers.set(col, text(cell.value).toLowerCase()));
      const find = (re: RegExp, not?: RegExp) => [...headers.entries()].find(([, t]) => re.test(t) && !(not && not.test(t)))?.[0];
      const refCol = find(/^r[ée]f/);
      const eanCol = find(/\bean\b|gencod/);
      // Si le client a ajouté sa propre colonne (« Quantité commandée »), elle prime sur la quantité suggérée.
      const qtyCol = find(/quantit|qt[ée]|\bqty\b/, /sugg/) ?? find(/quantit|qt[ée]|\bqty\b/);
      if ((!refCol && !eanCol) || !qtyCol) continue;
      const rows: ClientExcelRow[] = [];
      const invalid: ClientExcel["invalid"] = [];
      for (let r = h + 1; r <= Math.min(ws.rowCount, h + MAX_ROWS); r++) {
        const row = ws.getRow(r);
        const reference = refCol ? text(row.getCell(refCol).value) || null : null;
        const eanRaw = eanCol ? text(row.getCell(eanCol).value).replace(/\D/g, "") : "";
        const ean = eanRaw.length >= 8 ? eanRaw : null;
        if (!reference && !ean) continue;
        const q = parseQuantity(text(row.getCell(qtyCol).value));
        if (!q.ok) invalid.push({ row: r, reference: reference ?? ean ?? "", value: text(row.getCell(qtyCol).value) });
        else rows.push({ row: r, reference, ean, quantity: q.qty });
      }
      if (rows.length || invalid.length) return { rows, invalid };
    }
  }
  throw new ClientExcelUnreadable("Colonnes « Référence » et « Quantité » introuvables.");
}
