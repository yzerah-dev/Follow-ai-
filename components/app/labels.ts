import type { BadgeTone } from "./badge-tone";

export const OPPORTUNITY_LABEL: Record<string, string> = {
  reorder: "Réassort",
  dormant_customer: "Client dormant",
  new_product: "Nouveauté",
  cross_sell: "Vente complémentaire",
  back_in_stock: "Retour en stock",
  target_gap: "Objectif CA en retard",
  campaign: "Campagne",
  unclosed_offer: "Offre à relancer",
  appointment: "Rendez-vous",
};

export const OFFER_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Brouillon", tone: "neutral" },
  pending_approval: { label: "À valider", tone: "warning" },
  approved: { label: "Validée", tone: "info" },
  sent: { label: "Envoyée", tone: "primary" },
  negotiation: { label: "En négociation", tone: "warning" },
  accepted: { label: "Acceptée", tone: "success" },
  rejected: { label: "Refusée", tone: "danger" },
  expired: { label: "Expirée", tone: "neutral" },
};

export const CUSTOMER_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  prospect: { label: "Prospect", tone: "info" },
  active: { label: "Actif", tone: "success" },
  dormant: { label: "Dormant", tone: "warning" },
  lost: { label: "Perdu", tone: "neutral" },
  blocked: { label: "Bloqué", tone: "danger" },
};

export const PAYMENT_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  unknown: { label: "Inconnu", tone: "neutral" },
  unpaid: { label: "Non réglée", tone: "warning" },
  partially_paid: { label: "Partiel", tone: "info" },
  paid: { label: "Réglée", tone: "success" },
  overdue: { label: "En retard", tone: "danger" },
};

export const AVAILABILITY: Record<string, { label: string; tone: BadgeTone }> = {
  in_stock: { label: "En stock", tone: "success" },
  low_stock: { label: "Stock faible", tone: "warning" },
  out_of_stock: { label: "Rupture", tone: "danger" },
  on_order: { label: "Réappro.", tone: "info" },
  unknown: { label: "Inconnue", tone: "neutral" },
};

export const MESSAGE_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Brouillon", tone: "neutral" },
  pending_approval: { label: "À valider", tone: "warning" },
  approved: { label: "Validé", tone: "info" },
  sent: { label: "Envoyé", tone: "success" },
  simulated_sent: { label: "Envoi simulé", tone: "warning" },
  delivered: { label: "Délivré", tone: "success" },
  failed: { label: "Échec", tone: "danger" },
  received: { label: "Reçu", tone: "primary" },
};

export const CONNECTION_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  not_connected: { label: "Non connectée", tone: "neutral" },
  needs_configuration: { label: "Configuration nécessaire", tone: "warning" },
  connected: { label: "Connectée", tone: "success" },
  error: { label: "Erreur", tone: "danger" },
  expired: { label: "Autorisation expirée", tone: "danger" },
};
