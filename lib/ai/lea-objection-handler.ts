/**
 * LÉA Sales Academy — Module 6 : traitement des objections (méthode P.R.O.V.E.) et bibliothèque de réponses de référence.
 *
 *  P — Préparer avec les données        → outils métier (couverture, sélection, faits vérifiés), jamais le modèle
 *  R — Rechercher la véritable objection → question ciblée quand l'objection est floue
 *  O — Offrir une solution adaptée       → offre révisée, synthèse, comparaison, plan d'action
 *  V — Valoriser avec des preuves        → faits chiffrés fournis (estimations étiquetées)
 *  E — Engager une décision              → technique de conclusion (lea-sales-playbook.ts)
 *
 * Les gabarits ci-dessous sont des formulations ; ils ne contiennent AUCUN chiffre : prix, stocks, délais et remises
 * proviennent des données et de la politique de l'entreprise. Une réponse qui annonce une action (« je vous ai préparé… »)
 * n'est utilisée que si l'action a eu lieu (paramètre `prepared`).
 */
import type { Objection } from "@/features/agent/schemas";

export type ObjectionKey = Objection | "delivery_late" | "unsubscribe";

export type ProveStep = { prepare: string; research: string | null; offer: string; value: string; engage: string };

/** Bibliothèque de réponses de référence (module 6), utilisée par le simulateur, les gabarits et l'évaluateur. */
export const REFERENCE_ANSWERS: Record<string, { objection: ObjectionKey; reference: string; mustNot: string[] }> = {
  too_expensive: {
    objection: "too_expensive",
    reference: "Je comprends votre remarque sur le prix. Regardons surtout le positionnement commercial. Si nous retenons votre prix de vente cible, je peux calculer la marge magasin et comparer les différentes options de colisage. Je préfère vous proposer une sélection réellement rentable plutôt que de réduire le prix sans analyser l'opération. Quel prix de vente souhaitez-vous atteindre ?",
    mustNot: ["remise non autorisée", "prix inventé"],
  },
  budget: {
    objection: "budget",
    reference: "Justement, je ne souhaite pas immobiliser votre budget sur des références qui ne tournent pas. J'ai identifié dans vos historiques plusieurs produits dont la période habituelle de réassort approche. Je vous propose de concentrer votre budget sur les références prioritaires et de compléter avec quelques nouveautés pertinentes. Je vous ai préparé une proposition ciblée. Regardons les quantités ensemble.",
    mustNot: ["stock affirmé sans donnée"],
  },
  stock_available: {
    objection: "stock_available",
    reference: "Je comprends votre situation. Mais il faut distinguer les références qui dorment de celles qui continuent à tourner. J'ai analysé vos historiques d'achat et identifié les produits dont le cycle habituel de réassort approche. Si vous me confirmez vos stocks actuels, je pourrai calculer les jours de couverture et affiner la proposition. Je vous recommande de ne pas réapprovisionner les références lentes et de sécuriser uniquement les meilleures rotations.",
    mustNot: ["stock inventé"],
  },
  competition: {
    objection: "competition",
    reference: "C'est possible. Comparons les deux propositions sur les mêmes bases : produit, conditionnement, quantités, livraison et marge. Mon objectif est de vous proposer la meilleure opération commerciale, pas simplement un prix affiché plus bas. Si vous me communiquez les conditions comparables, je pourrai vérifier où se situe réellement la différence.",
    mustNot: ["dénigrement", "remise non autorisée"],
  },
  think_later: {
    objection: "think_later",
    reference: "Bien entendu. Pour que je puisse vous apporter les éléments utiles, quel point souhaitez-vous encore vérifier : le prix, les quantités, la rotation ou la livraison ? Je peux vous préparer une synthèse sur ce point avant votre décision.",
    mustNot: ["pression excessive"],
  },
  not_selling: {
    objection: "not_selling",
    reference: "Merci de me le signaler. Avant de vous proposer un réassort, je préfère comprendre quelles références rencontrent des difficultés. Regardons les prix de vente, les quantités restantes, la présentation en rayon et les éventuelles différences de performance. Je pourrai ensuite vous proposer un plan d'action adapté, plutôt que de vous ajouter du stock.",
    mustNot: ["réassort forcé"],
  },
  no_time: {
    objection: "no_time",
    reference: "Je comprends. Je vous ai préparé une synthèse très courte avec les références prioritaires et les principaux chiffres. Vous pourrez consulter l'offre complète lorsque cela vous conviendra.",
    mustNot: ["long message"],
  },
  existing_supplier: {
    objection: "existing_supplier",
    reference: "Très bien. Mon objectif n'est pas de bouleverser vos habitudes. Je souhaite plutôt vous présenter quelques références complémentaires qui pourraient apporter quelque chose de nouveau à votre assortiment. Je vous ai préparé une sélection ciblée.",
    mustNot: ["dénigrement du fournisseur"],
  },
  delivery_late: {
    objection: "delivery_late",
    reference: "Je comprends votre mécontentement. Je vais vérifier le statut réel de votre commande et transmettre l'urgence à notre équipe logistique. Je vous communiquerai les informations confirmées et suivrai le dossier jusqu'à sa résolution.",
    mustNot: ["délai non confirmé", "nouvelle vente avant résolution"],
  },
  unsubscribe: {
    objection: "unsubscribe",
    reference: "Bien compris. Je prends en compte votre demande et fais le nécessaire pour arrêter les sollicitations commerciales concernées.",
    mustNot: ["toute proposition commerciale"],
  },
};

/** Ouverture P.R.O.V.E. selon l'objection et ce qui a RÉELLEMENT été préparé par les outils. */
export function proveOpening(o: ObjectionKey, ctx: { prepared: boolean; analysed: boolean; dynamic?: boolean }): string {
  switch (o) {
    case "too_expensive":
      return ctx.analysed
        ? "Je comprends votre remarque sur le prix. Plutôt que de réduire le prix sans analyser l'opération, j'ai repris vos chiffres :"
        : "Je comprends votre remarque sur le prix. Regardons surtout le positionnement commercial de cette sélection.";
    case "budget":
      return ctx.analysed ? "Justement, je ne souhaite pas immobiliser votre budget sur des références qui ne tournent pas. J'ai regardé vos historiques :" : "Je comprends la contrainte budgétaire : concentrons-nous sur ce qui tourne le plus chez vous.";
    case "stock_available":
      return ctx.analysed ? "Je comprends. Il faut distinguer les références qui dorment de celles qui continuent à tourner. J'ai analysé vos historiques d'achat :" : "Je comprends. Il faut distinguer les références qui dorment de celles qui continuent à tourner.";
    case "no_need":
      return "Entendu. Avant de clore, un point d'attention issu de vos données :";
    case "not_selling":
      return "Merci de me le signaler. Avant de vous proposer un réassort, je préfère comprendre quelles références rencontrent des difficultés :";
    default:
      return REFERENCE_ANSWERS[o]?.reference.split(". ")[0] + ".";
  }
}

/** R — question qui fait émerger la vraie objection (posée quand rien n'a pu être préparé). */
export const RESEARCH_QUESTIONS: Partial<Record<ObjectionKey, string>> = {
  too_expensive: "Quel prix de vente souhaitez-vous atteindre ?",
  budget: "Quel budget souhaitez-vous consacrer à cette commande ?",
  stock_available: "Pouvez-vous me confirmer vos stocks actuels sur ces références ? Je calculerai les jours de couverture.",
  think_later: "Quel point souhaitez-vous encore vérifier : le prix, les quantités, la rotation ou la livraison ?",
  not_selling: "Quelles références rencontrent des difficultés, et à quel prix de vente sont-elles affichées ?",
  competition: "Pouvez-vous me communiquer les conditions comparables (produit, conditionnement, quantités, livraison) ?",
};

/** Réponse de référence pour l'objection, à utiliser telle quelle quand aucun outil n'a produit de données. */
export function referenceAnswer(o: ObjectionKey, opts: { prepared: boolean }): string {
  const r = REFERENCE_ANSWERS[o]?.reference ?? "";
  // « Je vous ai préparé… » seulement si un document a réellement été préparé.
  return opts.prepared ? r : r.replace(/\s*Je vous ai préparé[^.]*\.\s*/g, " ").replace(/\s*Regardons les quantités ensemble\.?/g, "").trim();
}
