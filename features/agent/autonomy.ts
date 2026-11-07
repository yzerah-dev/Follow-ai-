/**
 * Règles d'autonomie de LÉA — 100 % déterministes.
 * Elles décident si un message préparé part seul ou attend un humain, et QUAND il peut partir.
 * Le modèle IA n'intervient jamais dans cette décision.
 */
import { dec } from "@/lib/money";

export type AutonomyLevel = "supervised" | "semi_autonomous" | "autonomous";

export type SendWindow = { days: number[]; start: string; end: string }; // jours ISO 1 = lundi … 7 = dimanche, heure Europe/Paris

export type AutonomySettings = {
  level: AutonomyLevel;
  paused: boolean;
  maxOfferHt: string | null; // null = pas de plafond de montant
  requireDiscountApproval: boolean;
  dailySendLimit: number;
  sendWindow: SendWindow;
  timezone: string;
};

export type AutonomyAction =
  | { kind: "offer_email"; offerTotalHt: string; discountPct: number; guardNotes: string[]; identityVerified: boolean }
  | { kind: "followup"; attempt: number; maxFollowups: number; guardNotes: string[] }
  | {
      kind: "reply";
      intent: string;
      objection: string | null;
      escalate: boolean;
      discountPct: number | null;
      answered?: number; // réponses factuelles disponibles
      unanswered?: number; // sujets sans donnée fiable (transmis au commercial)
      guardNotes: string[];
      identityVerified: boolean;
      injectionSuspected: boolean;
    };

export type AutonomyDecision = { mode: "auto" | "approval"; reason: string };

const approval = (reason: string): AutonomyDecision => ({ mode: "approval", reason });
const auto = (reason: string): AutonomyDecision => ({ mode: "auto", reason });

export function decideAutonomy(s: AutonomySettings, a: AutonomyAction): AutonomyDecision {
  if (s.paused) return approval("LÉA est suspendue : validation humaine requise.");
  if (s.level === "supervised") return approval("Mode supervisé : chaque envoi est validé par un humain.");
  if (a.guardNotes.length) return approval(`Garde-fou déclenché : ${a.guardNotes.join(" ; ")}`);

  if (a.kind === "offer_email") {
    if (!a.identityVerified) return approval("Destinataire non vérifié.");
    if (s.maxOfferHt !== null && dec(a.offerTotalHt).gt(dec(s.maxOfferHt))) return approval(`Offre supérieure au plafond d'envoi autonome (${dec(s.maxOfferHt).toFixed(2)} € HT).`);
    if (a.discountPct > 0 && s.requireDiscountApproval) return approval("Remise présente : validation exigée par la politique.");
    return auto("Offre conforme à la politique commerciale.");
  }

  if (a.kind === "followup") {
    if (a.attempt > a.maxFollowups) return approval("Nombre maximal de relances atteint : le commercial reprend la main.");
    return auto(`Relance n° ${a.attempt} sans réponse du client.`);
  }

  // Réponse à un client
  if (!a.identityVerified) return approval("Expéditeur non identifié avec certitude.");
  if (a.injectionSuspected) return approval("Contenu suspect dans le message du client : lecture humaine requise.");
  if (a.escalate) return approval("Négociation transférée au commercial (au-delà de la politique ou concurrence).");
  if (a.intent === "question" || a.intent === "other") {
    const answered = a.answered ?? 0;
    const unanswered = a.unanswered ?? 0;
    if (!answered && !unanswered) return approval("Message sans question identifiable : lecture humaine.");
    if (unanswered && s.level === "semi_autonomous") return approval("Question partiellement sans réponse : validation humaine.");
    if (!answered) return auto("Accusé de réception : le commercial confirme les points sans donnée fiable.");
    return auto(unanswered ? "Réponse factuelle ; les points sans donnée fiable sont transmis au commercial." : "Réponse factuelle à partir des données.");
  }
  if (a.discountPct !== null && a.discountPct > 0) {
    if (s.requireDiscountApproval) return approval("Remise proposée : validation exigée par la politique.");
    if (s.level === "semi_autonomous") return approval("Mode semi-autonome : les remises sont validées par un humain.");
    return auto(`Remise de ${a.discountPct} % dans la limite de la politique.`);
  }
  if (s.level === "semi_autonomous" && a.objection === "competition") return approval("Concurrence évoquée : validation humaine.");
  return auto("Réponse conforme à la politique commerciale.");
}

// ------------------------------------------------------------------ Plage d'envoi

function parts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday!) + 1;
  return { dow, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export function inSendWindow(now: Date, w: SendWindow, tz = "Europe/Paris"): boolean {
  const { dow, minutes } = parts(now, tz);
  return w.days.includes(dow) && minutes >= toMin(w.start) && minutes < toMin(w.end);
}

/** Prochain instant d'envoi autorisé (au pas de 5 minutes, sur 8 jours maximum). */
export function nextSendTime(now: Date, w: SendWindow, tz = "Europe/Paris"): Date | null {
  if (!w.days.length || toMin(w.end) <= toMin(w.start)) return null;
  if (inSendWindow(now, w, tz)) return now;
  const step = 5 * 60_000;
  let t = new Date(Math.ceil(now.getTime() / step) * step);
  for (let i = 0; i < (8 * 24 * 60) / 5; i++, t = new Date(t.getTime() + step)) if (inSendWindow(t, w, tz)) return t;
  return null;
}

export const AUTONOMY_LABEL: Record<AutonomyLevel, string> = {
  supervised: "Supervisé — chaque envoi est validé",
  semi_autonomous: "Semi-autonome — LÉA envoie les messages simples",
  autonomous: "Autonome — LÉA envoie tout ce qui respecte la politique",
};
