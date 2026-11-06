import { dec } from "@/lib/money";

export type CommercialPolicy = {
  name: string | null;
  maxAutoDiscountPct: string; // plafond de remise que LÉA peut proposer sans transfert
  requireDiscountApproval: boolean; // V1 : toute remise communiquée nécessite une validation humaine
  requireMessageApproval: boolean;
  offerValidityDays: number;
};

/** Préréglage de l'organisation pilote JONAS — jamais appliqué par défaut aux autres organisations. */
export const JONAS_PILOT_POLICY: CommercialPolicy = {
  name: "Politique pilote JONAS",
  maxAutoDiscountPct: "1.00",
  requireDiscountApproval: true,
  requireMessageApproval: true,
  offerValidityDays: 30,
};

/** Politique par défaut d'une nouvelle organisation : aucune remise automatique. */
export const DEFAULT_POLICY: CommercialPolicy = {
  name: null,
  maxAutoDiscountPct: "0",
  requireDiscountApproval: true,
  requireMessageApproval: true,
  offerValidityDays: 30,
};

export type DiscountDecision =
  | { kind: "within_policy"; pct: string; needsApproval: boolean; explanation: string }
  | { kind: "escalate"; requestedPct: string; maxPct: string; explanation: string };

/**
 * Décision déterministe sur une demande de remise. Le LLM ne peut jamais dépasser ce plafond :
 * toute proposition IA passe par cette fonction côté serveur.
 */
export function evaluateDiscount(policy: CommercialPolicy, requestedPct: string | number): DiscountDecision {
  const req = dec(requestedPct);
  const max = dec(policy.maxAutoDiscountPct);
  if (req.isNaN() || req.lt(0) || req.gt(100)) {
    return { kind: "escalate", requestedPct: String(requestedPct), maxPct: max.toFixed(2), explanation: "Demande de remise invalide : transfert au commercial." };
  }
  if (req.gt(max)) {
    return {
      kind: "escalate",
      requestedPct: req.toFixed(2),
      maxPct: max.toFixed(2),
      explanation: `Remise demandée (${req.toFixed(2)} %) supérieure au plafond autorisé (${max.toFixed(2)} %) : transfert au commercial responsable.`,
    };
  }
  return {
    kind: "within_policy",
    pct: req.toFixed(2),
    needsApproval: policy.requireDiscountApproval && req.gt(0),
    explanation: req.gt(0)
      ? `Remise de ${req.toFixed(2)} % dans la limite autorisée${policy.requireDiscountApproval ? ", soumise à validation humaine avant communication" : ""}.`
      : "Aucune remise.",
  };
}

/** Borne une remise proposée par l'IA au plafond (défense en profondeur). */
export function clampDiscount(policy: CommercialPolicy, pct: string | number): string {
  const v = dec(pct);
  if (v.isNaN() || v.lt(0)) return "0.00";
  const max = dec(policy.maxAutoDiscountPct);
  return (v.gt(max) ? max : v).toFixed(2);
}
