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
    text: "Bonjour {{1}}, j'espère que vous allez bien et que tout se passe bien de votre côté ! {{2}} Je vous ai préparé une proposition ({{3}}) de {{4}} HT, valable jusqu'au {{5}}, je vous la joins. Souhaitez-vous que je la valide ?\nMerci d'avance pour votre retour,\nLéa de chez {{6}}",
  },
  // Client dormant (catégorie « marketing ») : reprise de contact chaleureuse + offre + rendez-vous avec le commercial attitré.
  // {{4}} = contenu réel de l'offre, {{5}} = prénom du commercial attitré (ou « votre commercial ») : jamais de créneau inventé.
  reactivation_client: {
    language: "fr",
    text: "Bonjour {{1}}, j'espère que vous allez bien ! Cela fait longtemps que nous ne vous avons pas vu chez {{2}} ! J'ai pensé à vous et je vous ai préparé une offre ({{3}}) {{4}}, je vous la joins. Ce serait bien que l'on puisse programmer un rendez-vous pour en discuter et avancer : {{5}} se fera un plaisir de vous recevoir au showroom ou de vous voir en visio. Quel jour vous arrangerait ?\nMerci d'avance pour votre retour,\nLéa de chez {{6}}",
  },
  // Relance (règles JONAS) : ni numéro d'offre, ni date de fin, ni marchandise « réservée », ni baisse de quantités proposée.
  // En-tête document : l'Excel de l'offre, que le client renvoie avec ses quantités.
  relance_offre: {
    language: "fr",
    text: "Bonjour {{1}}, j'espère que vous allez bien ! Je reviens vers vous au sujet de la sélection que je vous ai préparée. Si vous souhaitez ajuster les quantités, renvoyez-moi simplement l'Excel avec vos quantités adaptées et je m'occupe du reste. Souhaitez-vous que je vous prépare la commande ?\nMerci d'avance pour votre retour,\nLéa de chez {{2}}",
  },
  proposition_rdv: {
    language: "fr",
    text: "Bonjour {{1}}, j'espère que vous allez bien ! Je vous propose un point de 20 minutes {{2}} pour faire le tour de vos références et vous présenter nos nouveautés. Quel créneau vous conviendrait ?\nMerci d'avance pour votre retour,\nLéa de chez {{3}}",
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
