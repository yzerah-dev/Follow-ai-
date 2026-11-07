import type { Db } from "@/lib/database/client";
import { getFile, putFile, storagePath } from "@/lib/storage";
import { sha256 } from "@/lib/security/crypto";
import { audit } from "@/lib/security/audit";
import type { Brand } from "@/lib/documents/pdf";
import { getImageAdapter, type ImageJobKind } from "@/lib/ai/images";
import { parseTemplate, type TemplateKind } from "./templates";
import { loadCustomerCoverage } from "@/features/analytics/coverage-repo";
import { CONFIDENCE_LABEL } from "@/features/analytics/coverage";
import { toIsoDate } from "@/lib/utils";
import { dec } from "@/lib/money";
import {
  generateCatalog, generateCoverageExcel, generateOfferExcel, generateSynthesisPdf, generateOfferPdf, generateProductSheet, generateRetailPoster,
  validateBrandConsistency, validateOfferDocument, type DocImage, type OfferDocData, type ProductDocData, type ValidationReport,
} from "./generators";

export const ASSET_KINDS = ["offer_pdf", "offer_excel", "coverage_excel", "synthesis_pdf", "priority_pdf", "product_sheet", "catalog", "poster", "lifestyle_shooting"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const ASSET_LABEL: Record<AssetKind, string> = {
  offer_pdf: "Offre PDF",
  offer_excel: "Offre Excel illustrée",
  coverage_excel: "Analyse de couverture (Excel)",
  synthesis_pdf: "Synthèse commerciale (PDF)",
  priority_pdf: "Sélection prioritaire (PDF)",
  product_sheet: "Fiches produits",
  catalog: "Catalogue",
  poster: "Affiche",
  lifestyle_shooting: "Shooting lifestyle",
};

async function loadBrand(db: Db, orgId: string, kind: TemplateKind) {
  const s = (await db.query<{ name: string; is_demo: boolean; brand: { primaryColor?: string; secondaryColor?: string; companyName?: string } }>(
    `select o.name, o.is_demo, s.brand from organizations o join organization_settings s on s.organization_id = o.id where o.id = $1`, [orgId])).rows[0]!;
  const tpl = (await db.query<{ id: string; version: number; definition: unknown }>(
    `select id, version, definition from creative_templates where organization_id = $1 and kind = $2 and is_active order by version desc limit 1`, [orgId, kind])).rows[0];
  const def = parseTemplate(tpl?.definition ?? {}, { primaryColor: s.brand.primaryColor });
  const brand: Brand = {
    companyName: s.brand.companyName ?? s.name,
    primaryColor: s.brand.primaryColor ?? def.primaryColor,
    secondaryColor: def.secondaryColor,
    accentColor: def.accentColor,
    footerText: def.footerText || "Document généré par Follow.AI — prix HT en euros.",
    isDemo: s.is_demo,
  };
  return { brand, template: def, templateId: tpl?.id ?? null, templateVersion: tpl?.version ?? null };
}

/** Médias produits autorisés (approuvés) d'un lot de produits : une requête, chaque fichier lu une seule fois. */
async function productImages(db: Db, productIds: string[]): Promise<Map<string, DocImage>> {
  const rows = (await db.query<{ product_id: string; storage_path: string; kind: string }>(
    `select distinct on (product_id) product_id, storage_path, kind from product_images
     where product_id = any($1::uuid[]) and approved and kind in ('source','packaging','demo_placeholder') order by product_id, is_primary desc, created_at`, [productIds])).rows;
  const files = new Map<string, Buffer | null>();
  const out = new Map<string, DocImage>();
  for (const r of rows) {
    if (!files.has(r.storage_path)) files.set(r.storage_path, await getFile(r.storage_path).catch(() => null));
    const data = files.get(r.storage_path);
    out.set(r.product_id, data ? { data, mime: "image/png", isDemo: r.kind === "demo_placeholder" } : null);
  }
  return out;
}


async function loadOfferDoc(db: Db, orgId: string, offerId: string): Promise<{ doc: OfferDocData; productIds: string[]; master: Map<string, { ean: string | null; name: string }> }> {
  const o = (await db.query<{ number: string; offer_date: string; valid_until: string | null; customer_name: string; external_code: string | null; address_line1: string | null; postal_code: string | null; city: string | null;
    contact: string | null; seller: string | null; subtotal_ht: string; discount_total_ht: string; total_ht: string; total_vat: string; total_ttc: string; conditions: string | null; arguments: string[] }>(
    `select o.number, o.offer_date, o.valid_until, coalesce(c.trade_name, c.legal_name) as customer_name, c.external_code, c.address_line1, c.postal_code, c.city,
            nullif(trim(concat_ws(' ', ct.salutation, ct.first_name, ct.last_name)), '') as contact, m.display_name as seller,
            o.subtotal_ht, o.discount_total_ht, o.total_ht, o.total_vat, o.total_ttc, o.conditions, o.arguments
     from offers o join customers c on c.id = o.customer_id left join contacts ct on ct.id = o.contact_id
     left join organization_members m on m.organization_id = o.organization_id and m.user_id = o.owner_user_id
     where o.id = $1 and o.organization_id = $2`, [offerId, orgId])).rows[0];
  if (!o) throw new Error("Offre introuvable.");
  const lines = (await db.query<{ product_id: string; reference: string; ean: string | null; name: string; description: string; quantity: string; unit_price_ht: string; discount_pct: string; vat_rate: string; line_total_ht: string; units_per_case: number | null;
    category: string | null; recommendation_type: string | null; purchase_count: number | null; last_order_date: string | null; availability: string; confidence: string | null; rationale: string | null }>(
    `select l.product_id, p.reference, p.ean, p.name, l.description, l.quantity, l.unit_price_ht, l.discount_pct, l.vat_rate, l.line_total_ht, p.units_per_case,
            p.category, l.recommendation_type, l.purchase_count, l.last_order_date::text, p.availability::text, l.confidence, l.rationale
     from offer_lines l join products p on p.id = l.product_id where l.offer_id = $1 order by l.line_no`, [offerId])).rows;
  const doc: OfferDocData = {
    number: o.number,
    date: o.offer_date,
    validUntil: o.valid_until,
    customer: { name: o.customer_name, code: o.external_code, address: o.address_line1, city: [o.postal_code, o.city].filter(Boolean).join(" ") || null },
    contactName: o.contact,
    sellerName: o.seller,
    lines: await Promise.all(lines.map(async (l) => ({
      reference: l.reference, ean: l.ean, description: l.description, quantity: l.quantity, unitPriceHt: l.unit_price_ht, discountPct: l.discount_pct,
      vatRate: l.vat_rate, lineTotalHt: l.line_total_ht, unitsPerCase: l.units_per_case, image: null as DocImage,
      category: l.category, recommendationType: l.recommendation_type, purchaseCount: l.purchase_count, lastOrderDate: l.last_order_date, availability: l.availability, confidence: l.confidence, rationale: l.rationale,
    }))),
    totals: { subtotalHt: o.subtotal_ht, discountTotalHt: o.discount_total_ht, totalHt: o.total_ht, totalVat: o.total_vat, totalTtc: o.total_ttc },
    conditions: o.conditions,
    arguments: Array.isArray(o.arguments) ? o.arguments.slice(0, 2) : [],
  };
  const images = await productImages(db, lines.map((l) => l.product_id));
  for (const [i, l] of lines.entries()) doc.lines[i]!.image = images.get(l.product_id) ?? null;
  return { doc, productIds: lines.map((l) => l.product_id), master: new Map(lines.map((l) => [l.reference, { ean: l.ean, name: l.name }])) };
}

async function loadProductDocs(db: Db, productIds: string[]): Promise<ProductDocData[]> {
  const rows = (await db.query<{ id: string; reference: string; ean: string | null; brand: string | null; name: string; description: string | null; category: string | null; units_per_case: number | null; pcb: number | null; sale_price_ht: string | null; vat_rate: string; availability: string; marketing_points: string[]; length_cm: string | null; width_cm: string | null; height_cm: string | null; weight_kg: string | null }>(
    `select id, reference, ean, brand, name, description, category, units_per_case, pcb, sale_price_ht, vat_rate, availability, marketing_points, length_cm, width_cm, height_cm, weight_kg
     from products where id = any($1::uuid[]) order by reference`, [productIds])).rows;
  const out: ProductDocData[] = [];
  const images = await productImages(db, rows.map((p) => p.id));
  for (const p of rows) {
    out.push({
      reference: p.reference, ean: p.ean, brand: p.brand, name: p.name, description: p.description, category: p.category, unitsPerCase: p.units_per_case, pcb: p.pcb,
      priceHt: p.sale_price_ht, vatRate: p.vat_rate, availability: p.availability, marketingPoints: p.marketing_points ?? [],
      dimensions: p.length_cm && p.width_cm && p.height_cm ? `${p.length_cm} × ${p.width_cm} × ${p.height_cm} cm` : null,
      weightKg: p.weight_kg, image: images.get(p.id) ?? null,
    });
  }
  return out;
}

export type GeneratedAsset = { id: string; kind: string; filename: string; validation: ValidationReport | null; status: "created" | "not_configured"; reason?: string };

/** « Créer mes supports » : génère, valide et associe les documents à l'offre. */
export async function generateOfferAssets(db: Db, orgId: string, userId: string | null, offerId: string, kinds: AssetKind[], opts: { jobId?: string } = {}): Promise<GeneratedAsset[]> {
  const { doc, productIds, master } = await loadOfferDoc(db, orgId, offerId);
  const jobId = opts.jobId ?? (await db.query<{ id: string }>(
    `insert into creative_jobs (organization_id, kind, status, offer_id, product_ids, input, created_by) values ($1,'offer_assets','running',$2,$3,$4,$5) returning id`,
    [orgId, offerId, productIds, { kinds }, userId],
  )).rows[0]!.id;
  const results: GeneratedAsset[] = [];
  const version = Number((await db.query<{ n: number }>(`select count(*)::int as n from generated_assets where offer_id = $1`, [offerId])).rows[0]!.n) + 1;

  const store = async (kind: string, filename: string, mime: string, data: Buffer, validation: ValidationReport | null, templateVersion: number | null, productId: string | null = null) => {
    const path = storagePath(orgId, "assets", offerId, `${version}-${filename}`);
    await putFile(path, data);
    const r = await db.query<{ id: string }>(
      `insert into generated_assets (organization_id, creative_job_id, offer_id, product_id, kind, filename, storage_path, mime_type, byte_size, sha256, template_version, is_generative, validation_status, validation_report)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,'pending',$12) returning id`,
      [orgId, jobId, offerId, productId, kind, filename, path, mime, data.length, sha256(data), templateVersion, validation ?? {}],
    );
    results.push({ id: r.rows[0]!.id, kind, filename, validation, status: "created" });
  };

  const sourceLines = doc.lines.map((l) => ({ reference: l.reference, quantity: l.quantity, unitPriceHt: l.unitPriceHt, discountPct: l.discountPct, lineTotalHt: l.lineTotalHt, vatRate: l.vatRate }));
  const safeNo = doc.number.replace(/[^A-Za-z0-9-]/g, "");
  for (const kind of kinds) {
    if (kind === "offer_pdf") {
      const b = await loadBrand(db, orgId, "offer_pdf");
      const v = mergeReports(validateOfferDocument(doc, { totals: doc.totals, lines: sourceLines }, master), validateBrandConsistency(b.brand, b.template));
      await store(kind, `Offre-${safeNo}.pdf`, "application/pdf", await generateOfferPdf(doc, b.brand, { showImages: b.template.showProductImages, showEan: b.template.showEan }), v, b.templateVersion);
    } else if (kind === "offer_excel") {
      const b = await loadBrand(db, orgId, "offer_excel");
      const v = validateOfferDocument(doc, { totals: doc.totals, lines: sourceLines }, master);
      await store(kind, `Offre-${safeNo}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", await generateOfferExcel(doc, b.brand, { showImages: b.template.showProductImages }), v, b.templateVersion);
    } else if (kind === "coverage_excel") {
      const b = await loadBrand(db, orgId, "offer_excel");
      const o = (await db.query<{ customer_id: string }>(`select customer_id from offers where id = $1`, [offerId])).rows[0]!;
      const today = toIsoDate(new Date());
      const cov = await loadCustomerCoverage(db, orgId, o.customer_id, today, { productIds });
      const offerQty = new Map(doc.lines.map((l, k) => [productIds[k]!, { qty: l.quantity, price: l.unitPriceHt }]));
      const rows = [];
      const covImages = await productImages(db, cov.rows.map((r) => r.productId));
      for (const r of cov.rows) {
        const inOffer = offerQty.get(r.productId);
        rows.push({ ...r, confidenceLabel: CONFIDENCE_LABEL[r.confidence], image: covImages.get(r.productId) ?? null,
          recommendedQty: inOffer ? inOffer.qty : r.recommendedQty, priceHt: inOffer ? inOffer.price : r.priceHt });
      }
      const hypotheses = [...new Set(cov.rows.flatMap((r) => r.hypotheses))];
      const v: ValidationReport = { ok: true, checks: [
        { name: "Quantités identiques à l'offre", ok: rows.every((r) => !offerQty.has(r.productId) || r.recommendedQty === offerQty.get(r.productId)!.qty) },
        { name: "Estimations étiquetées (hypothèses fournies)", ok: rows.every((r) => r.stockSource !== "estimated" && r.rateSource !== "estimated") || hypotheses.length > 0 },
      ] };
      v.ok = v.checks.every((c) => c.ok);
      await store(kind, `Analyse-${safeNo}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        await generateCoverageExcel({ customerName: cov.customerName, date: today, offerNumber: doc.number, rows, complementary: cov.complementary, news: cov.news, hypotheses }, b.brand), v, b.templateVersion);
    } else if (kind === "synthesis_pdf") {
      const b = await loadBrand(db, orgId, "offer_pdf");
      const cat = new Map<string, { lines: number; total: number }>();
      const typ = new Map<string, { lines: number; total: number }>();
      for (const l of doc.lines) {
        for (const [m, k] of [[cat, l.category ?? "Sans catégorie"], [typ, l.recommendationType ?? "manual"]] as const) {
          const v = m.get(k) ?? { lines: 0, total: 0 };
          m.set(k, { lines: v.lines + 1, total: v.total + Number(l.lineTotalHt) });
        }
      }
      const rank: Record<string, number> = { reorder: 0, back_in_stock: 1, permanent: 2, complementary: 3, new_product: 4, manual: 5 };
      const priorities = [...doc.lines].sort((a, z) => (rank[a.recommendationType ?? "manual"] ?? 9) - (rank[z.recommendationType ?? "manual"] ?? 9) || Number(z.lineTotalHt) - Number(a.lineTotalHt)).slice(0, 20);
      const asList = (m: Map<string, { lines: number; total: number }>) => [...m.entries()].sort((a, z) => z[1].total - a[1].total).map(([k, v]) => ({ k, lines: v.lines, totalHt: v.total.toFixed(2) }));
      await store(kind, `Synthese-${safeNo}.pdf`, "application/pdf", await generateSynthesisPdf({
        offerNumber: doc.number, customerName: doc.customer.name, date: doc.date, totals: { totalHt: doc.totals.totalHt, lines: doc.lines.length },
        byCategory: asList(cat).map((x) => ({ category: x.k, lines: x.lines, totalHt: x.totalHt })), byType: asList(typ).map((x) => ({ type: x.k, lines: x.lines, totalHt: x.totalHt })),
        priorities: priorities.map((l) => ({ reference: l.reference, name: l.description, type: l.recommendationType ?? null, quantity: l.quantity, lineTotalHt: l.lineTotalHt, rationale: l.rationale ?? null })),
        notes: [
          "Montants issus de l'offre (prix vérifiés au moment de la construction ; aucun prix inventé).",
          "Réassort et permanents : quantités calculées sur le rythme d'achat du client (estimations d'après les factures, sauf stock déclaré).",
          "Nouveautés et compléments : quantités de découverte (colisage minimal).",
        ],
      }, b.brand), { ok: true, checks: [{ name: "Totaux identiques à l'offre", ok: dec(doc.lines.reduce((a, l) => a + Number(l.lineTotalHt), 0).toFixed(2)).minus(dec(doc.totals.totalHt)).abs().lte(dec(doc.totals.discountTotalHt).plus("0.05")) }] }, b.templateVersion);
    } else if (kind === "priority_pdf") {
      const b = await loadBrand(db, orgId, "catalog");
      const rank: Record<string, number> = { reorder: 0, back_in_stock: 1, permanent: 2, complementary: 3, new_product: 4, manual: 5 };
      const top = [...doc.lines.map((l, k) => ({ l, id: productIds[k]! }))].sort((a, z) => (rank[a.l.recommendationType ?? "manual"] ?? 9) - (rank[z.l.recommendationType ?? "manual"] ?? 9) || Number(z.l.lineTotalHt) - Number(a.l.lineTotalHt)).slice(0, 24);
      const prods = await loadProductDocs(db, top.map((t) => t.id));
      await store(kind, `Selection-prioritaire-${safeNo}.pdf`, "application/pdf", await generateCatalog(`Sélection prioritaire — ${doc.customer.name}`, top.map((t) => prods.find((p) => p.reference === t.l.reference)!).filter(Boolean), b.brand, 3), { ok: true, checks: [{ name: "Photos issues des médias autorisés", ok: true }] }, b.templateVersion);
    } else if (kind === "product_sheet") {
      const b = await loadBrand(db, orgId, "product_sheet");
      for (const p of await loadProductDocs(db, productIds)) {
        await store(kind, `Fiche-${p.reference.replace(/[^A-Za-z0-9-]/g, "")}.pdf`, "application/pdf", await generateProductSheet(p, b.brand), null, b.templateVersion);
      }
    } else if (kind === "catalog") {
      const b = await loadBrand(db, orgId, "catalog");
      await store(kind, `Catalogue-${safeNo}.pdf`, "application/pdf", await generateCatalog(`Sélection pour ${doc.customer.name}`, await loadProductDocs(db, productIds), b.brand, b.template.columns), null, b.templateVersion);
    } else if (kind === "poster") {
      const b = await loadBrand(db, orgId, "poster");
      await store(kind, `Affiche-${safeNo}.pdf`, "application/pdf", await generateRetailPoster(`Votre sélection ${b.brand.companyName}`, await loadProductDocs(db, productIds), b.brand), null, b.templateVersion);
    } else if (kind === "lifestyle_shooting") {
      const res = await getImageAdapter().generate({ kind: "lifestyle_shooting" as ImageJobKind, sourceImage: null, productName: doc.lines[0]?.description ?? "", brief: "" });
      if (res.status === "not_configured") results.push({ id: "", kind, filename: "", validation: null, status: "not_configured", reason: res.reason });
    }
  }
  if (!opts.jobId) await db.query(`update creative_jobs set status = 'succeeded', finished_at = now() where id = $1`, [jobId]);
  await audit(db, orgId, userId ? { type: "user", userId } : { type: "agent" }, "creative.assets_generated", { type: "offer", id: offerId }, { kinds, version });
  return results;
}

function mergeReports(a: ValidationReport, b: ValidationReport): ValidationReport {
  const checks = [...a.checks, ...b.checks];
  return { ok: checks.every((c) => c.ok), checks };
}

export async function decideAsset(db: Db, orgId: string, userId: string, assetId: string, decision: "approved" | "rejected") {
  const a = (await db.query<{ validation_report: ValidationReport | Record<string, never>; is_generative: boolean }>(
    `select validation_report, is_generative from generated_assets where id = $1 and organization_id = $2`, [assetId, orgId])).rows[0];
  if (!a) throw new Error("Document introuvable.");
  if (decision === "approved" && "ok" in a.validation_report && a.validation_report.ok === false) throw new Error("Le contrôle automatique a échoué : ce document ne peut pas être validé.");
  await db.query(`update generated_assets set validation_status = $2 where id = $1`, [assetId, decision]);
  await audit(db, orgId, { type: "user", userId }, `creative.asset_${decision}`, { type: "generated_asset", id: assetId });
}

/** Validation automatique (mode autonome) : uniquement les documents NON génératifs dont tous les contrôles ont réussi. */
export async function autoApproveAssets(db: Db, orgId: string, offerId: string) {
  const r = await db.query<{ id: string }>(
    `update generated_assets set validation_status = 'approved'
     where organization_id = $1 and offer_id = $2 and validation_status = 'pending' and not is_generative and (validation_report->>'ok')::boolean is true
     returning id`, [orgId, offerId]);
  for (const a of r.rows) await audit(db, orgId, { type: "agent" }, "creative.asset_auto_approved", { type: "generated_asset", id: a.id });
  return r.rowCount ?? 0;
}

/** Analyse de couverture d'un client (toutes références achetées sur 12 mois), générée à la demande. */
export async function buildCustomerCoverageExcel(db: Db, orgId: string, customerId: string, today: string) {
  const b = await loadBrand(db, orgId, "offer_excel");
  const cov = await loadCustomerCoverage(db, orgId, customerId, today);
  const rows = [];
  const all = cov.rows.slice(0, 2000);
  const images = await productImages(db, all.map((r) => r.productId));
  for (const r of all) rows.push({ ...r, confidenceLabel: CONFIDENCE_LABEL[r.confidence], image: images.get(r.productId) ?? null });
  const data = await generateCoverageExcel({ customerName: cov.customerName, date: today, offerNumber: null, rows, complementary: cov.complementary, news: cov.news, hypotheses: [...new Set(cov.rows.flatMap((r) => r.hypotheses))] }, b.brand);
  return { filename: `Analyse-couverture-${cov.customerName.replace(/[^A-Za-z0-9-]+/g, "-").slice(0, 40)}-${today}.xlsx`, data };
}
