/**
 * Modèles de messages WhatsApp (catégorie « utility »). À soumettre à l'approbation de Meta avec EXACTEMENT ces textes.
 * Ils sont obligatoires pour écrire à un client hors de la fenêtre de 24 h (premier contact, relance).
 * Les variables {{n}} sont remplies uniquement avec des données du système (jamais générées par l'IA).
 */
import type { MessageTemplate } from "@/lib/integrations/types";

export const WHATSAPP_TEMPLATES = {
  offre_disponible: {
    language: "fr",
    text: "Bonjour {{1}}, votre proposition {{2}} est prête : {{3}} HT, valable jusqu'au {{4}}. Le document est joint. Répondez directement à ce message pour commander ou poser une question. — LÉA, {{5}}",
  },
  relance_offre: {
    language: "fr",
    text: "Bonjour {{1}}, je reviens vers vous au sujet de la proposition {{2}}. Souhaitez-vous que je prépare la commande ? Répondez simplement à ce message. — LÉA, {{3}}",
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
