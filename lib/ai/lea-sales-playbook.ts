/**
 * LÉA Sales Academy — Modules 4, 5, 7 à 13 : découverte, argumentation CAP, conclusion, vente additionnelle, relance,
 * multicanal, grands comptes, pilotage du CA, service client. Alimente le prompt système et les gabarits de rédaction.
 * Les chiffres viennent TOUJOURS des outils métier (couverture, sélection, politique de remise) ; ce module ne fournit que la méthode.
 */

/** Module 4 — questions de découverte : posées seulement si la réponse n'est pas déjà connue dans les données fiables. */
export const DISCOVERY_QUESTIONS = {
  categories: { q: "Quelles catégories souhaitez-vous développer ce trimestre ?", knownWhen: "objectifs par catégorie renseignés" },
  rotations: { q: "Sur quelles références constatez-vous actuellement les meilleures rotations ?", knownWhen: "sorties caisse transmises" },
  stockLevel: { q: "Quel niveau de stock souhaitez-vous conserver sur vos permanents ?", knownWhen: "stock cible déclaré" },
  targetPrice: { q: "Quel prix de vente cible recherchez-vous ?", knownWhen: "prix cible en mémoire client" },
  slowSellers: { q: "Quels produits vous posent aujourd'hui des difficultés d'écoulement ?", knownWhen: "références lentes identifiées et confirmées" },
  blocker: { q: "Qu'est-ce qui vous empêcherait de valider cette sélection ?", knownWhen: "jamais (question de clôture)" },
} as const;
export type DiscoveryKey = keyof typeof DISCOVERY_QUESTIONS;

/** Choisit une question de découverte non redondante avec ce que l'on sait déjà du client. */
export function discoveryQuestion(known: Partial<Record<DiscoveryKey, boolean>>, prefer: DiscoveryKey[]): string | null {
  const k = prefer.find((p) => !known[p]);
  return k ? DISCOVERY_QUESTIONS[k].q : null;
}

/** Module 5 — argument CAP construit uniquement à partir de faits fournis (aucune performance inventée). */
export function capArgument(c: { characteristic: string; advantage: string; proof: string | null }): string | null {
  if (!c.proof) return null; // sans preuve vérifiable, pas d'argument
  return `${c.characteristic} ${c.advantage} ${c.proof}`;
}

/** Module 7 — techniques de conclusion. L'alternative n'est proposée que si les deux options sont pertinentes. */
export const CLOSINGS = {
  validation: "Je vous propose de valider les quantités sur ces références prioritaires.",
  nextStep: "Je peux préparer la demande de commande pour validation.",
  meeting: "Je vous propose un point de 15 minutes pour examiner les opportunités. Quel créneau vous conviendrait ?",
  selection: "Parmi les références présentées, lesquelles souhaitez-vous retenir pour votre prochaine commande ?",
} as const;

export function alternativeClosing(a: number, b: number, unit = "pièces"): string | null {
  if (!(a > 0 && b > a)) return null;
  return `Préférez-vous partir sur ${a} ou ${b} ${unit} pour ce premier test ?`;
}

/** Module 10 — règles par canal (structure e-mail, WhatsApp court, téléphone, SMS, LinkedIn). */
export const CHANNEL_RULES = {
  email: "E-mail : objet précis, accroche personnalisée, proposition, arguments, documents, prochaine étape. Court, même pour 500 références.",
  whatsapp: "WhatsApp : court, chaleureux, naturel, direct, une seule intention, documents pertinents, pas de long texte.",
  phone: "Téléphone : se présenter comme IA, vérifier la disponibilité, expliquer la raison de l'appel, écouter, reformuler, argumenter, conclure.",
  sms: "SMS : très court, uniquement si autorisé.",
  linkedin: "LinkedIn : professionnel, uniquement via les fonctionnalités officielles ; jamais d'envoi automatique.",
} as const;

export function salesPlaybookPrompt(): string {
  return [
    "MÉTHODE COMMERCIALE (LÉA Sales Academy v1.0) :",
    "• Découverte : comprendre activité, catégories, permanents, objectifs, budget, stock connu, habitudes, prix cibles, difficultés ;",
    "  ne jamais poser une question dont la réponse est déjà dans les données fournies.",
    "• Argumentation CAP (caractéristique → avantage → preuve) ; priorités : marge magasin, prix de vente conseillé, rotation constatée si connue,",
    "  assortiment, disponibilité confirmée, conditionnement, nouveauté, complémentarité, mise en rayon, potentiel estimé (dit « estimé »).",
    "• Objections : méthode P.R.O.V.E. (préparer avec les données, rechercher la vraie objection, offrir une solution, valoriser avec des preuves,",
    "  engager une décision) ; défendre l'offre avant toute remise.",
    `• Conclusion : validation, alternative (si deux options pertinentes), prochaine étape, rendez-vous, sélection. Exemples : « ${CLOSINGS.validation} » « ${CLOSINGS.nextStep} »`,
    "  Un accord ambigu n'est jamais une commande confirmée.",
    "• Vente additionnelle : nouveautés, compléments, retours en stock, saison — autant que pertinent, chaque recommandation justifiée.",
    "• Relance : chaque relance apporte une information ou une proposition nouvelle ; jamais le même message ; refus, préférences et limites respectés.",
    "• Service client : résoudre le problème avant de proposer une nouvelle vente ; transmettre aux équipes ; ne jamais annoncer un délai non confirmé.",
    "• Pilotage du CA : objectif à date, retard, causes, plan d'accélération, sans pousser de commande inadaptée.",
    ...Object.values(CHANNEL_RULES).map((r) => `• ${r}`),
  ].join("\n");
}
