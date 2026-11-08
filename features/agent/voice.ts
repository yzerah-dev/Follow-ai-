/**
 * Voix de LÉA, configurable par organisation (Paramètres → Voix de LÉA).
 * Elle change la FORME des messages (ton, longueur, présentation, emojis WhatsApp, appel à l'action),
 * jamais le fond : prix, stock, remises et arguments chiffrés restent fournis par le système.
 */
import { z } from "zod";
import { wrapUntrusted } from "@/lib/security/untrusted";

export const VOICE_TONES = ["warm", "dynamic", "formal", "expert"] as const;
export const VOICE_TONE_LABEL: Record<(typeof VOICE_TONES)[number], string> = {
  warm: "Chaleureux et direct",
  dynamic: "Commercial dynamique",
  formal: "Très professionnel",
  expert: "Expert conseil",
};

/** Situations pour les messages modèles (bibliothèque « Former LÉA »). */
export const EXAMPLE_SITUATIONS = ["offre", "nouveaute", "relance", "prix", "dormant", "remerciement", "autre"] as const;
export type ExampleSituation = (typeof EXAMPLE_SITUATIONS)[number];
export const EXAMPLE_SITUATION_LABEL: Record<ExampleSituation, string> = {
  offre: "Proposer une offre",
  nouveaute: "Présenter une nouveauté / un arrivage",
  relance: "Relancer sans réponse",
  prix: "Client qui trouve ça cher",
  dormant: "Client qui ne commande plus",
  remerciement: "Remercier pour une commande",
  autre: "Autre",
};
export const voiceExampleSchema = z.object({
  id: z.string().min(1).max(40),
  situation: z.enum(EXAMPLE_SITUATIONS),
  channel: z.enum(["whatsapp", "email"]).default("whatsapp"),
  text: z.string().trim().min(20).max(1500),
});
export type VoiceExample = z.infer<typeof voiceExampleSchema>;

export const voiceSchema = z.object({
  tone: z.enum(VOICE_TONES).default("warm"),
  length: z.enum(["short", "medium"]).default("short"),
  whatsappEmojis: z.boolean().default(false),
  /** « LÉA, assistante commerciale de {entreprise} » : présentation transparente d'une assistante IA. */
  assistantTitle: z.string().trim().max(80).default("assistante commerciale"),
  /** Consignes de style libres (formules, vocabulaire, positionnement). Jamais de chiffres ici : ils viennent des données. */
  styleNotes: z.string().trim().max(2000).default(""),
  /** Messages modèles écrits par l'équipe : LÉA imite le TON et la structure, jamais les chiffres ni les affirmations. */
  examples: z.array(voiceExampleSchema).max(30).default([]),
});
export type Voice = z.infer<typeof voiceSchema>;

export function parseVoice(raw: unknown): Voice {
  const r = voiceSchema.safeParse(raw ?? {});
  return r.success ? r.data : voiceSchema.parse({});
}

export function voicePrompt(v: Voice, companyName: string): string {
  const tone = {
    warm: "chaleureux, simple et direct",
    dynamic: "commercial dynamique et enthousiaste : tu crées l'envie et l'urgence avec des faits, tu mets en avant les opportunités",
    formal: "très professionnel, soigné, style grand compte",
    expert: "expert conseil : tu expliques pourquoi un produit se vend bien et comment le mettre en avant en magasin",
  }[v.tone];
  return [
    `Ton : ${tone}. Tu vouvoies toujours.`,
    `Présentation : « LÉA, ${v.assistantTitle} de ${companyName} » (tu ne te fais jamais passer pour un humain).`,
    `Signature : « Léa de chez ${companyName} », et rien d'autre. Sur WhatsApp, uniquement sur un premier message ou une nouvelle sollicitation (offre, relance, rendez-vous) ; jamais sur une réponse dans la discussion.`,
    v.length === "medium" ? "Longueur : e-mail de 10 à 15 lignes, avec 2 ou 3 arguments concrets tirés des données." : "Longueur : e-mail de 5 à 8 lignes.",
    v.whatsappEmojis ? "WhatsApp : messages courts, 1 ou 2 emojis maximum (jamais dans un e-mail)." : "Aucun emoji.",
    "Appel à l'action selon la situation : réassort → « répondez OK, je lance la commande » ; client inactif → reprise de contact chaleureuse et offre de retour ; nouveauté → première commande test ; client actif → compléter la prochaine commande.",
    "Objection prix : défends la valeur avec les SEULS faits fournis (meilleure vente, taux de réassort des clients, stock limité, offre exceptionnelle), puis propose d'ajuster les quantités ou une sélection plus courte. Ne cite jamais un autre client.",
    v.styleNotes ? `Consignes de style de l'entreprise :\n${v.styleNotes}` : "",
    v.examples.length ? examplesPrompt(v.examples) : "",
  ].filter(Boolean).join("\n");
}

/**
 * Messages modèles de l'équipe : l'IA en reprend le ton, les formules et la structure (salutation, accroche, question finale).
 * Garde-fous : les prix, stocks, quantités et superlatifs (« imbattable », « peu en stock ») des exemples ne sont JAMAIS repris ;
 * seuls les faits fournis par le système sont utilisés. Les fautes de frappe ne sont pas imitées.
 */
export function examplesPrompt(examples: VoiceExample[]): string {
  const text = examples.map((e, i) => `Exemple ${i + 1} — ${EXAMPLE_SITUATION_LABEL[e.situation]} (${e.channel === "whatsapp" ? "WhatsApp" : "e-mail"}) :\n${e.text}`).join("\n\n");
  return [
    "Messages modèles écrits par l'équipe commerciale : écris COMME EUX (même chaleur, mêmes formules d'ouverture et de clôture, même longueur, même façon de poser la question finale), pour qu'on ne puisse pas distinguer ton message de celui d'un commercial de l'équipe.",
    "Interdit : reprendre un prix, une quantité, un stock, une date ou une affirmation de ces exemples (« prix imbattable », « peu en stock »…) ; n'affirme que ce que disent les données fournies. N'imite pas les fautes d'orthographe.",
    wrapUntrusted("style_examples", text, 12000),
  ].join("\n");
}

/** Signature unique : « Léa de chez <entreprise> ». */
export const signatureName = (companyName: string) => `Léa de chez ${companyName}`;
/** WhatsApp : signature uniquement sur une sollicitation (premier message, nouvelle offre, relance, rendez-vous). */
export const pushSignature = (companyName: string) => `Merci d'avance pour votre retour,\n${signatureName(companyName)}`;

/**
 * Signature et formule d'appel selon la voix (cerveau simulé).
 * WhatsApp : une RÉPONSE dans la discussion n'est pas signée (on ne signe pas chaque message d'une conversation).
 */
export function signoff(v: Voice, senderName: string, companyName: string, channel: "email" | "whatsapp"): string[] {
  const who = signatureName(companyName);
  if (channel === "whatsapp") return [];
  const human = senderName && !/^LÉA/.test(senderName) ? [`Pour ${senderName}`] : [];
  return ["", v.tone === "dynamic" ? "À très vite," : "Bien cordialement,", "", who, ...human];
}

export const emoji = (v: Voice, channel: "email" | "whatsapp", e: string) => (channel === "whatsapp" && v.whatsappEmojis ? ` ${e}` : "");
