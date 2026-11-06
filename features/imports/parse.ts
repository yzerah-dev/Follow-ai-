import Papa from "papaparse";
import ExcelJS from "exceljs";
import { dec } from "@/lib/money";
import { ENTITIES, type EntityKind, type FieldDef } from "./definitions";

export const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 100_000;

export type ParsedFile = { headers: string[]; rows: Record<string, string>[] };

/** Lecture CSV (séparateur auto ; ou ,) ou XLSX (première feuille). XLS non pris en charge (voir docs). */
export async function parseFile(filename: string, data: Buffer): Promise<ParsedFile> {
  if (data.length > MAX_IMPORT_BYTES) throw new Error("Fichier trop volumineux (15 Mo maximum).");
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const text = data.toString("utf8").replace(/^﻿/, "");
    const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
    if (res.errors.length && !res.data.length) throw new Error(`CSV illisible : ${res.errors[0]?.message}`);
    const headers = (res.meta.fields ?? []).filter(Boolean);
    return { headers, rows: res.data.slice(0, MAX_IMPORT_ROWS).map((r) => Object.fromEntries(headers.map((h) => [h, String(r[h] ?? "").trim()]))) };
  }
  if (lower.endsWith(".xlsx")) {
    if (data.subarray(0, 2).toString("hex") !== "504b") throw new Error("Le fichier n'est pas un classeur XLSX valide.");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error("Classeur vide.");
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => (headers[col - 1] = cellText(cell.value).trim()));
    const rows: Record<string, string>[] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1 || rows.length >= MAX_IMPORT_ROWS) return;
      const r: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (h) r[h] = cellText(row.getCell(i + 1).value).trim();
      });
      if (Object.values(r).some(Boolean)) rows.push(r);
    });
    return { headers: headers.filter(Boolean), rows };
  }
  if (lower.endsWith(".xls")) throw new Error("Le format XLS (Excel 97-2003) n'est pas pris en charge : enregistrez le fichier en XLSX ou CSV.");
  throw new Error("Format non pris en charge (CSV ou XLSX).");
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    return "";
  }
  return String(v);
}

export function parseDecimal(raw: string): string | null {
  const s = raw.replace(/[\s  €%]/g, "");
  if (!s) return null;
  // "1.234,56" ou "1234,56" (FR) vs "1,234.56" ou "1234.56" (EN)
  let n = s;
  if (s.includes(",") && s.includes(".")) n = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) n = s.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(n)) return "INVALID";
  return dec(n).toString();
}

export function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valid(`${m[1]}-${m[2]}-${m[3]}`);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return valid(`${y}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`);
  }
  return "INVALID";
}
const valid = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? "INVALID" : iso;
};

export function validEan(ean: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(ean)) return false;
  const digits = ean.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((a, d, i) => a + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const ENUM_ALIASES: Record<string, string> = {
  facture: "invoice", invoice: "invoice", fa: "invoice", avoir: "credit_note", "credit note": "credit_note", credit_note: "credit_note", av: "credit_note",
  emise: "issued", émise: "issued", issued: "issued", validee: "issued", annulee: "cancelled", annulée: "cancelled", cancelled: "cancelled",
  payee: "paid", payée: "paid", reglee: "paid", réglée: "paid", paid: "paid", "non reglee": "unpaid", "non réglée": "unpaid", impayee: "unpaid", unpaid: "unpaid",
  partiel: "partially_paid", "en retard": "overdue", overdue: "overdue", inconnu: "unknown", m: "M.", "m.": "M.", monsieur: "M.", mme: "Mme", madame: "Mme",
};

export type RowResult = { ok: true; value: Record<string, string | number | boolean | null> } | { ok: false; errors: string[] };

export function validateRow(entity: EntityKind, raw: Record<string, string>, mapping: Record<string, string | null>): RowResult {
  const fields = ENTITIES[entity];
  const byField: Record<string, string> = {};
  for (const [header, key] of Object.entries(mapping)) if (key) byField[key] = raw[header] ?? "";
  const errors: string[] = [];
  const value: Record<string, string | number | boolean | null> = {};
  for (const f of fields) {
    const v = (byField[f.key] ?? "").trim();
    if (!v) {
      if (f.required) errors.push(`${f.label} : obligatoire`);
      value[f.key] = null;
      continue;
    }
    const parsed = convert(f, v);
    if (parsed.error) errors.push(`${f.label} : ${parsed.error}`);
    else value[f.key] = parsed.value ?? null;
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

function convert(f: FieldDef, v: string): { value?: string | number | boolean | null; error?: string } {
  switch (f.type) {
    case "string":
      return { value: v.slice(0, 500) };
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { value: v.toLowerCase() } : { error: "email invalide" };
    case "decimal": {
      const d = parseDecimal(v);
      return d === "INVALID" ? { error: `nombre invalide (« ${v} »)` } : { value: d };
    }
    case "integer": {
      const d = parseDecimal(v);
      return d === "INVALID" || (d !== null && !Number.isInteger(Number(d))) ? { error: "entier attendu" } : { value: d === null ? null : Number(d) };
    }
    case "date": {
      const d = parseDate(v);
      return d === "INVALID" ? { error: `date invalide (« ${v} »)` } : { value: d };
    }
    case "boolean":
      return { value: /^(1|oui|yes|true|vrai|x)$/i.test(v) };
    case "ean":
      return validEan(v.replace(/\s/g, "")) ? { value: v.replace(/\s/g, "") } : { error: "EAN invalide (clé de contrôle)" };
    case "enum": {
      const a = ENUM_ALIASES[v.toLowerCase()] ?? v;
      return f.values?.includes(a) ? { value: a } : { error: `valeur non reconnue (« ${v} »)` };
    }
  }
}
