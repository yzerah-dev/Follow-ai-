/**
 * Jeu de données de charge (LOCAL UNIQUEMENT) : 20 000 produits, 5 000 clients, ~500 000 lignes de factures sur 3 ans.
 * Génération côté PostgreSQL (generate_series + hachage déterministe) : rapide et reproductible.
 *
 * Usage : PERF_DATABASE_URL=postgres://postgres:postgres@localhost:5432/follow_ai_perf npx tsx scripts/perf/seed-large.ts
 * Options : --products=20000 --customers=5000 --big=250
 */
import pg from "pg";
import { applyAll, recreateDatabase } from "../../lib/database/migrate";
import { gradientPng } from "../../lib/demo/png";

const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d);
const PRODUCTS = arg("products", 20000);
const CUSTOMERS = arg("customers", 5000);
const BIG = arg("big", 250); // grands comptes : ~1 200 lignes chacun
export const PERF_TODAY = "2026-11-06";

const url = new URL(process.env.PERF_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/follow_ai_perf");
if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Jeu de charge réservé à une base locale.");

const t0 = Date.now();
const step = async (label: string, c: pg.Client, sql: string, params: unknown[] = []) => {
  const s = Date.now();
  const r = await c.query(sql, params);
  console.log(`  ${label.padEnd(34)} ${String(r.rowCount ?? "").padStart(8)} lignes  ${((Date.now() - s) / 1000).toFixed(1)} s`);
  return r;
};

const admin = new URL(url.toString());
admin.pathname = "/postgres";
await recreateDatabase(admin.toString(), url.pathname.slice(1));
const c = new pg.Client({ connectionString: url.toString() });
await c.connect();
await applyAll(c, { withLocalShim: true });
console.log(`Jeu de charge : ${PRODUCTS} produits, ${CUSTOMERS} clients (${BIG} grands comptes)`);

const org = (await c.query<{ id: string }>(`insert into organizations (name, slug, is_demo) values ('Grossiste Perf — Démo', 'perf', true) returning id`)).rows[0]!.id;
const user = (await c.query<{ id: string }>(`insert into auth.users (email, encrypted_password, raw_user_meta_data) values ('perf@demo.follow.ai', extensions.crypt('demo-follow-ai', extensions.gen_salt('bf', 10)), '{}') returning id`)).rows[0]!.id;
await c.query(`insert into organization_members (organization_id, user_id, role, display_name) values ($1,$2,'owner','Perf')`, [org, user]);
await c.query(`insert into organization_settings (organization_id, max_auto_discount_pct, require_discount_approval, brand, autonomy_level, daily_offer_limit)
               values ($1, 1, false, '{"companyName":"Grossiste Perf","primaryColor":"#6e44ff"}', 'autonomous', 1000)`, [org]);
await c.query(`select setseed(0.42)`);

// Produits : 40 catégories, 25 marques, colisages 6/12/24, 2 % de nouveautés, disponibilités variées
await step("produits", c, `
  insert into products (organization_id, reference, ean, brand, name, category, units_per_case, sale_price_ht, availability, is_new, launched_at, status)
  select $1, 'P' || lpad(g::text, 6, '0'), '3' || lpad(g::text, 12, '0'),
         'Marque ' || (1 + g % 25), 'Article ' || g || ' ' || (array['Classique','Premium','Duo','Bambou','Vintage','Bleu nuit'])[1 + g % 6],
         'Catégorie ' || (1 + (g * 7) % 40), (array[6,12,24])[1 + g % 3], round((1 + (g % 97) * 0.37)::numeric, 2),
         (case when g % 20 = 0 then 'out_of_stock' when g % 20 = 1 then 'low_stock' when g % 20 = 2 then 'unknown' else 'in_stock' end)::availability_status,
         g % 50 = 0, case when g % 50 = 0 then $2::date - (g % 60) end, 'active'
  from generate_series(1, $3) g`, [org, PERF_TODAY, PRODUCTS]);
await step("variantes", c, `
  insert into product_variants (organization_id, product_id, reference, ean, label, attributes)
  select organization_id, id, reference || '-V', null, 'Variante couleur', '{"couleur":"assortie"}' from products where organization_id = $1 and (substr(reference, 2)::int) % 10 = 0`, [org]);
// Médias produits autorisés : 8 visuels partagés (placeholders de démonstration étiquetés)
const { putFile, storagePath } = await import("../../lib/storage");
for (let k = 0; k < 8; k++) await putFile(storagePath(org, "products", `perf-${k}.png`), gradientPng(240, 240, [110 + k * 15, 68, 255], [241, 236, 255]));
await step("photos produits", c, `
  insert into product_images (organization_id, product_id, kind, storage_path, approved, is_primary)
  select organization_id, id, 'demo_placeholder', $2 || '/products/perf-' || ((substr(reference, 2)::int) % 8) || '.png', true, true from products where organization_id = $1`, [org, org]);

await step("clients", c, `
  insert into customers (organization_id, external_code, legal_name, city, status, franco_amount)
  select $1, 'C' || lpad(g::text, 5, '0'), case when g <= $3 then 'Grand compte ' || g else 'Magasin ' || g end, 'Ville ' || (g % 300), 'active', 300
  from generate_series(1, $2) g`, [org, CUSTOMERS, BIG]);

// Factures : grands comptes tous les 28 jours (40 factures), autres tous les ~52 jours (21 factures)
await step("factures", c, `
  insert into invoices (organization_id, invoice_number, customer_id, invoice_date, total_ht, total_vat, total_ttc)
  select $1, 'F' || cu.external_code || '-' || k, cu.id,
         $2::date - (case when cu.n <= $3 then 28 else 52 end) * k - (cu.n % 9), 0, 0, 0
  from (select id, external_code, substr(external_code, 2)::int as n from customers where organization_id = $1) cu,
       generate_series(0, 39) k
  where k < case when cu.n <= $3 then 40 else 21 end`, [org, PERF_TODAY, BIG]);

// Lignes : grands comptes = 15 références permanentes (chaque facture) + 15 tournantes parmi un répertoire de 400 ;
// magasins = 2 références parmi un répertoire de 8. Produits retirés du catalogue de temps en temps (product_id null).
await step("lignes de factures", c, `
  insert into invoice_lines (organization_id, invoice_id, line_no, product_id, product_reference, description, quantity, unit_price_ht, line_total_ht, units_per_case)
  select $1, i.id, j + 1, p.id, p.reference, p.name, q.qty, p.sale_price_ht, round(q.qty * p.sale_price_ht, 2), p.units_per_case
  from (select i.id, cu.n, row_number() over (partition by i.customer_id order by i.invoice_date) as k
        from invoices i join (select id, substr(external_code, 2)::int as n from customers where organization_id = $1) cu on cu.id = i.customer_id
        where i.organization_id = $1) i
  cross join lateral generate_series(0, case when i.n <= $2 then 29 else 1 end) j
  cross join lateral (select case
            when i.n <= $2 and j < 15 then (i.n * 131 + j * 17) % $3
            when i.n <= $2 then (i.n * 131 + 15 * 17 + ((i.k * 15 + j) % 385) * 23) % $3
            else (i.n * 37 + ((i.k + j * 3) % 8) * 11) % $3 end + 1 as pn) pick
  join products p on p.organization_id = $1 and p.reference = 'P' || lpad(pick.pn::text, 6, '0')
  cross join lateral (select (p.units_per_case * (1 + (i.n + j) % 4))::numeric as qty) q`, [org, BIG, PRODUCTS]);
await step("totaux des factures", c, `
  update invoices i set total_ht = s.ht, total_vat = round(s.ht * 0.2, 2), total_ttc = round(s.ht * 1.2, 2)
  from (select invoice_id, sum(line_total_ht) as ht from invoice_lines where organization_id = $1 group by 1) s where s.invoice_id = i.id`, [org]);

// Tarifs clients (50 références par grand compte, -3 %) et retours en stock (200 produits passés de 0 à disponible)
await step("tarifs clients", c, `
  insert into product_prices (organization_id, product_id, customer_id, unit_price_ht, min_qty)
  select $1, p.id, cu.id, round(p.sale_price_ht * 0.97, 4), 1
  from (select id, substr(external_code, 2)::int as n from customers where organization_id = $1 and substr(external_code, 2)::int <= $2) cu
  cross join generate_series(0, 49) j
  join products p on p.organization_id = $1 and p.reference = 'P' || lpad(((cu.n * 131 + j * 17) % $3 + 1)::text, 6, '0')
  on conflict do nothing`, [org, BIG, PRODUCTS]);
await step("relevés de stock", c, `
  insert into inventory_snapshots (organization_id, product_id, qty_on_hand, qty_available, captured_at)
  select organization_id, id, v.q, v.q, v.at from products p
  cross join lateral (values (0::numeric, $2::timestamptz - interval '20 days'), (500::numeric, $2::timestamptz - interval '2 days')) v(q, at)
  where p.organization_id = $1 and (substr(p.reference, 2)::int) % 100 = 7`, [org, `${PERF_TODAY}T08:00:00Z`]);
await c.query(`analyze`);
const counts = (await c.query<{ p: number; c: number; i: number; l: number }>(
  `select (select count(*) from products)::int p, (select count(*) from customers)::int c, (select count(*) from invoices)::int i, (select count(*) from invoice_lines)::int l`)).rows[0]!;
console.log(`Terminé en ${((Date.now() - t0) / 1000).toFixed(1)} s :`, counts);
await c.end();
