import { z } from "zod";

export const OBJECTIONS = ["too_expensive", "no_need", "stock_available", "competition", "budget", "delivery", "lead_time", "no_time", "refusal", "no_response"] as const;
export type Objection = (typeof OBJECTIONS)[number];

export const OBJECTION_LABEL: Record<Objection, string> = {
  too_expensive: "Trop cher",
  no_need: "Pas besoin",
  stock_available: "Stock encore disponible",
  competition: "Concurrence",
  budget: "Budget",
  delivery: "Livraison",
  lead_time: "Délai",
  no_time: "Manque de temps",
  refusal: "Refus",
  no_response: "Non-réponse",
};

export const INTENTS = ["accept", "objection", "question", "meeting_request", "unsubscribe", "out_of_office", "other"] as const;
export type Intent = (typeof INTENTS)[number];
export const INTENT_LABEL: Record<Intent, string> = {
  accept: "Accord / commande",
  objection: "Objection",
  question: "Question",
  meeting_request: "Demande de rendez-vous",
  unsubscribe: "Désinscription",
  out_of_office: "Absence",
  other: "Autre",
};

export const emailDraftSchema = z.object({
  subject: z.string().min(3).max(160),
  body: z.string().min(20).max(4000),
  personalizationBasis: z.enum(["purchase_history", "generic"]),
  arguments: z.array(z.string().max(300)).max(6),
});
export type EmailDraft = z.infer<typeof emailDraftSchema>;

export const replyAnalysisSchema = z.object({
  intent: z.enum(INTENTS),
  objection: z.enum(OBJECTIONS).nullable(),
  requestedDiscountPct: z.number().min(0).max(100).nullable(),
  requestedQuantity: z.string().max(120).nullable(),
  targetPrice: z.string().max(120).nullable(),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  summary: z.string().max(600),
  nextAction: z.string().max(300),
});
export type ReplyAnalysis = z.infer<typeof replyAnalysisSchema>;

export const objectionReplySchema = z.object({
  subject: z.string().min(3).max(160),
  body: z.string().min(20).max(4000),
  proposedDiscountPct: z.number().min(0).max(100).nullable(),
  rationale: z.string().max(600),
});
export type ObjectionReply = z.infer<typeof objectionReplySchema>;

export const chatAnswerSchema = z.object({
  answer: z.string().max(4000),
  suggestions: z.array(z.object({ label: z.string().max(80), href: z.string().max(200) })).max(5),
});
export type ChatAnswer = z.infer<typeof chatAnswerSchema>;
