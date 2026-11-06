/**
 * Studio créatif — générateurs (composition contrôlée, sans IA générative).
 * Séparation : données (validées) → composition (pdf-lib / ExcelJS) → validation → stockage.
 */
import ExcelJS from "exceljs";
import { rgb } from "pdf-lib";
import { A4, createDoc, embedImage, footer, header, hexToRgb, imageBox, text, textRight, wrap, type Brand } from "@/lib/documents/pdf";
import { formatMoney, formatQty, dec, lineTotal, computeTotals } from "@/lib/money";
import { formatDate } from "@/lib/utils";

export type DocImage = { data: Buffer; mime: string; isDemo: boolean; generative?: boolean } | null;

export type OfferDocLine = {
  reference: string;
  ean: string | null;
  description: string;
  quantity: string;
  unitPriceHt: string;
  discountPct: string;
  vatRate: string;
  lineTotalHt: string;
  unitsPerCase: number | null;
  image: DocImage;
};

export type OfferDocData = {
  number: string;
  date: string;
  validUntil: string | null;
  customer: { name: string; code: string | null; address: string | null; city: string | null };
  contactName: string | null;
  sellerName: string | null;
  lines: OfferDocLine[];
  totals: { subtotalHt: string; discountTotalHt: string; totalHt: string; totalVat: string; totalTtc: string };
  conditions: string | null;
  arguments: string[];
};

export type ProductDocData = {
  reference: string;
  ean: string | null;
  brand: string | null;
  name: string;
  description: string | null;
  category: string | null;
  unitsPerCase: number | null;
  pcb: number | null;
  priceHt: string | null; // prix de vente affiché (jamais le prix d'achat)
  vatRate: string;
  availability: string;
  marketingPoints: string[];
  dimensions: string | null;
  weightKg: string | null;
  image: DocImage;
};

const AVAILABILITY_LABEL: Record<string, string> = {
  in_stock: "En stock",
  low_stock: "Stock limité",
  out_of_stock: "Rupture",
  on_order: "En réapprovisionnement",
  unknown: "Disponibilité à confirmer",
};

export async function generateOfferPdf(data: OfferDocData, brand: Brand, opts: { showImages: boolean; showEan: boolean }): Promise<Buffer> {
  const c = await createDoc(brand, `Offre ${data.number}`);
  const rowH = opts.showImages ? 46 : 22;
  const pages: ReturnType<typeof c.doc.addPage>[] = [];
  let page = c.doc.addPage([A4.w, A4.h]);
  pages.push(page);
  header(page, c, `Proposition commerciale ${data.number}`, `Émise le ${formatDate(data.date)}`);
  let y = A4.h - 120;
  text(page, c, "Client", 40, y, 8, { color: rgb(0.45, 0.47, 0.52) });
  text(page, c, data.customer.name, 40, y - 14, 12, { bold: true });
  if (data.customer.address) text(page, c, data.customer.address, 40, y - 28, 9);
  if (data.customer.city) text(page, c, data.customer.city, 40, y - 40, 9);
  if (data.contactName) text(page, c, `À l'attention de ${data.contactName}`, 40, y - 52, 9);
  text(page, c, "Validité", 380, y, 8, { color: rgb(0.45, 0.47, 0.52) });
  text(page, c, data.validUntil ? `Jusqu'au ${formatDate(data.validUntil)}` : "Non précisée", 380, y - 14, 11, { bold: true });
  if (data.sellerName) text(page, c, `Votre interlocuteur : ${data.sellerName}`, 380, y - 28, 9);
  if (data.customer.code) text(page, c, `Code client : ${data.customer.code}`, 380, y - 40, 9);
  y -= 80;

  if (data.arguments.length) {
    for (const l of wrap(c, data.arguments.join(" — "), 9, A4.w - 80).slice(0, 3)) {
      text(page, c, l, 40, y, 9, { color: rgb(0.25, 0.27, 0.32) });
      y -= 12;
    }
    y -= 8;
  }

  const cols = { img: 40, ref: opts.showImages ? 92 : 40, desc: opts.showImages ? 160 : 110, qty: 380, pu: 440, rem: 488, total: A4.w - 40 };
  const drawHead = () => {
    page.drawRectangle({ x: 36, y: y - 6, width: A4.w - 72, height: 20, color: hexToRgb(brand.secondaryColor) });
    const white = rgb(1, 1, 1);
    text(page, c, "Référence", cols.ref, y, 8, { bold: true, color: white });
    text(page, c, "Désignation", cols.desc, y, 8, { bold: true, color: white });
    text(page, c, "Qté", cols.qty, y, 8, { bold: true, color: white });
    text(page, c, "PU HT", cols.pu, y, 8, { bold: true, color: white });
    text(page, c, "Rem.", cols.rem, y, 8, { bold: true, color: white });
    const t = "Total HT";
    page.drawText(t, { x: cols.total - c.bold.widthOfTextAtSize(t, 8), y, size: 8, font: c.bold, color: white });
    y -= 22;
  };
  drawHead();
  for (const [i, l] of data.lines.entries()) {
    if (y - rowH < 170) {
      page = c.doc.addPage([A4.w, A4.h]);
      pages.push(page);
      header(page, c, `Proposition commerciale ${data.number} (suite)`, `Émise le ${formatDate(data.date)}`);
      y = A4.h - 120;
      drawHead();
    }
    if (i % 2 === 0) page.drawRectangle({ x: 36, y: y - rowH + 14, width: A4.w - 72, height: rowH, color: rgb(0.975, 0.98, 0.99) });
    if (opts.showImages) imageBox(page, c, await embedImage(c.doc, l.image?.data ?? null, l.image?.mime ?? null), cols.img, y - rowH + 18, 44, 40, !!l.image?.isDemo);
    const mid = opts.showImages ? y - 12 : y;
    text(page, c, l.reference, cols.ref, mid, 8.5, { bold: true });
    if (opts.showEan && l.ean) text(page, c, `EAN ${l.ean}`, cols.ref, mid - 10, 6.5, { color: rgb(0.45, 0.47, 0.52) });
    text(page, c, l.description, cols.desc, mid, 8.5, { maxWidth: cols.qty - cols.desc - 8 });
    if (l.unitsPerCase && l.unitsPerCase > 1) text(page, c, `Colis de ${l.unitsPerCase}`, cols.desc, mid - 10, 6.5, { color: rgb(0.45, 0.47, 0.52) });
    text(page, c, formatQty(l.quantity), cols.qty, mid, 8.5);
    text(page, c, formatMoney(dec(l.unitPriceHt).toDecimalPlaces(2)), cols.pu, mid, 8.5);
    text(page, c, dec(l.discountPct).gt(0) ? `${dec(l.discountPct).toFixed(2)} %` : "—", cols.rem, mid, 8.5);
    textRight(page, c, formatMoney(l.lineTotalHt), cols.total, mid, 8.5, true);
    y -= rowH;
  }

  y -= 10;
  if (y < 170) {
    page = c.doc.addPage([A4.w, A4.h]);
    pages.push(page);
    header(page, c, `Proposition commerciale ${data.number} (suite)`, "");
    y = A4.h - 130;
  }
  const box = (label: string, value: string, bold = false) => {
    text(page, c, label, 360, y, 9.5, { bold });
    textRight(page, c, value, A4.w - 40, y, 9.5, bold);
    y -= 15;
  };
  box("Sous-total HT", formatMoney(data.totals.subtotalHt));
  if (dec(data.totals.discountTotalHt).gt(0)) box("Remises", `- ${formatMoney(data.totals.discountTotalHt)}`);
  box("Total HT", formatMoney(data.totals.totalHt), true);
  box("TVA", formatMoney(data.totals.totalVat));
  y -= 6;
  page.drawRectangle({ x: 352, y: y - 6, width: A4.w - 388, height: 22, color: hexToRgb(brand.primaryColor) });
  text(page, c, "Total TTC", 360, y, 11, { bold: true, color: rgb(1, 1, 1) });
  const ttc = formatMoney(data.totals.totalTtc);
  page.drawText(ttc, { x: A4.w - 44 - c.bold.widthOfTextAtSize(ttc, 11), y, size: 11, font: c.bold, color: rgb(1, 1, 1) });
  y -= 36;
  if (data.conditions) for (const l of wrap(c, data.conditions, 8, 300).slice(0, 5)) {
    text(page, c, l, 40, y, 8, { color: rgb(0.35, 0.37, 0.42) });
    y -= 11;
  }
  pages.forEach((p, i) => footer(p, c, i + 1, pages.length));
  return Buffer.from(await c.doc.save());
}

export async function generateOfferExcel(data: OfferDocData, brand: Brand, opts: { showImages: boolean }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Follow.AI — Studio créatif";
  wb.created = new Date();
  const ws = wb.addWorksheet(`Offre ${data.number}`.slice(0, 31), { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 } });
  const argb = `FF${brand.primaryColor.replace("#", "").toUpperCase()}`;
  ws.columns = [
    { key: "img", width: opts.showImages ? 14 : 2 },
    { key: "ref", width: 16 },
    { key: "ean", width: 16 },
    { key: "desc", width: 42 },
    { key: "upc", width: 10 },
    { key: "qty", width: 10 },
    { key: "pu", width: 12 },
    { key: "rem", width: 9 },
    { key: "vat", width: 8 },
    { key: "total", width: 14 },
  ];
  ws.mergeCells("A1:J1");
  ws.getCell("A1").value = `${brand.companyName} — Proposition commerciale ${data.number}${brand.isDemo ? " (DÉMONSTRATION)" : ""}`;
  ws.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  ws.getRow(1).height = 30;
  ws.getCell("A3").value = "Client";
  ws.getCell("B3").value = data.customer.name;
  ws.getCell("A4").value = "Date";
  ws.getCell("B4").value = formatDate(data.date);
  ws.getCell("A5").value = "Validité";
  ws.getCell("B5").value = data.validUntil ? formatDate(data.validUntil) : "Non précisée";
  ["A3", "A4", "A5"].forEach((a) => (ws.getCell(a).font = { bold: true }));
  const head = ws.getRow(7);
  head.values = ["Visuel", "Référence", "EAN", "Désignation", "Colisage", "Quantité", "PU HT (€)", "Remise %", "TVA %", "Total HT (€)"];
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${brand.secondaryColor.replace("#", "").toUpperCase()}` } };
    cell.alignment = { vertical: "middle" };
  });
  let r = 8;
  for (const l of data.lines) {
    const row = ws.getRow(r);
    // Valeurs numériques issues du calcul décimal (pas de recalcul flottant dans Excel)
    row.values = ["", l.reference, l.ean ?? "", l.description, l.unitsPerCase ?? "", Number(l.quantity), Number(dec(l.unitPriceHt).toFixed(4)), Number(l.discountPct), Number(l.vatRate), Number(l.lineTotalHt)];
    row.getCell(7).numFmt = "#,##0.00##";
    row.getCell(10).numFmt = "#,##0.00";
    row.alignment = { vertical: "middle" };
    if (opts.showImages) {
      row.height = 60;
      if (l.image) {
        const id = wb.addImage({ base64: `data:${l.image.mime};base64,${l.image.data.toString("base64")}`, extension: l.image.mime === "image/jpeg" ? "jpeg" : "png" });
        ws.addImage(id, { tl: { col: 0.1, row: r - 1 + 0.1 }, ext: { width: 70, height: 70 } });
      } else row.getCell(1).value = "Photo non disponible";
    }
    r++;
  }
  r++;
  const tot = (label: string, v: string, bold = false) => {
    ws.getCell(`I${r}`).value = label;
    ws.getCell(`J${r}`).value = Number(v);
    ws.getCell(`J${r}`).numFmt = "#,##0.00 €";
    ws.getCell(`I${r}`).font = { bold };
    ws.getCell(`J${r}`).font = { bold };
    r++;
  };
  tot("Total HT", data.totals.totalHt, true);
  tot("TVA", data.totals.totalVat);
  tot("Total TTC", data.totals.totalTtc, true);
  r++;
  if (data.conditions) ws.getCell(`A${r}`).value = data.conditions;
  ws.getCell(`A${r + 1}`).value = brand.footerText;
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

export async function generateProductSheet(p: ProductDocData, brand: Brand): Promise<Buffer> {
  const c = await createDoc(brand, `Fiche produit ${p.reference}`);
  const page = c.doc.addPage([A4.w, A4.h]);
  header(page, c, "Fiche produit", p.reference);
  imageBox(page, c, await embedImage(c.doc, p.image?.data ?? null, p.image?.mime ?? null), 40, A4.h - 400, 250, 250, !!p.image?.isDemo);
  let y = A4.h - 160;
  if (p.brand) text(page, c, p.brand.toUpperCase(), 315, y, 9, { bold: true, color: hexToRgb(brand.primaryColor) });
  y -= 22;
  for (const l of wrap(c, p.name, 18, 240, true)) {
    text(page, c, l, 315, y, 18, { bold: true });
    y -= 22;
  }
  y -= 6;
  const kv = (k: string, v: string | null) => {
    if (!v) return;
    text(page, c, k, 315, y, 8.5, { color: rgb(0.45, 0.47, 0.52) });
    text(page, c, v, 420, y, 9.5, { bold: true });
    y -= 16;
  };
  kv("Référence", p.reference);
  kv("EAN", p.ean);
  kv("Catégorie", p.category);
  kv("Colisage", p.unitsPerCase ? `${p.unitsPerCase} unités` : null);
  kv("PCB", p.pcb ? String(p.pcb) : null);
  kv("Dimensions", p.dimensions);
  kv("Poids", p.weightKg ? `${dec(p.weightKg).toFixed(2)} kg` : null);
  kv("Disponibilité", AVAILABILITY_LABEL[p.availability] ?? "À confirmer");
  kv("Prix HT", p.priceHt ? formatMoney(p.priceHt) : "Sur demande");
  y = A4.h - 440;
  if (p.description) {
    text(page, c, "Description", 40, y, 11, { bold: true });
    y -= 16;
    for (const l of wrap(c, p.description, 10, A4.w - 80).slice(0, 12)) {
      text(page, c, l, 40, y, 10);
      y -= 14;
    }
  }
  if (p.marketingPoints.length) {
    y -= 10;
    text(page, c, "Points forts", 40, y, 11, { bold: true });
    y -= 16;
    for (const m of p.marketingPoints.slice(0, 6)) {
      page.drawCircle({ x: 46, y: y + 3, size: 2.2, color: hexToRgb(brand.primaryColor) });
      text(page, c, m, 56, y, 10);
      y -= 15;
    }
  }
  footer(page, c, 1, 1);
  return Buffer.from(await c.doc.save());
}

export async function generateCatalog(title: string, products: ProductDocData[], brand: Brand, columns = 2): Promise<Buffer> {
  const c = await createDoc(brand, title);
  const pages: ReturnType<typeof c.doc.addPage>[] = [];
  const cols = Math.max(1, Math.min(3, columns));
  const gap = 16;
  const cellW = (A4.w - 80 - gap * (cols - 1)) / cols;
  const cellH = 220;
  let page = c.doc.addPage([A4.w, A4.h]);
  pages.push(page);
  header(page, c, title, `${products.length} référence(s)`);
  let y = A4.h - 110 - cellH;
  let col = 0;
  for (const p of products) {
    if (y < 60) {
      page = c.doc.addPage([A4.w, A4.h]);
      pages.push(page);
      header(page, c, title, "");
      y = A4.h - 110 - cellH;
    }
    const x = 40 + col * (cellW + gap);
    page.drawRectangle({ x, y, width: cellW, height: cellH, borderColor: rgb(0.9, 0.9, 0.93), borderWidth: 0.7 });
    imageBox(page, c, await embedImage(c.doc, p.image?.data ?? null, p.image?.mime ?? null), x + 10, y + 80, cellW - 20, cellH - 92, !!p.image?.isDemo);
    text(page, c, p.name, x + 10, y + 62, 10, { bold: true, maxWidth: cellW - 20 });
    text(page, c, `Réf. ${p.reference}${p.ean ? `  ·  EAN ${p.ean}` : ""}`, x + 10, y + 48, 7.5, { color: rgb(0.45, 0.47, 0.52), maxWidth: cellW - 20 });
    if (p.unitsPerCase) text(page, c, `Colis de ${p.unitsPerCase}`, x + 10, y + 36, 7.5, { color: rgb(0.45, 0.47, 0.52) });
    text(page, c, p.priceHt ? `${formatMoney(p.priceHt)} HT` : "Prix sur demande", x + 10, y + 14, 12, { bold: true, color: hexToRgb(brand.primaryColor) });
    col++;
    if (col >= cols) {
      col = 0;
      y -= cellH + gap;
    }
  }
  pages.forEach((p, i) => footer(p, c, i + 1, pages.length));
  return Buffer.from(await c.doc.save());
}

/** Affiche promotionnelle en composition contrôlée (aucune image générative). */
export async function generateRetailPoster(headline: string, products: ProductDocData[], brand: Brand): Promise<Buffer> {
  const c = await createDoc(brand, headline);
  const page = c.doc.addPage([A4.w, A4.h]);
  page.drawRectangle({ x: 0, y: 0, width: A4.w, height: A4.h, color: hexToRgb(brand.primaryColor) });
  text(page, c, brand.companyName.toUpperCase(), 40, A4.h - 60, 12, { bold: true, color: rgb(1, 1, 1) });
  let y = A4.h - 130;
  for (const l of wrap(c, headline, 38, A4.w - 80, true).slice(0, 3)) {
    text(page, c, l, 40, y, 38, { bold: true, color: rgb(1, 1, 1) });
    y -= 44;
  }
  const items = products.slice(0, 4);
  const w = (A4.w - 80 - 16) / 2;
  for (const [i, p] of items.entries()) {
    const x = 40 + (i % 2) * (w + 16);
    const yy = 300 - Math.floor(i / 2) * 230 + 40;
    page.drawRectangle({ x, y: yy - 120, width: w, height: 210, color: rgb(1, 1, 1) });
    imageBox(page, c, await embedImage(c.doc, p.image?.data ?? null, p.image?.mime ?? null), x + 10, yy - 40, w - 20, 120, !!p.image?.isDemo);
    text(page, c, p.name, x + 10, yy - 62, 11, { bold: true, maxWidth: w - 20 });
    text(page, c, p.priceHt ? `${formatMoney(p.priceHt)} HT` : "Prix sur demande", x + 10, yy - 90, 16, { bold: true, color: hexToRgb(brand.primaryColor) });
    text(page, c, `Réf. ${p.reference}`, x + 10, yy - 108, 8, { color: rgb(0.45, 0.47, 0.52) });
  }
  if (brand.isDemo) text(page, c, "DOCUMENT DE DÉMONSTRATION — données fictives", 40, 30, 8, { bold: true, color: rgb(1, 1, 1) });
  return Buffer.from(await c.doc.save());
}

// ------------------------------------------------------------------ Validation

export type ValidationReport = { ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] };

/** Vérifie que les données du document correspondent exactement à l'offre et au référentiel produit. */
export function validateOfferDocument(
  doc: OfferDocData,
  source: { totals: OfferDocData["totals"]; lines: { reference: string; quantity: string; unitPriceHt: string; discountPct: string; lineTotalHt: string; vatRate: string }[] },
  master: Map<string, { ean: string | null; name: string }>,
  forbiddenValues: string[] = [],
): ValidationReport {
  const checks: ValidationReport["checks"] = [];
  checks.push({ name: "Nombre de lignes identique à l'offre", ok: doc.lines.length === source.lines.length });
  let linesOk = true;
  for (const [i, l] of doc.lines.entries()) {
    const s = source.lines[i];
    if (!s || s.reference !== l.reference || !dec(s.quantity).eq(dec(l.quantity)) || !dec(s.unitPriceHt).eq(dec(l.unitPriceHt)) || !dec(s.lineTotalHt).eq(dec(l.lineTotalHt))) linesOk = false;
    if (!lineTotal(l.quantity, l.unitPriceHt, l.discountPct).eq(dec(l.lineTotalHt))) linesOk = false;
  }
  checks.push({ name: "Quantités, prix et totaux de ligne conformes", ok: linesOk });
  const t = computeTotals(doc.lines.map((l) => ({ totalHt: l.lineTotalHt, vatRate: l.vatRate })));
  checks.push({
    name: "Totaux HT / TVA / TTC recalculés",
    ok: t.totalHt.eq(dec(doc.totals.totalHt)) && t.totalVat.eq(dec(doc.totals.totalVat)) && t.totalTtc.eq(dec(doc.totals.totalTtc)) && dec(source.totals.totalTtc).eq(dec(doc.totals.totalTtc)),
  });
  let fidelity = true;
  for (const l of doc.lines) {
    const m = master.get(l.reference);
    if (!m || (m.ean ?? null) !== (l.ean ?? null)) fidelity = false;
  }
  checks.push({ name: "Références et EAN fidèles au référentiel produit", ok: fidelity });
  checks.push({ name: "Aucune image générative dans un document de fidélité", ok: doc.lines.every((l) => !l.image?.generative) });
  const serialized = JSON.stringify(doc);
  const leak = forbiddenValues.filter((v) => v && serialized.includes(`"${v}"`));
  checks.push({ name: "Aucun prix d'achat ni marge interne", ok: leak.length === 0, detail: leak.length ? `${leak.length} valeur(s) interne(s) détectée(s)` : undefined });
  return { ok: checks.every((c) => c.ok), checks };
}

export function validateBrandConsistency(brand: Brand, template: { primaryColor: string }): ValidationReport {
  const checks = [
    { name: "Couleur principale conforme à la charte", ok: brand.primaryColor.toLowerCase() === template.primaryColor.toLowerCase() },
    { name: "Raison sociale présente", ok: brand.companyName.trim().length > 0 },
  ];
  return { ok: checks.every((c) => c.ok), checks };
}
