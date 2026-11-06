import type { Db } from "@/lib/database/client";
import { insertMany } from "@/lib/database/bulk";
import { sha256 } from "@/lib/security/crypto";
import { audit } from "@/lib/security/audit";
import { dec, lineTotal, computeTotals } from "@/lib/money";
import { ENTITIES, suggestMapping, type EntityKind } from "./definitions";
import { parseFile, validateRow } from "./parse";
import { sanitizeText } from "@/lib/security/untrusted";

export async function createImport(db: Db, orgId: string, userId: string, entity: EntityKind, filename: string, data: Buffer) {
  const parsed = await parseFile(filename, data);
  if (!parsed.rows.length) throw new Error("Le fichier ne contient aucune ligne de données.");
  const hash = sha256(data);
  const previous = (await db.query<{ id: string }>(`select id from imports where organization_id = $1 and entity = $2 and file_sha256 = $3 and status = 'completed' limit 1`, [orgId, entity, hash])).rows[0];
  const mapping = suggestMapping(entity, parsed.headers);
  const imp = await db.query<{ id: string }>(
    `insert into imports (organization_id, entity, filename, file_sha256, status, mapping, total_rows, created_by) values ($1,$2,$3,$4,'uploaded',$5,$6,$7) returning id`,
    [orgId, entity, sanitizeText(filename, 200), hash, { headers: parsed.headers, fields: mapping, previousImportId: previous?.id ?? null }, parsed.rows.length, userId],
  );
  const importId = imp.rows[0]!.id;
  await insertMany(db, "import_rows", ["organization_id", "import_id", "row_no", "raw"], parsed.rows.map((r, i) => [orgId, importId, i + 2, r]));
  await audit(db, orgId, { type: "user", userId }, "import.uploaded", { type: "import", id: importId }, { entity, rows: parsed.rows.length });
  return { importId, alreadyImported: !!previous };
}

type Counters = { ok: number; dup: number; err: number };

/** Traitement (validation + écriture). Idempotent : réimporter le même fichier ne crée aucun doublon. */
export async function processImport(db: Db, orgId: string, userId: string, importId: string, fieldMapping: Record<string, string | null>) {
  const imp = (await db.query<{ entity: EntityKind; status: string; mapping: { headers: string[] } }>(`select entity, status, mapping from imports where id = $1 and organization_id = $2`, [importId, orgId])).rows[0];
  if (!imp) throw new Error("Import introuvable.");
  if (imp.status === "processing" || imp.status === "completed") throw new Error("Import déjà traité ou en cours.");
  const allowed = new Set(ENTITIES[imp.entity].map((f) => f.key));
  const mapping = Object.fromEntries(Object.entries(fieldMapping).filter(([h, k]) => imp.mapping.headers.includes(h) && (k === null || allowed.has(k))));
  const missing = ENTITIES[imp.entity].filter((f) => f.required && !Object.values(mapping).includes(f.key));
  if (missing.length) throw new Error(`Colonnes obligatoires non associées : ${missing.map((m) => m.label).join(", ")}.`);
  await db.query(`update imports set status = 'processing', mapping = mapping || jsonb_build_object('fields', $2::jsonb) where id = $1`, [importId, JSON.stringify(mapping)]);

  const rows = (await db.query<{ id: string; row_no: number; raw: Record<string, string> }>(`select id, row_no, raw from import_rows where import_id = $1 order by row_no`, [importId])).rows;
  const c: Counters = { ok: 0, dup: 0, err: 0 };
  const mark = async (rowId: string, status: string, errors: string[] = [], entityId: string | null = null) => {
    await db.query(`update import_rows set status = $2, errors = $3, entity_id = $4 where id = $1`, [rowId, status, JSON.stringify(errors), entityId]);
    if (status === "error") c.err++;
    else if (status === "skipped_duplicate") c.dup++;
    else c.ok++;
  };

  const validated = rows.map((r) => ({ r, v: validateRow(imp.entity, r.raw, mapping) }));
  for (const { r, v } of validated) if (!v.ok) await mark(r.id, "error", v.errors);
  const valid = validated.filter((x) => x.v.ok).map((x) => ({ r: x.r, v: (x.v as { ok: true; value: Record<string, string | number | boolean | null> }).value }));

  const customerIdByCode = async (code: unknown) =>
    code ? ((await db.query<{ id: string }>(`select id from customers where organization_id = $1 and external_code = $2`, [orgId, String(code)])).rows[0]?.id ?? null) : null;
  const productIdByRef = async (ref: unknown, ean?: unknown) =>
    (await db.query<{ id: string }>(`select id from products where organization_id = $1 and (reference = $2 or ($3::text is not null and ean = $3)) order by (reference = $2) desc limit 1`, [orgId, ref ? String(ref) : "", ean ? String(ean) : null])).rows[0]?.id ?? null;

  if (imp.entity === "customers") {
    for (const { r, v } of valid) {
      const res = await db.query<{ id: string; inserted: boolean }>(
        `insert into customers (organization_id, external_code, legal_name, trade_name, address_line1, postal_code, city, country, phone, email, website, segment, payment_terms, min_order_amount, franco_amount)
         values ($1,$2,$3,$4,$5,$6,$7,coalesce(upper($8),'FR'),$9,$10,$11,$12,$13,$14,$15)
         on conflict (organization_id, external_code) do update set legal_name = excluded.legal_name, trade_name = coalesce(excluded.trade_name, customers.trade_name),
           address_line1 = coalesce(excluded.address_line1, customers.address_line1), postal_code = coalesce(excluded.postal_code, customers.postal_code),
           city = coalesce(excluded.city, customers.city), phone = coalesce(excluded.phone, customers.phone), email = coalesce(excluded.email, customers.email),
           website = coalesce(excluded.website, customers.website), segment = coalesce(excluded.segment, customers.segment),
           payment_terms = coalesce(excluded.payment_terms, customers.payment_terms), min_order_amount = coalesce(excluded.min_order_amount, customers.min_order_amount),
           franco_amount = coalesce(excluded.franco_amount, customers.franco_amount)
         returning id, (xmax = 0) as inserted`,
        [orgId, v.external_code, v.legal_name, v.trade_name, v.address_line1, v.postal_code, v.city, typeof v.country === "string" ? v.country.slice(0, 2) : null, v.phone, v.email, v.website, v.segment, v.payment_terms, v.min_order_amount, v.franco_amount],
      );
      await mark(r.id, res.rows[0]!.inserted ? "imported" : "updated", [], res.rows[0]!.id);
    }
  } else if (imp.entity === "contacts") {
    for (const { r, v } of valid) {
      const customerId = await customerIdByCode(v.customer_code);
      if (!customerId) {
        await mark(r.id, "error", [`Client « ${v.customer_code} » introuvable`]);
        continue;
      }
      const ct = await db.query<{ id: string; inserted: boolean }>(
        `insert into contacts (organization_id, email, salutation, first_name, last_name, phone, consent_email, consent_source, consent_at)
         values ($1,$2,$3,$4,$5,$6,coalesce($7,false), case when $7 then 'import' end, case when $7 then now() end)
         on conflict (organization_id, lower(email)) where email is not null do update set first_name = coalesce(excluded.first_name, contacts.first_name),
           last_name = coalesce(excluded.last_name, contacts.last_name), salutation = coalesce(excluded.salutation, contacts.salutation), phone = coalesce(excluded.phone, contacts.phone)
         returning id, (xmax = 0) as inserted`,
        [orgId, v.email, v.salutation, v.first_name, v.last_name, v.phone, v.consent_email],
      );
      await db.query(`insert into customer_contacts (organization_id, customer_id, contact_id, job_function) values ($1,$2,$3,$4) on conflict do nothing`, [orgId, customerId, ct.rows[0]!.id, v.job_function]);
      await mark(r.id, ct.rows[0]!.inserted ? "imported" : "updated", [], ct.rows[0]!.id);
    }
  } else if (imp.entity === "products") {
    for (const { r, v } of valid) {
      const res = await db.query<{ id: string; inserted: boolean }>(
        `insert into products (organization_id, reference, name, ean, brand, description, category, units_per_case, pcb, sale_price_ht, vat_rate, min_order_qty, weight_kg)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11, 20),$12,$13)
         on conflict (organization_id, reference) do update set name = excluded.name, ean = coalesce(excluded.ean, products.ean), brand = coalesce(excluded.brand, products.brand),
           description = coalesce(excluded.description, products.description), category = coalesce(excluded.category, products.category),
           units_per_case = coalesce(excluded.units_per_case, products.units_per_case), pcb = coalesce(excluded.pcb, products.pcb),
           sale_price_ht = coalesce(excluded.sale_price_ht, products.sale_price_ht), vat_rate = coalesce($11, products.vat_rate),
           min_order_qty = coalesce(excluded.min_order_qty, products.min_order_qty), weight_kg = coalesce(excluded.weight_kg, products.weight_kg)
         returning id, (xmax = 0) as inserted`,
        [orgId, v.reference, v.name, v.ean, v.brand, v.description, v.category, v.units_per_case, v.pcb, v.sale_price_ht, v.vat_rate, v.min_order_qty, v.weight_kg],
      );
      await mark(r.id, res.rows[0]!.inserted ? "imported" : "updated", [], res.rows[0]!.id);
    }
  } else if (imp.entity === "prices") {
    for (const { r, v } of valid) {
      const productId = await productIdByRef(v.product_reference);
      const customerId = v.customer_code ? await customerIdByCode(v.customer_code) : null;
      if (!productId || (v.customer_code && !customerId)) {
        await mark(r.id, "error", [!productId ? `Produit « ${v.product_reference} » introuvable` : `Client « ${v.customer_code} » introuvable`]);
        continue;
      }
      const existing = (await db.query<{ id: string }>(
        `select id from product_prices where product_id = $1 and customer_id is not distinct from $2 and min_qty = coalesce($3, 1) and valid_from is not distinct from $4`, [productId, customerId, v.min_qty, v.valid_from])).rows[0];
      if (existing) {
        await db.query(`update product_prices set unit_price_ht = $2, valid_to = $3 where id = $1`, [existing.id, v.unit_price_ht, v.valid_to]);
        await mark(r.id, "updated", [], existing.id);
      } else {
        const ins = await db.query<{ id: string }>(
          `insert into product_prices (organization_id, product_id, customer_id, price_list, unit_price_ht, min_qty, valid_from, valid_to) values ($1,$2,$3,$4,$5,coalesce($6,1),$7,$8) returning id`,
          [orgId, productId, customerId, customerId ? "client" : "general", v.unit_price_ht, v.min_qty, v.valid_from, v.valid_to]);
        await mark(r.id, "imported", [], ins.rows[0]!.id);
      }
    }
  } else if (imp.entity === "inventory") {
    const seen = new Set<string>();
    for (const { r, v } of valid) {
      const productId = await productIdByRef(v.product_reference);
      if (!productId) {
        await mark(r.id, "error", [`Produit « ${v.product_reference} » introuvable`]);
        continue;
      }
      if (seen.has(productId)) {
        await mark(r.id, "skipped_duplicate", ["Produit présent plusieurs fois dans le fichier"]);
        continue;
      }
      seen.add(productId);
      await db.query(`insert into inventory_snapshots (organization_id, product_id, qty_on_hand, qty_available, source) values ($1,$2,$3,$4,'import')`, [orgId, productId, v.qty_on_hand, v.qty_available]);
      const avail = v.qty_available ?? v.qty_on_hand;
      await db.query(`update products set availability = case when $2::numeric <= 0 then 'out_of_stock'::availability_status else 'in_stock'::availability_status end where id = $1`, [productId, avail]);
      await mark(r.id, "imported", [], productId);
    }
  } else if (imp.entity === "invoices") {
    const groups = new Map<string, typeof valid>();
    for (const x of valid) {
      const key = `${x.v.invoice_number}|${x.v.doc_type ?? "invoice"}`;
      groups.set(key, [...(groups.get(key) ?? []), x]);
    }
    for (const [, items] of groups) {
      const head = items[0]!.v;
      const docType = (head.doc_type as string) ?? "invoice";
      const exists = (await db.query<{ id: string }>(`select id from invoices where organization_id = $1 and invoice_number = $2 and doc_type = $3`, [orgId, head.invoice_number, docType])).rows[0];
      if (exists) {
        for (const x of items) await mark(x.r.id, "skipped_duplicate", ["Facture déjà importée : ignorée pour éviter le double comptage"], exists.id);
        continue;
      }
      const customerId = await customerIdByCode(head.customer_code);
      if (!customerId) {
        for (const x of items) await mark(x.r.id, "error", [`Client « ${head.customer_code} » introuvable`]);
        continue;
      }
      const lines: unknown[][] = [];
      const totals: { totalHt: string; vatRate: string }[] = [];
      const inv = (await db.query<{ id: string }>(
        `insert into invoices (organization_id, invoice_number, customer_id, invoice_date, total_ht, total_vat, total_ttc, doc_type, status, payment_status, import_id)
         values ($1,$2,$3,$4,0,0,0,$5::invoice_doc_type,coalesce($6,'issued')::invoice_status,coalesce($7,'unknown')::payment_status,$8) returning id`,
        [orgId, head.invoice_number, customerId, head.invoice_date, docType, head.status, head.payment_status, importId])).rows[0]!;
      let lineNo = 1;
      for (const x of items) {
        const v = x.v;
        const productId = v.product_reference || v.ean ? await productIdByRef(v.product_reference, v.ean) : null;
        const qty = dec(String(v.quantity)).abs();
        const computed = lineTotal(qty, String(v.unit_price_ht), String(v.discount_pct ?? "0"));
        const total = v.line_total_ht !== null ? dec(String(v.line_total_ht)).abs() : computed;
        const vat = String(v.vat_rate ?? "20");
        totals.push({ totalHt: total.toFixed(2), vatRate: vat });
        lines.push([orgId, inv.id, lineNo++, productId, v.product_reference, v.ean, v.description, qty.toFixed(3), v.unit_price_ht, v.discount_pct ?? 0, vat, total.toFixed(2)]);
        await mark(x.r.id, "imported", productId ? [] : ["Produit non reconnu : ligne conservée sans rattachement"], inv.id);
      }
      await insertMany(db, "invoice_lines", ["organization_id", "invoice_id", "line_no", "product_id", "product_reference", "ean", "description", "quantity", "unit_price_ht", "discount_pct", "vat_rate", "line_total_ht"], lines);
      const t = computeTotals(totals);
      await db.query(`update invoices set total_ht = $2, total_vat = $3, total_ttc = $4 where id = $1`, [inv.id, t.totalHt.toFixed(2), t.totalVat.toFixed(2), t.totalTtc.toFixed(2)]);
    }
  }

  await db.query(`update imports set status = 'completed', ok_rows = $2, duplicate_rows = $3, error_rows = $4, finished_at = now() where id = $1`, [importId, c.ok, c.dup, c.err]);
  await audit(db, orgId, { type: "user", userId }, "import.completed", { type: "import", id: importId }, c);
  return c;
}
