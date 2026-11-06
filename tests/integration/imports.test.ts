import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { withUser } from "@/lib/database/client";
import { createImport, processImport } from "@/features/imports/service";
import { suggestMapping } from "@/features/imports/definitions";
import { resetTestDb, ids } from "./db";

let I: Awaited<ReturnType<typeof ids>>;
beforeAll(async () => {
  await resetTestDb();
  I = await ids();
});

async function runImport(entity: Parameters<typeof createImport>[3], filename: string, data: Buffer, headers: string[]) {
  return withUser(I.chloe, async (db) => {
    const { importId, alreadyImported } = await createImport(db, I.orgB, I.chloe, entity, filename, data);
    const counters = await processImport(db, I.orgB, I.chloe, importId, suggestMapping(entity, headers));
    return { importId, alreadyImported, counters };
  });
}

describe("Imports", () => {
  it("clients CSV : création puis réimport sans doublon", async () => {
    const csv = Buffer.from("Code client;Raison sociale;Ville;Franco\nIMP001;Nouvelle Épicerie;Lyon;1 200,00\nIMP002;Cave Nouvelle;Nantes;\n;Sans code;Paris;\n");
    const first = await runImport("customers", "clients.csv", csv, ["Code client", "Raison sociale", "Ville", "Franco"]);
    expect(first.counters).toEqual({ ok: 2, dup: 0, err: 1 });
    const second = await runImport("customers", "clients.csv", csv, ["Code client", "Raison sociale", "Ville", "Franco"]);
    expect(second.alreadyImported).toBe(true);
    const n = await withUser(I.chloe, async (db) => (await db.query<{ n: number; franco: string }>(`select count(*)::int n, max(franco_amount) franco from customers where external_code like 'IMP%'`)).rows[0]!);
    expect(n.n).toBe(2);
    expect(n.franco).toBe("1200.00");
  });

  it("factures XLSX : lignes regroupées, totaux décimaux, réimport ignoré", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Factures");
    ws.addRow(["Numéro facture", "Code client", "Date", "Désignation", "Quantité", "Prix unitaire HT", "TVA"]);
    ws.addRow(["IMP-F1", "IMP001", "05/11/2026", "Article A", 3, 19.99, 20]);
    ws.addRow(["IMP-F1", "IMP001", "05/11/2026", "Article B", 7, 1.115, 5.5]);
    ws.addRow(["IMP-F2", "INCONNU", "05/11/2026", "Article C", 1, 10, 20]);
    const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const headers = ["Numéro facture", "Code client", "Date", "Désignation", "Quantité", "Prix unitaire HT", "TVA"];
    const first = await runImport("invoices", "factures.xlsx", buf, headers);
    expect(first.counters).toEqual({ ok: 2, dup: 0, err: 1 });
    const inv = await withUser(I.chloe, async (db) => (await db.query<{ total_ht: string; total_vat: string; total_ttc: string }>(`select total_ht, total_vat, total_ttc from invoices where invoice_number = 'IMP-F1'`)).rows[0]!);
    expect(inv).toEqual({ total_ht: "67.78", total_vat: "12.42", total_ttc: "80.20" }); // 59.97 + 7.81 ; TVA 11.99 + 0.43
    const again = await runImport("invoices", "factures.xlsx", buf, headers);
    expect(again.counters.dup).toBe(2);
    const count = await withUser(I.chloe, async (db) => (await db.query<{ n: number }>(`select count(*)::int n from invoices where invoice_number = 'IMP-F1'`)).rows[0]!.n);
    expect(count).toBe(1);
  });

  it("un import est invisible pour une autre organisation", async () => {
    const n = await withUser(I.bruno, async (db) => (await db.query<{ n: number }>(`select count(*)::int n from imports`)).rows[0]!.n);
    expect(n).toBe(0);
  });
});
