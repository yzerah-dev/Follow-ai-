/**
 * Définition des formats d'import : champs cibles, synonymes d'en-têtes (FR/EN), types et obligations.
 * Voir docs/IMPORT_FORMATS.md.
 */
export type FieldType = "string" | "decimal" | "integer" | "date" | "boolean" | "email" | "ean" | "enum";

export type FieldDef = { key: string; label: string; type: FieldType; required?: boolean; synonyms: string[]; values?: string[] };

export type EntityKind = "customers" | "contacts" | "products" | "prices" | "inventory" | "invoices";

export const ENTITY_LABEL: Record<EntityKind, string> = {
  customers: "Clients",
  contacts: "Contacts",
  products: "Produits",
  prices: "Tarifs",
  inventory: "Stocks",
  invoices: "Factures (lignes détaillées)",
};

export const ENTITIES: Record<EntityKind, FieldDef[]> = {
  customers: [
    { key: "external_code", label: "Code client", type: "string", required: true, synonyms: ["code client", "code", "customer code", "id client", "numero client", "n° client"] },
    { key: "legal_name", label: "Raison sociale", type: "string", required: true, synonyms: ["raison sociale", "nom", "societe", "société", "company", "name", "legal name"] },
    { key: "trade_name", label: "Nom commercial", type: "string", synonyms: ["nom commercial", "enseigne", "trade name"] },
    { key: "address_line1", label: "Adresse", type: "string", synonyms: ["adresse", "address", "rue"] },
    { key: "postal_code", label: "Code postal", type: "string", synonyms: ["code postal", "cp", "zip", "postal code"] },
    { key: "city", label: "Ville", type: "string", synonyms: ["ville", "city", "localite"] },
    { key: "country", label: "Pays (ISO)", type: "string", synonyms: ["pays", "country"] },
    { key: "phone", label: "Téléphone", type: "string", synonyms: ["telephone", "téléphone", "tel", "phone"] },
    { key: "email", label: "Email", type: "email", synonyms: ["email", "e-mail", "mail", "courriel"] },
    { key: "website", label: "Site web", type: "string", synonyms: ["site", "site web", "website", "url"] },
    { key: "segment", label: "Segment", type: "string", synonyms: ["segment", "categorie client", "type client"] },
    { key: "payment_terms", label: "Conditions de paiement", type: "string", synonyms: ["conditions de paiement", "paiement", "payment terms", "reglement"] },
    { key: "min_order_amount", label: "Minimum de commande", type: "decimal", synonyms: ["minimum de commande", "minimum commande", "min order"] },
    { key: "franco_amount", label: "Franco", type: "decimal", synonyms: ["franco", "franco de port"] },
  ],
  contacts: [
    { key: "customer_code", label: "Code client", type: "string", required: true, synonyms: ["code client", "customer code"] },
    { key: "email", label: "Email", type: "email", required: true, synonyms: ["email", "e-mail", "mail"] },
    { key: "salutation", label: "Civilité (M./Mme)", type: "enum", values: ["M.", "Mme"], synonyms: ["civilite", "civilité", "salutation", "titre"] },
    { key: "first_name", label: "Prénom", type: "string", synonyms: ["prenom", "prénom", "first name"] },
    { key: "last_name", label: "Nom", type: "string", synonyms: ["nom", "last name", "nom de famille"] },
    { key: "phone", label: "Téléphone", type: "string", synonyms: ["telephone", "tel", "phone", "mobile"] },
    { key: "job_function", label: "Fonction", type: "string", synonyms: ["fonction", "poste", "job title", "title"] },
    { key: "consent_email", label: "Consentement email", type: "boolean", synonyms: ["consentement email", "optin", "opt-in", "consent"] },
  ],
  products: [
    { key: "reference", label: "Référence", type: "string", required: true, synonyms: ["reference", "référence", "ref", "sku", "code article", "article"] },
    { key: "name", label: "Désignation", type: "string", required: true, synonyms: ["designation", "désignation", "libelle", "libellé", "nom", "name", "description courte"] },
    { key: "ean", label: "EAN", type: "ean", synonyms: ["ean", "gencod", "ean13", "code barre", "barcode"] },
    { key: "brand", label: "Marque", type: "string", synonyms: ["marque", "brand"] },
    { key: "description", label: "Description", type: "string", synonyms: ["description", "descriptif"] },
    { key: "category", label: "Catégorie", type: "string", synonyms: ["categorie", "catégorie", "famille", "rayon", "category"] },
    { key: "units_per_case", label: "Colisage", type: "integer", synonyms: ["colisage", "uc", "units per case", "qte par colis", "carton"] },
    { key: "pcb", label: "PCB", type: "integer", synonyms: ["pcb"] },
    { key: "sale_price_ht", label: "Prix de vente HT", type: "decimal", synonyms: ["prix de vente ht", "prix ht", "pv ht", "prix", "price", "tarif"] },
    { key: "vat_rate", label: "Taux de TVA", type: "decimal", synonyms: ["tva", "taux tva", "vat"] },
    { key: "min_order_qty", label: "Minimum de commande", type: "integer", synonyms: ["minimum de commande", "moq", "min commande"] },
    { key: "weight_kg", label: "Poids (kg)", type: "decimal", synonyms: ["poids", "weight"] },
  ],
  prices: [
    { key: "product_reference", label: "Référence produit", type: "string", required: true, synonyms: ["reference", "référence", "ref", "sku"] },
    { key: "customer_code", label: "Code client (vide = général)", type: "string", synonyms: ["code client", "customer code", "client"] },
    { key: "unit_price_ht", label: "Prix unitaire HT", type: "decimal", required: true, synonyms: ["prix", "prix ht", "pu ht", "price", "tarif"] },
    { key: "min_qty", label: "Quantité minimale", type: "integer", synonyms: ["quantite minimale", "qte min", "min qty"] },
    { key: "valid_from", label: "Début de validité", type: "date", synonyms: ["debut", "valide du", "valid from", "date debut"] },
    { key: "valid_to", label: "Fin de validité", type: "date", synonyms: ["fin", "valide au", "valid to", "date fin"] },
  ],
  inventory: [
    { key: "product_reference", label: "Référence produit", type: "string", required: true, synonyms: ["reference", "référence", "ref", "sku"] },
    { key: "qty_on_hand", label: "Stock physique", type: "decimal", required: true, synonyms: ["stock", "stock physique", "quantite", "qty", "on hand"] },
    { key: "qty_available", label: "Stock disponible", type: "decimal", synonyms: ["stock disponible", "disponible", "available"] },
  ],
  invoices: [
    { key: "invoice_number", label: "Numéro de facture", type: "string", required: true, synonyms: ["numero facture", "n° facture", "facture", "invoice number", "invoice", "numero"] },
    { key: "doc_type", label: "Type (facture/avoir)", type: "enum", values: ["invoice", "credit_note"], synonyms: ["type", "type document", "type de document"] },
    { key: "customer_code", label: "Code client", type: "string", required: true, synonyms: ["code client", "client", "customer code"] },
    { key: "invoice_date", label: "Date", type: "date", required: true, synonyms: ["date", "date facture", "invoice date"] },
    { key: "status", label: "Statut (émise/annulée)", type: "enum", values: ["issued", "cancelled"], synonyms: ["statut", "status", "etat"] },
    { key: "payment_status", label: "Règlement", type: "enum", values: ["unknown", "unpaid", "partially_paid", "paid", "overdue"], synonyms: ["reglement", "règlement", "paiement", "payment status"] },
    { key: "product_reference", label: "Référence produit", type: "string", synonyms: ["reference", "référence", "ref", "sku", "article"] },
    { key: "ean", label: "EAN", type: "ean", synonyms: ["ean", "gencod"] },
    { key: "description", label: "Désignation", type: "string", required: true, synonyms: ["designation", "désignation", "libelle", "libellé", "description"] },
    { key: "quantity", label: "Quantité", type: "decimal", required: true, synonyms: ["quantite", "quantité", "qte", "qty", "quantity"] },
    { key: "unit_price_ht", label: "Prix unitaire HT", type: "decimal", required: true, synonyms: ["prix unitaire", "pu ht", "prix unitaire ht", "unit price"] },
    { key: "discount_pct", label: "Remise %", type: "decimal", synonyms: ["remise", "remise %", "discount"] },
    { key: "vat_rate", label: "TVA %", type: "decimal", synonyms: ["tva", "taux tva", "vat"] },
    { key: "line_total_ht", label: "Montant ligne HT", type: "decimal", synonyms: ["montant ht", "total ligne", "montant ligne ht", "line total"] },
  ],
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9%°]+/g, " ").trim();

/** Mapping automatique : en-tête du fichier -> champ cible (null si aucun). */
export function suggestMapping(entity: EntityKind, headers: string[]): Record<string, string | null> {
  const used = new Set<string>();
  const out: Record<string, string | null> = {};
  for (const h of headers) {
    const n = norm(h);
    const f = ENTITIES[entity].find((d) => !used.has(d.key) && (norm(d.key.replace(/_/g, " ")) === n || norm(d.label) === n || d.synonyms.some((s) => norm(s) === n)));
    out[h] = f?.key ?? null;
    if (f) used.add(f.key);
  }
  return out;
}
