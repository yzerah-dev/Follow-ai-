import { createHash } from "node:crypto";
/**
 * Composition graphique contrôlée (pdf-lib, polices standard) :
 * aucune donnée n'est inventée, les visuels produits sont les fichiers sources fournis.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";

export type Brand = { companyName: string; primaryColor: string; secondaryColor: string; accentColor: string; footerText: string; isDemo: boolean };

export const A4 = { w: 595.28, h: 841.89 };

export function hexToRgb(hex: string) {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export type Ctx = { doc: PDFDocument; font: PDFFont; bold: PDFFont; brand: Brand };

export async function createDoc(brand: Brand, title: string): Promise<Ctx> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator("LÉA.AI — Studio créatif");
  doc.setProducer("LÉA.AI");
  doc.setCreationDate(new Date());
  return { doc, font: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), brand };
}

/** Rend le texte compatible WinAnsi (polices standard) sans perdre les accents français. */
export function winAnsi(font: PDFFont, s: string): string {
  const normalized = s.replace(/[   ]/g, " ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...");
  let out = "";
  for (const ch of normalized) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

export function text(page: PDFPage, c: Ctx, s: string, x: number, y: number, size = 10, opts: { bold?: boolean; color?: ReturnType<typeof rgb>; maxWidth?: number } = {}) {
  const f = opts.bold ? c.bold : c.font;
  let str = winAnsi(f, s);
  if (opts.maxWidth) while (str.length > 1 && f.widthOfTextAtSize(str, size) > opts.maxWidth) str = `${str.slice(0, -2)}…`.replace("…", ".");
  page.drawText(str, { x, y, size, font: f, color: opts.color ?? rgb(0.09, 0.1, 0.13) });
}

export function textRight(page: PDFPage, c: Ctx, s: string, xRight: number, y: number, size = 10, bold = false) {
  const f = bold ? c.bold : c.font;
  const str = winAnsi(f, s);
  page.drawText(str, { x: xRight - f.widthOfTextAtSize(str, size), y, size, font: f, color: rgb(0.09, 0.1, 0.13) });
}

export function wrap(c: Ctx, s: string, size: number, maxWidth: number, bold = false): string[] {
  const f = bold ? c.bold : c.font;
  const lines: string[] = [];
  for (const para of winAnsi(f, s).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(tryLine, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = tryLine;
    }
    lines.push(line);
  }
  return lines;
}

export function header(page: PDFPage, c: Ctx, title: string, subtitle: string) {
  page.drawRectangle({ x: 0, y: A4.h - 90, width: A4.w, height: 90, color: hexToRgb(c.brand.primaryColor) });
  text(page, c, c.brand.companyName, 40, A4.h - 42, 18, { bold: true, color: rgb(1, 1, 1) });
  text(page, c, title, 40, A4.h - 64, 11, { color: rgb(1, 1, 1) });
  const sub = winAnsi(c.font, subtitle);
  page.drawText(sub, { x: A4.w - 40 - c.font.widthOfTextAtSize(sub, 10), y: A4.h - 42, size: 10, font: c.font, color: rgb(1, 1, 1) });
  if (c.brand.isDemo) {
    page.drawRectangle({ x: A4.w - 210, y: A4.h - 76, width: 170, height: 18, color: rgb(1, 0.93, 0.8) });
    text(page, c, "DOCUMENT DE DÉMONSTRATION", A4.w - 202, A4.h - 70, 8, { bold: true, color: rgb(0.6, 0.3, 0) });
  }
}

export function footer(page: PDFPage, c: Ctx, pageNo: number, total: number) {
  page.drawLine({ start: { x: 40, y: 50 }, end: { x: A4.w - 40, y: 50 }, thickness: 0.5, color: rgb(0.85, 0.86, 0.9) });
  for (const [i, l] of wrap(c, c.brand.footerText, 7.5, A4.w - 160).slice(0, 2).entries()) text(page, c, l, 40, 38 - i * 10, 7.5, { color: rgb(0.4, 0.42, 0.47) });
  textRight(page, c, `${pageNo} / ${total}`, A4.w - 40, 38, 8);
}

// Une image identique (même contenu) n'est embarquée qu'une fois par document : catalogues de centaines de produits.
const embedCache = new WeakMap<PDFDocument, Map<string, PDFImage | null>>();

export async function embedImage(doc: PDFDocument, data: Buffer | null, mime: string | null): Promise<PDFImage | null> {
  if (!data) return null;
  const key = createHash("sha1").update(data).digest("hex");
  const cache = embedCache.get(doc) ?? embedCache.set(doc, new Map()).get(doc)!;
  if (cache.has(key)) return cache.get(key)!;
  let img: PDFImage | null = null;
  try {
    if (mime === "image/png" || data.subarray(0, 4).toString("hex") === "89504e47") img = await doc.embedPng(data);
    else if (mime === "image/jpeg" || data.subarray(0, 2).toString("hex") === "ffd8") img = await doc.embedJpg(data);
  } catch {
    img = null;
  }
  cache.set(key, img);
  return img;
}

export function imageBox(page: PDFPage, c: Ctx, img: PDFImage | null, x: number, y: number, w: number, h: number, isDemo: boolean) {
  page.drawRectangle({ x, y, width: w, height: h, color: rgb(0.97, 0.97, 0.98), borderColor: rgb(0.9, 0.9, 0.92), borderWidth: 0.5 });
  if (img) {
    const scale = Math.min(w / img.width, h / img.height);
    const iw = img.width * scale;
    const ih = img.height * scale;
    page.drawImage(img, { x: x + (w - iw) / 2, y: y + (h - ih) / 2, width: iw, height: ih });
    if (isDemo) text(page, c, "Visuel de démo", x + 4, y + 4, 6, { color: rgb(0.45, 0.45, 0.5) });
  } else {
    const label = w < 100 ? "Sans photo" : "Photo non disponible";
    const size = w < 100 ? 6 : 7.5;
    const lw = c.font.widthOfTextAtSize(label, size);
    text(page, c, label, x + Math.max(2, (w - lw) / 2), y + h / 2 - size / 2, size, { color: rgb(0.55, 0.56, 0.6) });
  }
}
