/**
 * Jeu de données de DÉMONSTRATION — entièrement fictif et signalé comme tel
 * (organisations is_demo = true, bandeau dans l'interface, EAN préfixe 2 réservé à l'usage interne).
 *
 * 2 organisations × 100 clients × 200 produits × 12 mois de factures détaillées,
 * tarifs clients, stocks, campagnes, conversations simulées, templates créatifs.
 */
import pg from "pg";
import { insertMany } from "@/lib/database/bulk";
import type { Db } from "@/lib/database/client";
import { withDb } from "@/lib/database/client";
import { dec, lineTotal, computeTotals, round2 } from "@/lib/money";
import { addDays, toIsoDate } from "@/lib/utils";
import { putFile, storagePath } from "@/lib/storage";
import { runOpportunityScan } from "@/features/opportunities/service";
import { JONAS_PILOT_POLICY } from "@/features/offers/policy";
import { DEFAULT_TEMPLATES } from "@/features/creative-studio/templates";
import { rng, demoEan } from "./random";
import { gradientPng } from "./png";

/**
 * Voix de LÉA pour JONAS (questionnaire du 2026-11-08 + style des e-mails envoyés par l'équipe, sans aucun chiffre ni nom de client).
 * Fréquence : 1 sollicitation tous les 2 jours (2 à 3 par semaine), relances J+1 WhatsApp puis J+2 e-mail.
 */
const JONAS_VOICE = {
  tone: "dynamic",
  length: "medium",
  whatsappEmojis: true,
  assistantTitle: "assistante commerciale",
  styleNotes: [
    "Positionnement : JONAS, votre partenaire du discount ; produits utiles du quotidien à forte rotation.",
    "Mettre en avant l'image prix, le chiffre d'affaires additionnel et les opérations clés en main : box et displays prêts à poser, signalétique prix fournie (« Sélectionnez. Posez. Vendez. »).",
    "Terminer par une question fermée qui fait avancer (ex. « préférez-vous lancer l'opération début novembre ou début janvier ? »).",
    "Formules : « Je reste à votre disposition », « Dans l'attente de votre retour », « Bien cordialement ».",
  ].join("\n"),
};

export const DEMO_PASSWORD = "demo-follow-ai";

export const DEMO_USERS = [
  { key: "alice", email: "alice@demo.follow.ai", name: "Alice Moreau", org: "A", role: "owner" },
  { key: "bruno", email: "bruno@demo.follow.ai", name: "Bruno Lefèvre", org: "A", role: "commercial" },
  { key: "diane", email: "diane@demo.follow.ai", name: "Diane Roux", org: "A", role: "read_only" },
  { key: "chloe", email: "chloe@demo.follow.ai", name: "Chloé Garnier", org: "B", role: "owner" },
] as const;

type OrgSpec = {
  key: "A" | "B";
  name: string;
  slug: string;
  prefix: string;
  seed: number;
  color: [number, number, number];
  brandHex: string;
  policy: { name: string; maxAuto: string; autonomy: "supervised" | "semi_autonomous" | "autonomous"; requireDiscountApproval: boolean; maxOfferHt: string | null };
  categories: { name: string; vat: string; words: string[]; price: [number, number] }[];
  brands: string[];
};

const ORGS: OrgSpec[] = [
  {
    key: "A",
    name: "JONAS — Démo (données fictives)",
    slug: "demo-jonas",
    prefix: "JNS",
    seed: 1101,
    color: [37, 99, 235],
    brandHex: "#2563EB",
    // JONAS : LÉA autonome, remise de 1 % envoyée sans validation (décision client du 2026-11-07)
    policy: { name: JONAS_PILOT_POLICY.name!, maxAuto: JONAS_PILOT_POLICY.maxAutoDiscountPct, autonomy: "autonomous", requireDiscountApproval: false, maxOfferHt: "15000.00" },
    brands: ["Maison Lys", "Atelier Nova", "Cosy Home", "Verano", "Bricoleo"],
    categories: [
      { name: "Cuisine", vat: "20.00", price: [2, 35], words: ["Boîte hermétique", "Planche à découper", "Set de couverts", "Mug céramique", "Bocal verre", "Égouttoir", "Moule à gâteau", "Torchon coton"] },
      { name: "Décoration", vat: "20.00", price: [3, 60], words: ["Bougie parfumée", "Cadre photo", "Vase", "Coussin", "Guirlande lumineuse", "Miroir rond", "Plaid", "Lanterne"] },
      { name: "Jardin", vat: "20.00", price: [4, 80], words: ["Pot terre cuite", "Arrosoir", "Gants de jardin", "Sécateur", "Jardinière", "Tuyau", "Lampe solaire", "Semis"] },
      { name: "Rangement", vat: "20.00", price: [3, 45], words: ["Panier tressé", "Boîte de rangement", "Étagère", "Crochet mural", "Housse vêtements", "Organiseur"] },
      { name: "Entretien", vat: "20.00", price: [1.5, 20], words: ["Éponge", "Balai", "Seau", "Lavette microfibre", "Brosse", "Vaporisateur"] },
      { name: "Saisonnier", vat: "20.00", price: [2, 40], words: ["Décoration de Noël", "Boule de Noël", "Calendrier de l'Avent", "Couronne", "Photophore", "Sapin décoratif"] },
    ],
  },
  {
    key: "B",
    name: "Négoce Beta — Démo (données fictives)",
    slug: "demo-beta",
    prefix: "BTA",
    seed: 2202,
    color: [5, 150, 105],
    brandHex: "#059669",
    policy: { name: "Politique Beta (démo)", maxAuto: "2.00", autonomy: "supervised", requireDiscountApproval: true, maxOfferHt: null },
    brands: ["Terroir & Co", "Douceurs du Sud", "Fraîcheur", "Papyrus", "Naturel+"],
    categories: [
      { name: "Épicerie fine", vat: "5.50", price: [2, 25], words: ["Confiture", "Huile d'olive", "Tapenade", "Miel", "Biscuits", "Pâte à tartiner"] },
      { name: "Boissons", vat: "5.50", price: [1.5, 18], words: ["Jus de pomme", "Limonade", "Sirop", "Thé glacé", "Infusion", "Eau aromatisée"] },
      { name: "Confiserie", vat: "5.50", price: [1, 12], words: ["Nougat", "Calissons", "Bonbons", "Guimauve", "Chocolat", "Caramels"] },
      { name: "Hygiène", vat: "20.00", price: [2, 15], words: ["Savon", "Gel douche", "Shampoing", "Crème mains", "Dentifrice", "Coton"] },
      { name: "Papeterie", vat: "20.00", price: [1, 22], words: ["Carnet", "Stylo", "Agenda", "Classeur", "Enveloppes", "Cahier"] },
    ],
  },
];

const QUALIFIERS = ["Classique", "Premium", "Nature", "Pastel", "XL", "Mini", "Vintage", "Duo", "Bambou", "Lin", "Bleu nuit", "Terracotta", "Blanc", "Édition limitée"];
const SHOP_A = ["Bazar", "Maison", "Comptoir", "Galerie", "Jardinerie", "Quincaillerie", "Déco", "Atelier", "Boutique", "Marché"];
const SHOP_B = ["Épicerie", "Cave", "Comptoir", "Halle", "Supérette", "Maison", "Boutique", "Relais", "Panier", "Primeur"];
const PLACES = ["du Centre", "des Halles", "de la Gare", "du Port", "Saint-Michel", "des Lilas", "du Marché", "Bellevue", "des Arts", "du Parc", "de Provence", "du Lac", "des Vignes", "Montmartre", "du Vieux Pont"];
const FIRST = ["Jean", "Marie", "Pierre", "Sophie", "Luc", "Claire", "Paul", "Julie", "Marc", "Anne", "Hugo", "Léa", "Thomas", "Emma", "Nicolas", "Camille", "Olivier", "Sarah", "Julien", "Inès"];
const LAST = ["Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit", "Durand", "Leroy", "Moreau", "Simon", "Laurent", "Lefebvre", "Michel", "Garcia", "David", "Bertrand", "Roux", "Vincent", "Fournier"];
const CITIES = [
  ["Paris", "75011"], ["Lyon", "69002"], ["Marseille", "13001"], ["Bordeaux", "33000"], ["Lille", "59000"], ["Nantes", "44000"],
  ["Toulouse", "31000"], ["Rennes", "35000"], ["Strasbourg", "67000"], ["Nice", "06000"], ["Montpellier", "34000"], ["Dijon", "21000"],
  ["Annecy", "74000"], ["Tours", "37000"], ["Reims", "51100"], ["Caen", "14000"],
] as const;
const SEGMENTS = ["Indépendant", "Grande distribution", "Réseau franchisé", "E-commerce", "Grossiste", "Concept store"];
const FUNCTIONS = ["Gérant", "Acheteur", "Responsable rayon", "Directeur", "Assistante achats", "Comptabilité"];

export async function seedDemo(databaseUrl: string, opts: { today?: string } = {}) {
  const today = opts.today ?? toIsoDate(new Date());
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  const started = Date.now();
  try {
    // Utilisateurs (auth.users) — connexion privilégiée de seed uniquement
    const userIds: Record<string, string> = {};
    const c = await pool.connect();
    try {
      for (const u of DEMO_USERS) {
        const r = await c.query<{ id: string }>(
          `insert into auth.users (email, encrypted_password, raw_user_meta_data)
           values ($1, extensions.crypt($2, extensions.gen_salt('bf', 10)), $3)
           on conflict (email) do update set encrypted_password = excluded.encrypted_password returning id`,
          [u.email, DEMO_PASSWORD, { full_name: u.name, demo: true }],
        );
        userIds[u.key] = r.rows[0]!.id;
      }
      for (const spec of ORGS) {
        const org = await c.query<{ id: string }>(
          `insert into organizations (name, slug, is_demo) values ($1, $2, true) returning id`,
          [spec.name, spec.slug],
        );
        const orgId = org.rows[0]!.id;
        for (const u of DEMO_USERS.filter((x) => x.org === spec.key)) {
          await c.query(`insert into organization_members (organization_id, user_id, role, display_name) values ($1,$2,$3,$4)`, [orgId, userIds[u.key], u.role, u.name]);
        }
        await c.query(
          `insert into organization_settings (organization_id, max_auto_discount_pct, require_discount_approval, policy_name, brand, dormant_after_days, reorder_lookahead_days,
             autonomy_level, autonomous_max_offer_ht, daily_offer_limit, brand_voice, contact_cooldown_days, followup_after_days, followup_channels)
           values ($1, $2, $5, $3, $4, 120, 21, $6, $7, $8, $9, $10, $11, $12)`,
          [orgId, spec.policy.maxAuto, spec.policy.name, { primaryColor: spec.brandHex, secondaryColor: "#0F172A", fontFamily: "Helvetica", companyName: spec.name.split(" — ")[0], tagline: "Données de démonstration" },
            spec.policy.requireDiscountApproval, spec.policy.autonomy, spec.policy.maxOfferHt, spec.key === "A" ? 60 : 20,
            spec.key === "A" ? JONAS_VOICE : {}, spec.key === "A" ? 2 : 7, spec.key === "A" ? 1 : 5, spec.key === "A" ? ["whatsapp", "email"] : []],
        );
      }
    } finally {
      c.release();
    }

    for (const spec of ORGS) {
      const ownerKey = DEMO_USERS.find((u) => u.org === spec.key && u.role === "owner")!.key;
      const ownerId = userIds[ownerKey]!;
      const orgId = (await pool.query<{ id: string }>(`select id from organizations where slug = $1`, [spec.slug])).rows[0]!.id;
      const commercialIds = DEMO_USERS.filter((u) => u.org === spec.key && u.role !== "read_only").map((u) => userIds[u.key]!);
      // Le reste du seed s'exécute SOUS RLS, avec l'identité du propriétaire de l'organisation.
      await withDb({ kind: "user", userId: ownerId }, (db) => seedOrganization(db, spec, orgId, commercialIds, today), pool);
      const scan = await withDb({ kind: "agent", organizationId: orgId }, (db) => runOpportunityScan(db, orgId, today), pool);
      console.log(`  ${spec.name} : ${scan.created} opportunités détectées`);
    }
    console.log(`Seed de démonstration terminé en ${((Date.now() - started) / 1000).toFixed(1)} s.`);
    console.log(`Comptes : ${DEMO_USERS.map((u) => u.email).join(", ")} — mot de passe : ${DEMO_PASSWORD}`);
  } finally {
    await pool.end();
  }
}

async function seedOrganization(db: Db, spec: OrgSpec, orgId: string, commercialIds: string[], today: string) {
  const r = rng(spec.seed);
  const start = toIsoDate(addDays(today, -365));

  // ---------------- Produits ----------------
  type P = { id: string; reference: string; name: string; category: string; vat: string; price: string | null; upc: number; availability: string; isNew: boolean };
  const products: P[] = [];
  const productRows: unknown[][] = [];
  for (let i = 0; i < 200; i++) {
    const cat = spec.categories[i % spec.categories.length]!;
    const name = `${r.pick(cat.words)} ${r.pick(QUALIFIERS)}`;
    const base = cat.price[0] + r.next() * (cat.price[1] - cat.price[0]);
    const price = i % 67 === 66 ? null : dec(base).toDecimalPlaces(2).toFixed(2); // quelques produits sans prix connu
    const upc = r.pick([1, 6, 6, 12, 12, 24, 48]);
    const isNew = i >= 185; // 15 nouveautés
    const availability = isNew ? "in_stock" : r.pick(["in_stock", "in_stock", "in_stock", "in_stock", "low_stock", "out_of_stock", "unknown", "on_order"]);
    const id = crypto.randomUUID();
    const reference = `${spec.prefix}-${String(10001 + i)}`;
    products.push({ id, reference, name, category: cat.name, vat: cat.vat, price, upc, availability, isNew });
    productRows.push([
      id, orgId, reference, demoEan(spec.seed * 1000 + i), r.pick(spec.brands), name,
      `${name} — article de démonstration (${cat.name.toLowerCase()}).`, cat.name, upc, upc, price, cat.vat, availability,
      availability === "on_order" ? toIsoDate(addDays(today, r.int(7, 40))) : null,
      upc > 1 ? upc : r.pick([null, 2, 4]),
      [`Best-seller de la gamme ${cat.name.toLowerCase()}`, "Conditionnement adapté au linéaire"].slice(0, r.int(0, 2)),
      isNew, isNew ? toIsoDate(addDays(today, -r.int(5, 60))) : null,
      Number((r.next() * 2 + 0.1).toFixed(3)),
    ]);
  }
  await insertMany(db, "products", [
    "id", "organization_id", "reference", "ean", "brand", "name", "description", "category", "units_per_case", "pcb", "sale_price_ht",
    "vat_rate", "availability", "available_from", "min_order_qty", "marketing_points", "is_new", "launched_at", "weight_kg",
  ], productRows);
  await insertMany(db, "product_purchase_costs", ["organization_id", "product_id", "purchase_price_ht"],
    products.filter((p) => p.price).map((p) => [orgId, p.id, dec(p.price!).times(0.55 + r.next() * 0.15).toDecimalPlaces(4).toFixed(4)]));
  await insertMany(db, "inventory_snapshots", ["organization_id", "product_id", "qty_on_hand", "qty_available", "source"],
    products.map((p) => {
      const q = p.availability === "out_of_stock" ? 0 : p.availability === "low_stock" ? r.int(5, 40) : p.availability === "unknown" ? null : r.int(80, 2500);
      return q === null ? null : [orgId, p.id, q, Math.max(0, q - r.int(0, 30)), "demo"];
    }).filter(Boolean) as unknown[][]);

  // Visuels de démonstration (dégradés générés, signalés "demo_placeholder") pour 1 produit sur 3
  const imageRows: unknown[][] = [];
  for (const [i, p] of products.entries()) {
    if (i % 3 !== 0) continue;
    const path = storagePath(orgId, "products", `${p.id}.png`);
    const shade = (k: number) => Math.min(255, Math.max(0, k + r.int(-30, 30)));
    await putFile(path, gradientPng(240, 240, [shade(spec.color[0]), shade(spec.color[1]), shade(spec.color[2])], [241, 245, 249]));
    imageRows.push([orgId, p.id, path, "demo_placeholder", true, `Visuel de démonstration — ${p.name}`, true]);
  }
  await insertMany(db, "product_images", ["organization_id", "product_id", "storage_path", "kind", "is_primary", "alt", "approved"], imageRows);

  // ---------------- Clients & contacts ----------------
  type C = { id: string; name: string; profile: "regular" | "dormant" | "declining" | "new" | "occasional" | "hero"; cycle: number; basket: P[]; qtyFactor: number; ownerId: string };
  const customers: C[] = [];
  const customerRows: unknown[][] = [];
  const contactRows: unknown[][] = [];
  const linkRows: unknown[][] = [];
  const contactIds: string[] = [];
  const sellable = products.filter((p) => !p.isNew && p.price);
  for (let i = 0; i < 100; i++) {
    const id = crypto.randomUUID();
    const hero = i === 0;
    const name = hero
      ? spec.key === "A" ? "Maison Martin & Fils" : "Épicerie Fine Lambert"
      : `${r.pick(spec.key === "A" ? SHOP_A : SHOP_B)} ${r.pick(PLACES)}${r.chance(0.3) ? ` ${r.pick(["SARL", "SAS", "& Cie"])}` : ""}`;
    const [city, zip] = r.pick(CITIES);
    const roll = r.next();
    const profile: C["profile"] = hero ? "hero" : roll < 0.55 ? "regular" : roll < 0.72 ? "dormant" : roll < 0.82 ? "declining" : roll < 0.92 ? "new" : "occasional";
    const cycle = hero ? 30 : r.pick([21, 28, 30, 35, 42, 45, 60]);
    const basket = hero ? sellable.filter((p) => p.availability === "in_stock").slice(0, 4) : r.shuffle(sellable).slice(0, r.int(4, 11));
    const ownerId = r.pick(commercialIds);
    customers.push({ id, name, profile, cycle, basket, qtyFactor: 0.6 + r.next() * 1.8, ownerId });
    customerRows.push([
      id, orgId, `C${String(i + 1).padStart(5, "0")}`, `${name}${hero ? "" : ""}`, name, "FR", `${r.int(1, 120)} rue ${r.pick(LAST)}`, zip, city,
      `+33 1 ${r.int(10, 99)} ${r.int(10, 99)} ${r.int(10, 99)} ${r.int(10, 99)}`, `contact@${slug(name)}.demo`, `https://${slug(name)}.demo`,
      ownerId, r.pick(SEGMENTS), profile === "dormant" ? "dormant" : "active", r.pick(["30 jours fin de mois", "45 jours", "Comptant", "60 jours"]),
      r.pick([null, "150.00", "250.00", "300.00"]), r.pick([null, "500.00", "800.00", "1000.00"]),
    ]);
    const nContacts = hero ? 1 : r.int(1, 3);
    for (let k = 0; k < nContacts; k++) {
      const cid = crypto.randomUUID();
      const first = hero ? (spec.key === "A" ? "Philippe" : "Hélène") : r.pick(FIRST);
      const last = hero ? (spec.key === "A" ? "Martin" : "Lambert") : r.pick(LAST);
      const salutation = hero ? (spec.key === "A" ? "M." : "Mme") : r.pick(["M.", "Mme"]);
      contactIds.push(cid);
      const mobile = `+336${String(r.int(10000000, 99999999))}`;
      // 1 client sur 6 n'est joignable que par WhatsApp (pas de consentement email) : LÉA discute avec lui sur WhatsApp.
      const whatsappOnly = !hero && i % 6 === 2 && k === 0;
      contactRows.push([cid, orgId, salutation, first, last, `${slug(first)}.${slug(last)}${i}${k}@${slug(name)}.demo`, `+33 6 ${mobile.slice(4, 6)} ${mobile.slice(6, 8)} ${mobile.slice(8, 10)} ${mobile.slice(10, 12)}`, mobile,
        k === 0 ? "Gérant" : r.pick(FUNCTIONS), whatsappOnly ? false : !hero ? r.chance(0.85) : true, r.chance(0.3), whatsappOnly || hero || r.chance(0.2), "Démo — consentement fictif"]);
      linkRows.push([orgId, id, cid, k === 0 ? "Gérant" : r.pick(FUNCTIONS), k === 0, true]);
    }
  }
  await insertMany(db, "customers", [
    "id", "organization_id", "external_code", "legal_name", "trade_name", "country", "address_line1", "postal_code", "city", "phone", "email", "website",
    "owner_user_id", "segment", "status", "payment_terms", "min_order_amount", "franco_amount",
  ], customerRows);
  await insertMany(db, "contacts", ["id", "organization_id", "salutation", "first_name", "last_name", "email", "phone", "mobile", "title", "consent_email", "consent_sms", "consent_whatsapp", "consent_source"], contactRows);
  // Contacts partagés : quelques contacts rattachés à une seconde société (ex. acheteur d'un groupement)
  for (let k = 0; k < 6; k++) linkRows.push([orgId, customers[10 + k * 7]!.id, contactIds[k * 11 + 3]!, "Acheteur groupement", false, true]);
  await insertMany(db, "customer_contacts", ["organization_id", "customer_id", "contact_id", "job_function", "is_primary", "can_receive_offers"], dedupeLinks(linkRows));

  // Tarifs spécifiques : 1 client sur 5
  const priceRows: unknown[][] = [];
  const customerPrice = new Map<string, string>();
  for (const cu of customers) {
    if (cu.profile !== "hero" && !r.chance(0.2)) continue;
    for (const p of cu.basket.slice(0, r.int(2, 4))) {
      const v = dec(p.price!).times(0.9 + r.next() * 0.05).toDecimalPlaces(4).toFixed(4);
      customerPrice.set(`${cu.id}:${p.id}`, v);
      priceRows.push([orgId, p.id, cu.id, "client", v, 1, toIsoDate(addDays(today, -400)), null]);
    }
  }
  await insertMany(db, "product_prices", ["organization_id", "product_id", "customer_id", "price_list", "unit_price_ht", "min_qty", "valid_from", "valid_to"], priceRows);

  // ---------------- Factures ----------------
  const invRows: unknown[][] = [];
  const lineRows: unknown[][] = [];
  let invNo = 1;
  for (const cu of customers) {
    let date: string;
    let stopAt = today;
    if (cu.profile === "new") date = toIsoDate(addDays(today, -r.int(70, 110)));
    else if (cu.profile === "hero") date = toIsoDate(addDays(today, -27 - 30 * 10));
    else date = toIsoDate(addDays(start, r.int(0, cu.cycle)));
    if (cu.profile === "dormant") stopAt = toIsoDate(addDays(today, -r.int(150, 240)));
    if (cu.profile === "hero") stopAt = toIsoDate(addDays(today, -20));
    while (date <= stopAt) {
      const age = Math.round((Date.parse(today) - Date.parse(date)) / 86_400_000);
      const decline = cu.profile === "declining" && age < 120 ? 0.35 : 1;
      const lines = cu.basket.filter((_, idx) => cu.profile === "hero" || idx < 3 || r.chance(0.55));
      if (!lines.length) lines.push(cu.basket[0]!);
      const invId = crypto.randomUUID();
      const lineData: { total: string; vat: string }[] = [];
      lines.forEach((p, idx) => {
        const cases = Math.max(1, Math.round((cu.profile === "hero" ? 3 : r.int(1, 6)) * cu.qtyFactor * decline));
        const qty = p.upc > 1 ? cases * p.upc : cases * r.int(2, 10);
        const unit = customerPrice.get(`${cu.id}:${p.id}`) ?? p.price!;
        const discount = r.chance(0.08) ? "2.00" : "0";
        const total = lineTotal(qty, unit, discount).toFixed(2);
        lineData.push({ total, vat: p.vat });
        lineRows.push([orgId, invId, idx + 1, p.id, p.reference, p.name, qty, "U", unit, discount, p.vat, total, p.upc]);
      });
      const t = computeTotals(lineData.map((l) => ({ totalHt: l.total, vatRate: l.vat })));
      const cancelled = r.chance(0.01);
      const paid = age > 75 ? (r.chance(0.95) ? "paid" : "overdue") : age > 45 ? r.pick(["paid", "paid", "unpaid", "overdue"]) : "unpaid";
      invRows.push([invId, orgId, `${spec.prefix}-F${String(invNo++).padStart(6, "0")}`, cu.id, date, t.totalHt.toFixed(2), t.totalVat.toFixed(2), t.totalTtc.toFixed(2), "invoice", cancelled ? "cancelled" : "issued", cancelled ? "unknown" : paid, null]);
      // Avoir partiel occasionnel (retour marchandise)
      if (!cancelled && r.chance(0.03)) {
        const first = lineRows[lineRows.length - lines.length]!;
        const ht = round2(dec(first[11] as string).times(0.5)).toFixed(2);
        const vat = round2(dec(ht).times(dec(first[10] as string)).dividedBy(100)).toFixed(2);
        const cnId = crypto.randomUUID();
        invRows.push([cnId, orgId, `${spec.prefix}-A${String(invNo++).padStart(6, "0")}`, cu.id, toIsoDate(addDays(date, r.int(3, 15))), ht, vat, round2(dec(ht).plus(vat)).toFixed(2), "credit_note", "issued", "paid", invId]);
        lineRows.push([orgId, cnId, 1, first[3], first[4], `Avoir — ${first[5]}`, dec(first[6] as number).dividedBy(2).toFixed(3), "U", first[8], "0", first[10], ht, first[12]]);
      }
      const jitter = cu.profile === "hero" ? 30 : Math.round(cu.cycle * (0.85 + r.next() * 0.3));
      date = toIsoDate(addDays(date, cu.profile === "occasional" ? jitter * 3 : jitter));
    }
  }
  // Les avoirs référencent une facture : insérer d'abord les factures, puis les avoirs.
  const invCols = ["id", "organization_id", "invoice_number", "customer_id", "invoice_date", "total_ht", "total_vat", "total_ttc", "doc_type", "status", "payment_status", "related_invoice_id"];
  await insertMany(db, "invoices", invCols, invRows.filter((x) => x[8] === "invoice"));
  await insertMany(db, "invoices", invCols, invRows.filter((x) => x[8] === "credit_note"));
  await insertMany(db, "invoice_lines", ["organization_id", "invoice_id", "line_no", "product_id", "product_reference", "description", "quantity", "unit", "unit_price_ht", "discount_pct", "vat_rate", "line_total_ht", "units_per_case"], lineRows);

  // ---------------- Missions : objectifs de CA, rendez-vous passés, retours en stock ----------------
  const rev12 = new Map<string, number>();
  const since = toIsoDate(addDays(today, -365));
  for (const x of invRows) {
    if (x[9] === "cancelled" || (x[4] as string) <= since) continue;
    const sign = x[8] === "credit_note" ? -1 : 1;
    rev12.set(x[3] as string, (rev12.get(x[3] as string) ?? 0) + sign * Number(x[5]));
  }
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const targetRows: unknown[][] = [];
  customers.forEach((cu, i) => {
    const rev = rev12.get(cu.id) ?? 0;
    if (rev < 2000 || (i % 2 === 1 && cu.profile !== "hero")) return; // un client sur deux a un objectif
    const factor = cu.profile === "hero" ? 1.25 : cu.profile === "declining" ? 1.15 : 0.95 + r.next() * 0.3;
    targetRows.push([orgId, cu.id, "year", yearStart, (Math.round((rev * factor) / 100) * 100).toFixed(2), commercialIds[0]]);
  });
  await insertMany(db, "customer_targets", ["organization_id", "customer_id", "period_type", "period_start", "target_ht", "created_by"], targetRows);
  const apptRows: unknown[][] = [];
  customers.forEach((cu) => {
    if (cu.profile === "hero" || !r.chance(0.45)) return;
    const d = addDays(today, -r.int(20, 420));
    d.setUTCHours(r.pick([8, 9, 13, 14]), 0, 0, 0);
    apptRows.push([orgId, cu.id, r.pick(["visio", "showroom", "call", "visit"]), d.toISOString(), "done", "Rendez-vous de démonstration"]);
  });
  await insertMany(db, "appointments", ["organization_id", "customer_id", "kind", "starts_at", "status", "notes"], apptRows);
  // Retours en stock : produits très achetés, en rupture il y a 3 semaines et de nouveau disponibles
  const freq = new Map<string, number>();
  for (const l of lineRows) freq.set(l[3] as string, (freq.get(l[3] as string) ?? 0) + 1);
  const restocked = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).filter((id) => !customers[0]!.basket.some((p) => p.id === id)).slice(3, 9);
  for (const pid of restocked) {
    await db.query(`insert into inventory_snapshots (organization_id, product_id, qty_on_hand, qty_available, captured_at, source) values ($1,$2,0,0,$3,'demo')`, [orgId, pid, addDays(today, -21).toISOString()]);
    await db.query(`insert into inventory_snapshots (organization_id, product_id, qty_on_hand, qty_available, captured_at, source) values ($1,$2,480,460,$3,'demo')`, [orgId, pid, addDays(today, -1).toISOString()]);
    await db.query(`update products set availability = 'in_stock', available_from = null where id = $1`, [pid]);
  }

  // ---------------- Campagnes ----------------
  const camp = await db.query<{ id: string }>(
    `insert into campaigns (organization_id, name, description, starts_on, ends_on, discount_pct, status, target_categories)
     values ($1, $2, 'Campagne de démonstration', $3, $4, 0, 'active', $5) returning id`,
    [orgId, spec.key === "A" ? "Collection Automne" : "Rentrée gourmande", toIsoDate(addDays(today, -10)), toIsoDate(addDays(today, 40)), [spec.categories[0]!.name]],
  );
  const campaignProducts = sellable.filter((p) => p.category === spec.categories[0]!.name).slice(0, 8);
  await insertMany(db, "campaign_products", ["organization_id", "campaign_id", "product_id", "special_price_ht"], campaignProducts.map((p) => [orgId, camp.rows[0]!.id, p.id, null]));
  await db.query(`insert into campaigns (organization_id, name, starts_on, ends_on, status) values ($1, 'Opération été (terminée)', $2, $3, 'ended')`, [orgId, toIsoDate(addDays(today, -150)), toIsoDate(addDays(today, -100))]);

  // ---------------- Connexions (état réel : rien n'est connecté) ----------------
  const conns: [string, string, string, boolean, string][] = [
    ["email", "simulated", "not_connected", true, "Email — mode simulation (aucun envoi réel)"],
    ["whatsapp", "simulated", "not_connected", true, "WhatsApp — mode simulation (aucun envoi réel)"],
    ["email", "gmail", "needs_configuration", false, "Gmail (Google Workspace)"],
    ["email", "microsoft365", "needs_configuration", false, "Microsoft 365"],
    ["whatsapp", "whatsapp_cloud", "not_connected", false, "WhatsApp Business Platform"],
    ["linkedin", "linkedin", "not_connected", false, "LinkedIn"],
    ["sms", "sms_provider", "not_connected", false, "SMS professionnel"],
    ["phone", "telephony", "not_connected", false, "Téléphonie"],
  ];
  // Modèles WhatsApp déclarés (en réel : à faire approuver par Meta avec les textes de features/conversations/templates.ts)
  await insertMany(db, "communication_connections", ["organization_id", "channel", "provider", "status", "simulation_enabled", "display_name", "config"],
    conns.map((x) => [orgId, ...x, x[0] === "whatsapp" ? { approvedTemplates: ["offre_disponible", "relance_offre", "proposition_rdv"], templatesStatus: x[1] === "simulated" ? "déclarés (simulation)" : "à soumettre à Meta" } : {}]));

  // ---------------- Conversations historiques simulées ----------------
  for (const cu of customers.slice(1, 6)) {
    const contact = (await db.query<{ contact_id: string; email: string }>(
      `select cc.contact_id, c.email from customer_contacts cc join contacts c on c.id = cc.contact_id where cc.customer_id = $1 and cc.is_primary limit 1`, [cu.id])).rows[0];
    if (!contact) continue;
    const conv = await db.query<{ id: string }>(
      `insert into conversations (organization_id, customer_id, contact_id, channel, subject, status, assigned_user_id, last_message_at)
       values ($1,$2,$3,'email',$4,'closed',$5, $6) returning id`,
      [orgId, cu.id, contact.contact_id, "Commande du mois", cu.ownerId, addDays(today, -12).toISOString()],
    );
    await insertMany(db, "messages", ["organization_id", "conversation_id", "direction", "channel", "from_address", "to_address", "subject", "body", "status", "sent_at", "received_at", "handled", "provider_message_id"], [
      [orgId, conv.rows[0]!.id, "outbound", "email", "commercial@demo.follow.ai", contact.email, "Commande du mois", "Bonjour,\n\nVoici notre proposition pour votre commande du mois.\n\nBien cordialement.", "simulated_sent", addDays(today, -14).toISOString(), null, true, `demo-${crypto.randomUUID()}`],
      [orgId, conv.rows[0]!.id, "inbound", "email", contact.email, "commercial@demo.follow.ai", "RE: Commande du mois", "Bonjour,\n\nC'est validé pour nous, merci.\n\nCordialement.", "received", null, addDays(today, -12).toISOString(), true, `demo-${crypto.randomUUID()}`],
    ]);
  }

  // ---------------- Discussions WhatsApp historiques (clients joignables uniquement par WhatsApp) ----------------
  for (const idx of [2, 8, 14]) {
    const cu = customers[idx]!;
    const ct = (await db.query<{ contact_id: string; mobile: string }>(
      `select cc.contact_id, c.mobile from customer_contacts cc join contacts c on c.id = cc.contact_id where cc.customer_id = $1 and cc.is_primary limit 1`, [cu.id])).rows[0];
    if (!ct) continue;
    const t0 = addDays(today, -9);
    const at = (h: number) => new Date(t0.getTime() + h * 3_600_000).toISOString();
    const conv = await db.query<{ id: string }>(
      `insert into conversations (organization_id, customer_id, contact_id, channel, subject, status, last_message_at, last_inbound_at) values ($1,$2,$3,'whatsapp',null,'closed',$4,$5) returning id`,
      [orgId, cu.id, ct.contact_id, at(9.3), at(9.1)]);
    await insertMany(db, "messages", ["organization_id", "conversation_id", "direction", "channel", "from_address", "to_address", "body", "status", "sent_at", "received_at", "handled", "ai_generated", "provider_message_id"], [
      [orgId, conv.rows[0]!.id, "inbound", "whatsapp", ct.mobile, null, "Bonjour, ma dernière livraison est-elle partie ?", "received", null, at(9), true, false, `demo-wa-${crypto.randomUUID()}`],
      [orgId, conv.rows[0]!.id, "outbound", "whatsapp", "LÉA (WhatsApp Business)", ct.mobile, "Bonjour ! Je vérifie auprès de la logistique et votre commercial vous confirme la date d'expédition dans la journée.", "simulated_sent", at(9.05), null, true, true, `demo-wa-${crypto.randomUUID()}`],
      [orgId, conv.rows[0]!.id, "inbound", "whatsapp", ct.mobile, null, "Super, merci 👍", "received", null, at(9.1), true, false, `demo-wa-${crypto.randomUUID()}`],
    ]);
  }

  // ---------------- Templates créatifs (versionnés, privés) ----------------
  for (const t of DEFAULT_TEMPLATES) {
    await db.query(`insert into creative_templates (organization_id, kind, name, version, definition) values ($1,$2,$3,1,$4)`, [
      orgId, t.kind, t.name, { ...t.definition, primaryColor: spec.brandHex },
    ]);
  }

  // Mémoire commerciale initiale du client vedette (instruction déclarée par le commercial)
  const hero = customers[0]!;
  await db.query(
    `insert into agent_memory (organization_id, customer_id, kind, certainty, content, source, created_by_agent)
     values ($1,$2,'preference','declared',$3,'Note du commercial (démo)', false)`,
    [orgId, hero.id, "Préfère recevoir les propositions par email en début de semaine."],
  );
  await db.query(`insert into audit_logs (organization_id, actor_type, actor_user_id, action, metadata) values ($1,'user',$2,'demo.seeded',$3)`, [orgId, commercialIds[0], { customers: 100, products: 200 }]);
}

function slug(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function dedupeLinks(rows: unknown[][]) {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = `${r[1]}:${r[2]}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
