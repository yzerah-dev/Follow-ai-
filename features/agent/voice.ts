/**
 * Voix de LÉA, configurable par organisation (Paramètres → Voix de LÉA).
 * Elle change la FORME des messages (ton, longueur, présentation, emojis WhatsApp, appel à l'action),
 * jamais le fond : prix, stock, remises et arguments chiffrés restent fournis par le système.
 */
import { z } from "zod";

export const VOICE_TONES = ["warm", "dynamic", "formal", "expert"] as const;
export const VOICE_TONE_LABEL: Record<(typeof VOICE_TONES)[number], string> = {
  warm: "Chaleureux et direct",
  dynamic: "Commercial dynamique",
  formal: "Très professionnel",
  expert: "Expert conseil",
};

export const voiceSchema = z.object({
  tone: z.enum(VOICE_TONES).default("warm"),
  length: z.enum(["short", "medium"]).default("short"),
  whatsappEmojis: z.boolean().default(false),
  /** « LÉA, assistante commerciale de {entreprise} » : présentation transparente d'une assistante IA. */
  assistantTitle: z.string().trim().max(80).default("assistante commerciale"),
  /** Consignes de style libres (formules, vocabulaire, positionnement). Jamais de chiffres ici : ils viennent des données. */
  styleNotes: z.string().trim().max(2000).default(""),
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
    v.length === "medium" ? "Longueur : e-mail de 10 à 15 lignes, avec 2 ou 3 arguments concrets tirés des données." : "Longueur : e-mail de 5 à 8 lignes.",
    v.whatsappEmojis ? "WhatsApp : messages courts, 1 ou 2 emojis maximum (jamais dans un e-mail)." : "Aucun emoji.",
    "Appel à l'action selon la situation : réassort → « répondez OK, je lance la commande » ; client inactif → reprise de contact chaleureuse et offre de retour ; nouveauté → première commande test ; client actif → compléter la prochaine commande.",
    "Objection prix : défends la valeur avec les SEULS faits fournis (meilleure vente, taux de réassort des clients, stock limité, offre exceptionnelle), puis propose d'ajuster les quantités ou une sélection plus courte. Ne cite jamais un autre client.",
    v.styleNotes ? `Consignes de style de l'entreprise :\n${v.styleNotes}` : "",
  ].filter(Boolean).join("\n");
}

/** Signature et formule d'appel selon la voix (cerveau simulé). */
export function signoff(v: Voice, senderName: string, companyName: string, channel: "email" | "whatsapp"): string[] {
  const who = `LÉA, ${v.assistantTitle} de ${companyName}`;
  if (channel === "whatsapp") return [`— ${who}`];
  const human = senderName && !/^LÉA/.test(senderName) ? [`Pour ${senderName}`] : [];
  return ["", v.tone === "dynamic" ? "À très vite," : "Bien cordialement,", "", who, ...human];
}

export const emoji = (v: Voice, channel: "email" | "whatsapp", e: string) => (channel === "whatsapp" && v.whatsappEmojis ? ` ${e}` : "");
