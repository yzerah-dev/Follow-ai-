import { z } from "zod";

/** Définition d'un template créatif (versionné, privé par organisation). */
export const templateDefinitionSchema = z.object({
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#0F172A"),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#F59E0B"),
  showProductImages: z.boolean().default(true),
  showEan: z.boolean().default(true),
  showUnitsPerCase: z.boolean().default(true),
  footerText: z.string().max(300).default(""),
  columns: z.number().int().min(1).max(4).default(2),
  title: z.string().max(120).optional(),
});
export type TemplateDefinition = z.infer<typeof templateDefinitionSchema>;

export type TemplateKind = "product_sheet" | "offer_pdf" | "offer_excel" | "catalog" | "poster";

export const DEFAULT_TEMPLATES: { kind: TemplateKind; name: string; definition: Partial<TemplateDefinition> }[] = [
  { kind: "offer_pdf", name: "Offre commerciale — standard", definition: { footerText: "Offre valable dans la limite des stocks disponibles. Prix HT, hors frais de port sauf franco atteint." } },
  { kind: "offer_excel", name: "Offre Excel illustrée — standard", definition: { showProductImages: true } },
  { kind: "product_sheet", name: "Fiche produit — standard", definition: {} },
  { kind: "catalog", name: "Catalogue multiproduit — 2 colonnes", definition: { columns: 2 } },
  { kind: "poster", name: "Affiche promotionnelle — A4", definition: {} },
];

export function parseTemplate(def: unknown, brand: { primaryColor?: string } = {}): TemplateDefinition {
  return templateDefinitionSchema.parse({ primaryColor: brand.primaryColor ?? "#2563EB", ...(def as object) });
}

export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = {
  product_sheet: "Fiche produit PDF",
  offer_pdf: "Offre PDF",
  offer_excel: "Offre Excel illustrée",
  catalog: "Catalogue multiproduit",
  poster: "Affiche promotionnelle",
};
