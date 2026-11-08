/**
 * Modèles de messages WhatsApp (offre et relance : catégorie « marketing » ; rendez-vous : « utility »). À soumettre à l'approbation de Meta avec EXACTEMENT ces textes.
 * Ils sont obligatoires pour écrire à un client hors de la fenêtre de 24 h (premier contact, relance).
 * Les variables {{n}} sont remplies uniquement avec des données du système (jamais générées par l'IA).
 */
import type { MessageTemplate } from "@/lib/integrations/types";

export const WHATSAPP_TEMPLATES = {
  // Catégorie « marketing » (message commercial). {{2}} = accroche calculée par le système (offerHook), jamais par l'IA.
  offre_disponible: {
    language: "fr",
    text: "Bonjour {{1}} 👋 {{2}} Je vous ai préparé la proposition {{3}} : {{4}} HT, valable jusqu'au {{5}}, le document est joint. Je vous la valide ? Un simple « OK » en réponse suffit, je m'occupe du reste. — Léa de chez {{6}}",
  },
  relance_offre: {
    language: "fr",
    text: "Bonjour {{1}} 👋 Je reviens vers vous au sujet de la proposition {{2}}, elle est toujours valable. Je vous prépare la commande ? Un simple « OK » suffit. — Léa de chez {{3}}",
  },
  proposition_rdv: {
    language: "fr",
    text: "Bonjour {{1}}, je vous propose un point de 20 minutes {{2}} pour faire le tour de vos références et vous présenter nos nouveautés. Quel créneau vous conviendrait ? Répondez simplement à ce message. — Léa de chez {{3}}",
  },
} as const;

export type TemplateName = keyof typeof WHATSAPP_TEMPLATES;

export function buildTemplate(name: TemplateName, params: string[]): { template: MessageTemplate; text: string } {
  const t = WHATSAPP_TEMPLATES[name];
  const expected = (t.text.match(/\{\{\d+\}\}/g) ?? []).length;
  if (params.length !== expected) throw new Error(`Modèle ${name} : ${expected} paramètre(s) attendu(s).`);
  // Meta interdit sauts de ligne et tabulations dans les paramètres ; on borne aussi la longueur.
  const clean = params.map((p) => p.replace(/[\n\t]+/g, " ").replace(/ {4,}/g, " ").slice(0, 200));
  const text = clean.reduce((acc, p, i) => acc.replace(`{{${i + 1}}}`, p), t.text as string);
  return { template: { name, language: t.language, params: clean }, text };
}
