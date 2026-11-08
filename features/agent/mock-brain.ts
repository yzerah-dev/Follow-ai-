/**
 * Cerveau SIMULÉ de LÉA — utilisé quand aucun fournisseur IA n'est configuré (LLM_PROVIDER=mock)
 * et dans les tests. Règles déterministes, clairement signalées dans l'interface (« IA simulée »).
 * Il respecte les mêmes contrats (schémas Zod) que le fournisseur réel.
 */
import { OBJECTION_LABEL, type EmailDraft, type ObjectionReply, type ReplyAnalysis, type Objection, type ChatAnswer } from "./schemas";
import { sanitizeText } from "@/lib/security/untrusted";
import { parseVoice, signoff, pushSignature, emoji, type Voice } from "./voice";
import { referenceAnswer, proveOpening, RESEARCH_QUESTIONS } from "@/lib/ai/lea-objection-handler";
import { CLOSINGS } from "@/lib/ai/lea-sales-playbook";

export type ContactCtx = { salutation: string | null; firstName: string | null; lastName: string | null } | null;

export type OfferEmailCtx = {
  customerName: string;
  contact: ContactCtx;
  offer: { number: string; validUntil: string | null; totalHt: string; lineCount?: number; categories?: { name: string; lines: number }[]; lines: { reference: string; description: string; quantity: string }[] };
  history: { invoiceCount: number; usualReferences: string[] };
  newProductNames: string[];
  senderName: string;
  companyName: string;
  voice?: Voice;
  /** Type d'opportunité à l'origine de l'offre (reorder, dormant_customer, new_product…) : choisit l'appel à l'action. */
  opportunityType?: string | null;
  /** Arguments factuels calculés par le système (features/agent/arguments.ts). */
  salesFacts?: string[];
};

export type ObjectionCtx = {
  analysis: ReplyAnalysis;
  customerName: string;
  contact: ContactCtx;
  offer: { number: string; totalHt: string; validUntil: string | null } | null;
  allowedDiscountPct: number | null; // décidé par la politique, jamais par l'IA
  escalate: boolean;
  senderName: string;
  companyName: string;
  channel: "email" | "whatsapp";
  answers: string[]; // réponses factuelles calculées (features/agent/answers.ts)
  unknownLabels: string[]; // sujets sans donnée fiable → transmis au commercial
  turn: number; // nombre de réponses déjà envoyées dans la conversation
  clientGreeted?: boolean; // le client a dit bonjour : une commerciale répond bonjour
  voice?: Voice;
  salesFacts?: string[];
  playbook?: PlaybookCtx | null;
};

/** Résultat du playbook transmis à la rédaction (aucun chiffre n'est produit par la rédaction elle-même). */
export type PlaybookCtx = {
  strategy: "revise" | "hold" | "respect";
  counterArguments: string[];
  removed: { name: string; reason: string }[];
  question: string;
  followUpDate: string | null;
  declaredStock: { qty: string; productName: string | null } | null;
  revised: { number: string; totalHt: string; originalTotalHt: string; documents: string[] } | null;
};

export function greeting(contact: ContactCtx): string {
  if (contact?.salutation && contact.lastName) return `Bonjour ${contact.salutation === "Mme" ? "Madame" : "Monsieur"} ${contact.lastName},`;
  if (contact?.firstName || contact?.lastName) return `Bonjour ${[contact.firstName, contact.lastName].filter(Boolean).join(" ")},`;
  return "Bonjour,";
}

const fmt = (v: string) => `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ")} €`;
const fmtDate = (d: string | null) => (d ? new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)) : null);

/** Appel à l'action et accroche selon la situation du client. */
function offerAngle(type: string | null | undefined, dynamic: boolean) {
  switch (type) {
    case "reorder":
      return { intro: "Au regard de vos derniers achats, vos références habituelles arrivent au moment du réassort : je vous ai préparé la commande.", cta: dynamic ? "Répondez simplement « OK » et je lance le réassort aujourd'hui." : "Répondez « OK » et j'enregistre la commande." };
    case "dormant_customer":
      return { intro: "Cela fait un moment que nous n'avons pas travaillé ensemble : je vous ai préparé une sélection de vos références habituelles pour repartir sur de bonnes bases.", cta: dynamic ? "Un « OK » suffit pour que je prépare la livraison, ou je vous appelle 10 minutes quand vous voulez." : "Je peux enregistrer la commande dès votre retour, ou organiser un court échange." };
    case "new_product":
      return { intro: "Nous lançons des nouveautés qui correspondent à votre assortiment : je vous ai préparé une première sélection.", cta: dynamic ? "Lancez-vous avec cette commande test : un « OK » et c'est parti." : "Souhaitez-vous démarrer avec cette première commande test ?" };
    case "cross_sell":
    case "back_in_stock":
      return { intro: "Pour compléter votre prochaine commande, je vous ai préparé une sélection de références qui complètent ce que vous travaillez déjà.", cta: dynamic ? "Je l'ajoute à votre commande ? Répondez « OK »." : "Souhaitez-vous que je l'ajoute à votre prochaine commande ?" };
    default:
      return null;
  }
}

export function mockOfferEmail(ctx: OfferEmailCtx): EmailDraft {
  const v = parseVoice(ctx.voice);
  const dynamic = v.tone === "dynamic";
  const personalized = ctx.history.invoiceCount >= 3 && ctx.history.usualReferences.length > 0;
  const total = ctx.offer.lineCount ?? ctx.offer.lines.length;
  // Offre volumineuse : résumé par catégorie + principales lignes ; le détail complet est dans l'offre et l'Excel joints.
  const refs = total > 8
    ? [`${total} références réparties en ${ctx.offer.categories?.length ?? "plusieurs"} catégorie(s)${ctx.offer.categories?.length ? ` : ${ctx.offer.categories.slice(0, 6).map((c) => `${c.name} (${c.lines})`).join(", ")}` : ""}.`,
       "Principales lignes :", ...ctx.offer.lines.slice(0, 6).map((l) => `• ${l.description} (réf. ${l.reference}) — ${Number(l.quantity)} unités`),
       `… et ${total - Math.min(6, ctx.offer.lines.length)} autre(s) référence(s), détaillées dans l'offre et le fichier Excel joints.`].join("\n")
    : ctx.offer.lines.slice(0, 8).map((l) => `• ${l.description} (réf. ${l.reference}) — ${Number(l.quantity)} unités`).join("\n");
  const angle = personalized || ctx.opportunityType === "new_product" ? offerAngle(ctx.opportunityType, dynamic) : null;
  const intro = angle?.intro ?? (personalized
    ? `Au regard de vos derniers achats, j'ai préparé une sélection de réassort sur les références que vous travaillez régulièrement.`
    : `J'ai préparé une proposition sur une sélection de références de notre gamme.`);
  const news = ctx.newProductNames.length
    ? `\n\nJ'y ai ajouté ${ctx.newProductNames.length === 1 ? "une nouveauté susceptible" : `${ctx.newProductNames.length} nouveautés susceptibles`} de compléter votre assortiment : ${ctx.newProductNames.join(", ")}.`
    : "";
  const facts = v.length === "medium" && ctx.salesFacts?.length ? `\n\nPourquoi maintenant :\n${ctx.salesFacts.slice(0, 3).map((f) => `• ${f}`).join("\n")}` : "";
  const validity = fmtDate(ctx.offer.validUntil);
  const cta = angle?.cta ?? "Je peux enregistrer votre commande dès votre retour, ou organiser un rendez-vous de présentation en visioconférence si vous le souhaitez.";
  const body = [
    greeting(ctx.contact), "",
    `${intro}${news}`, "",
    refs,
    facts ? facts.slice(1) : null,
    "",
    `Le montant de la proposition s'élève à ${fmt(ctx.offer.totalHt)} HT${validity ? `, valable jusqu'au ${validity}` : ""}. Vous trouverez le détail dans l'offre ${ctx.offer.number} jointe.`,
    "", cta,
    ...signoff(v, ctx.senderName, ctx.companyName, "email"),
  ].filter((l): l is string => l !== null).join("\n").replace(/\n{3,}/g, "\n\n");
  const subjects: Record<string, string> = { reorder: "Votre réassort est prêt", dormant_customer: "On repart ensemble ?", new_product: "Nos nouveautés pour votre magasin", cross_sell: "Pour compléter votre commande", back_in_stock: "De retour en stock" };
  const subjectLead = angle && ctx.opportunityType ? subjects[ctx.opportunityType] : null;
  return {
    subject: subjectLead ? `${subjectLead} — proposition ${ctx.offer.number}` : personalized ? `Votre réassort — proposition ${ctx.offer.number}` : `Proposition commerciale ${ctx.offer.number}`,
    body,
    personalizationBasis: personalized ? "purchase_history" : "generic",
    arguments: [
      personalized ? `Basé sur ${ctx.history.invoiceCount} factures et vos références habituelles` : "Sélection de la gamme",
      "Quantités ajustées au colisage",
      ...(ctx.newProductNames.length ? ["Nouveautés en complément"] : []),
      ...(ctx.salesFacts ?? []).slice(0, 3),
    ],
  };
}

const RULES: { objection: Objection; patterns: RegExp[] }[] = [
  { objection: "competition", patterns: [/concurren/i, /autre fournisseur/i, /ailleurs/i, /moins cher chez/i] },
  { objection: "delivery", patterns: [/frais de (port|livraison)/i, /\bfranco\b/i] }, // avant « trop élevé » : « frais de port trop élevés »
  { objection: "too_expensive", patterns: [/trop cher/i, /prix (trop )?élevé/i, /trop élevé/i, /\bremise\b/i, /réduction/i, /geste commercial/i, /baisser (le|vos) prix/i] },
  { objection: "think_later", patterns: [/je vais r[ée]fl[ée]chir/i, /laissez-moi r[ée]fl[ée]chir/i, /on en reparle/i, /je dois y r[ée]fl[ée]chir/i, /je vous redis/i] },
  { objection: "existing_supplier", patterns: [/d[ée]j[àa] (un|avec un|mon) fournisseur/i, /travaille d[ée]j[àa] avec/i, /nous avons d[ée]j[àa] nos fournisseurs/i] },
  { objection: "not_selling", patterns: [/ne se vend pas/i, /se vend mal/i, /ne tourne pas/i, /tourne mal/i, /invendu/i, /ne part pas/i] },
  { objection: "stock_available", patterns: [/trop de stock/i, /beaucoup de stock/i, /il (m['’]|nous )en reste/i, /encore du stock/i, /il nous en reste/i, /stock suffisant/i, /déjà (du|en) stock/i, /pas encore écoulé/i] },
  { objection: "budget", patterns: [/budget/i, /trésorerie/i] },
  { objection: "delivery", patterns: [/frais de port/i, /livraison/i, /transport/i, /franco/i] },
  { objection: "lead_time", patterns: [/délai/i, /quand (pourriez|pouvez)/i, /date de livraison/i, /au plus vite/i] },
  { objection: "no_time", patterns: [/pas le temps/i, /débordé/i, /plus tard/i, /rappelez/i] },
  { objection: "no_need", patterns: [/besoin de rien/i, /pas besoin/i, /pas nécessaire/i, /pas intéressé/i] },
  { objection: "refusal", patterns: [/non merci/i, /ne souhaitons pas/i, /ne sommes pas intéressés/i] },
];

export function mockAnalyzeReply(text: string): ReplyAnalysis {
  const t = sanitizeText(text, 6000);
  const discount = t.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s?%/);
  const qty = t.match(/(\d{1,6})\s?(unités|pièces|colis|cartons|pcs)/i) ?? (() => { const m = t.match(/(?:il (?:m['’]|nous )en reste|il (?:me|nous) reste|j['’]en ai encore|nous en avons encore|reste encore)\s+(?:encore\s+)?(\d{1,6})/i); return m ? ([m[0], m[1], "unités"] as unknown as RegExpMatchArray) : null; })();
  const price = t.match(/(\d{1,6}(?:[.,]\d{1,2})?)\s?(€|euros?)\s?(HT)?/i);
  if (/désinscri|ne plus recevoir|retirez[- ]moi|\bstop\b|ne (veux|souhaite) plus (être|etre) (contact|sollicit)|plus de sollicitation/i.test(t))
    return { intent: "unsubscribe", objection: null, requestedDiscountPct: null, requestedQuantity: null, targetPrice: null, sentiment: "negative", summary: "Le client demande à ne plus être sollicité.", nextAction: "Inscrire l'adresse en liste d'opposition et cesser les envois." };
  if (/absent|out of office|congés jusqu/i.test(t) && t.length < 400)
    return { intent: "out_of_office", objection: null, requestedDiscountPct: null, requestedQuantity: null, targetPrice: null, sentiment: "neutral", summary: "Réponse automatique d'absence.", nextAction: "Reprogrammer la relance après la date de retour." };
  // Réclamation (livraison en retard, commande non reçue) : service client avant toute vente.
  if (/(livraison|commande|colis)[^.?!]{0,40}(retard|pas (encore )?(re[çc]u|arriv)|toujours pas)|en retard[^.?!]{0,30}(livraison|commande)|pas re[çc]u (ma|notre|la) commande/i.test(t))
    return { intent: "complaint", objection: null, requestedDiscountPct: null, requestedQuantity: null, targetPrice: null, sentiment: "negative", summary: "Réclamation : livraison ou commande en retard.", nextAction: "Vérifier le statut réel de la commande et transmettre à la logistique ; aucun délai non confirmé." };
  let objection = RULES.find((r) => r.patterns.some((p) => p.test(t)))?.objection ?? null;
  // « Quel est mon franco ? », « Quel délai ? » : ce sont des questions, pas des objections.
  if ((objection === "delivery" || objection === "lead_time") && /\?/.test(t)) objection = null;
  const accept = /(ok pour|c'est validé|je valide|bon pour accord|nous prenons|vous pouvez lancer|confirmons la commande)/i.test(t);
  const meeting = /(rendez-vous|\brdv\b|visio|showroom|passer nous voir|m'appeler|appelez-moi)/i.test(t);
  const base = {
    requestedDiscountPct: discount ? Number(discount[1]!.replace(",", ".")) : null,
    requestedQuantity: qty ? `${qty[1]} ${qty[2]}` : null,
    targetPrice: price ? `${price[1]} €${price[3] ? " HT" : ""}` : null,
  };
  if (objection && objection !== "refusal" && !(accept && !base.requestedDiscountPct)) {
    return { intent: "objection", objection, ...base, sentiment: "neutral", summary: `Objection détectée : ${OBJECTION_LABEL[objection].toLowerCase()}${base.requestedDiscountPct ? `, remise demandée ${base.requestedDiscountPct} %` : ""}.`, nextAction: "Répondre à l'objection en défendant la valeur de l'offre." };
  }
  if (objection === "refusal") return { intent: "objection", objection, ...base, sentiment: "negative", summary: "Le client décline la proposition.", nextAction: "Prendre acte, proposer un point ultérieur sans insister." };
  if (accept) return { intent: "accept", objection: null, ...base, sentiment: "positive", summary: "Le client donne son accord.", nextAction: "Préparer la demande de commande." };
  if (meeting) return { intent: "meeting_request", objection: null, ...base, sentiment: "positive", summary: "Le client souhaite un échange.", nextAction: "Proposer deux créneaux de rendez-vous." };
  if (/\?/.test(t)) return { intent: "question", objection: null, ...base, sentiment: "neutral", summary: "Le client pose une question.", nextAction: "Répondre avec les informations disponibles ou transférer au commercial." };
  return { intent: "other", objection: null, ...base, sentiment: "neutral", summary: "Réponse sans intention claire.", nextAction: "Transférer au commercial pour lecture." };
}

/** Arguments par objection : réponses de référence de la LÉA Sales Academy (sans annoncer de document non préparé). */
const OBJECTION_ARGUMENTS: Record<Objection, string> = {
  too_expensive: referenceAnswer("too_expensive", { prepared: false }),
  no_need: "Entendu. Si votre besoin évolue, je peux vous présenter nos nouveautés lors d'un court échange.",
  stock_available: referenceAnswer("stock_available", { prepared: false }),
  competition: referenceAnswer("competition", { prepared: false }),
  budget: referenceAnswer("budget", { prepared: false }),
  delivery: "Concernant la livraison, je vérifie les conditions applicables à votre compte et reviens vers vous avec une réponse précise.",
  lead_time: "Concernant les délais, je confirme la disponibilité de chaque référence auprès de notre logistique avant de vous donner une date ferme.",
  no_time: "Je comprends que votre emploi du temps est chargé. Un simple « OK » par retour suffit pour valider, et l'offre complète reste consultable quand cela vous convient.",
  refusal: "Je prends bonne note de votre retour et vous remercie de votre réponse. Je reste à votre disposition pour vos prochains besoins.",
  no_response: "Je reviens vers vous avec un point nouveau sur notre proposition.",
  not_selling: referenceAnswer("not_selling", { prepared: false }),
  think_later: referenceAnswer("think_later", { prepared: false }),
  existing_supplier: referenceAnswer("existing_supplier", { prepared: false }),
};

export function mockObjectionReply(ctx: ObjectionCtx): ObjectionReply {
  const v = parseVoice(ctx.voice);
  const wa = ctx.channel === "whatsapp";
  const subject = ctx.offer ? `RE: Proposition ${ctx.offer.number}` : "RE: Votre message";
  // WhatsApp : ton de messagerie, court ; pas de formule d'appel répétée au fil de la discussion.
  // WhatsApp : on salue au premier échange et chaque fois que le client dit bonjour (jamais de réponse « sèche »).
  const hello = wa ? (ctx.turn > 0 && !ctx.clientGreeted ? null : `${greeting(ctx.contact).replace(/,$/, " !")}${emoji(v, "whatsapp", "👋")}`) : greeting(ctx.contact);
  const sign = signoff(v, ctx.senderName, ctx.companyName, ctx.channel);
  const facts = ctx.answers.length ? (wa ? ctx.answers.map((a) => `• ${a}`) : ["", ...ctx.answers.map((a) => `• ${a}`)]) : [];
  const unknownLine = ctx.unknownLabels.length
    ? `Concernant ${ctx.unknownLabels.join(" et ")}, je vérifie auprès de votre commercial et je reviens vers vous très vite${wa ? "." : " avec une réponse précise."}`
    : null;
  const join = (parts: (string | null)[]) => parts.filter((x): x is string => x !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();

  if (ctx.analysis.intent === "complaint") {
    return {
      subject,
      body: join([hello, wa ? null : "", referenceAnswer("delivery_late", { prepared: false }), ...(unknownLine ? [wa ? null : "", unknownLine] : []), ...sign]),
      proposedDiscountPct: null,
      rationale: "Réclamation : statut à vérifier par la logistique, aucun délai annoncé, aucune nouvelle vente avant résolution.",
    };
  }
  if (ctx.analysis.intent === "unsubscribe") {
    return { subject, body: join([hello, wa ? null : "", referenceAnswer("unsubscribe", { prepared: false }), ...sign]), proposedDiscountPct: null, rationale: "Opposition enregistrée : aucune sollicitation." };
  }
  if (ctx.analysis.intent === "accept") {
    return {
      subject,
      body: join([hello, wa ? null : "", wa ? `Merci pour votre confirmation !${emoji(v, "whatsapp", "✅")}` : "Je vous remercie pour votre confirmation.", wa ? null : "",
        `Votre commande${ctx.offer ? ` (proposition ${ctx.offer.number})` : ""} est bien prise en compte et transmise à nos équipes. Vous recevrez la confirmation de commande dès son enregistrement ; je vous tiens informé${ctx.contact?.salutation === "Mme" ? "e" : ""} de la suite.`, ...sign]),
      proposedDiscountPct: null,
      rationale: "Accord du client : confirmation et préparation de la demande de commande.",
    };
  }
  if (ctx.analysis.intent === "meeting_request") {
    return {
      subject,
      body: join([hello, wa ? null : "", "Avec plaisir. Je vous propose un point de 15 minutes, en visioconférence ou au showroom selon votre préférence.", "Quel créneau vous conviendrait cette semaine ou la suivante ? Votre commercial confirmera le rendez-vous.", ...sign]),
      proposedDiscountPct: null,
      rationale: "Demande de rendez-vous : prise de contact par le commercial (aucun créneau inventé).",
    };
  }
  if ((ctx.analysis.intent === "question" || (ctx.answers.length && !ctx.analysis.objection)) && wa && ctx.answers.length) {
    // WhatsApp : réponse de commerciale — remerciement, faits en phrases courtes, un argument de vente vérifié, conclusion.
    const pitch = ctx.salesFacts?.[0] ?? null;
    return {
      subject,
      body: join([hello, `Merci pour votre message${emoji(v, "whatsapp", "🙏")}`, ...ctx.answers,
        pitch ? `${pitch}${emoji(v, "whatsapp", "🔥")}` : null, unknownLine,
        `On lance la commande ? Un simple « OK » et je m'occupe de tout${emoji(v, "whatsapp", "🚀")}`, ...sign]),
      proposedDiscountPct: null,
      rationale: `Réponse factuelle à partir des données (${ctx.answers.length} élément(s))${pitch ? ", argument de vente vérifié" : ""}${ctx.unknownLabels.length ? `, ${ctx.unknownLabels.join(", ")} transmis au commercial` : ""}, conclusion vers la commande.`,
    };
  }
  if (ctx.analysis.intent === "question" || (ctx.answers.length && !ctx.analysis.objection)) {
    return {
      subject,
      body: join([hello, wa ? null : "", wa ? null : "Merci pour votre question.", ...facts, unknownLine ? (wa ? unknownLine : `\n${unknownLine}`) : null,
        // Une question sans réponse fiable n'appelle pas de vente : engagement de revenir avec l'information confirmée.
        ctx.answers.length ? (wa ? "Je vous prépare la commande sur cette base ?" : "\nSouhaitez-vous que je prépare la commande sur cette base ?") : unknownLine ? null : (wa ? "Je reviens vers vous dès que j'ai l'information confirmée." : "\nJe reviens vers vous dès que j'ai l'information confirmée."), ...sign]),
      proposedDiscountPct: null,
      rationale: `Réponse factuelle à partir des données (${ctx.answers.length} élément(s))${ctx.unknownLabels.length ? `, ${ctx.unknownLabels.join(", ")} transmis au commercial` : ""}.`,
    };
  }

  const o = ctx.analysis.objection ?? "no_response";
  if (ctx.playbook && ctx.playbook.strategy !== "respect" && o !== "refusal") return playbookReply(ctx, ctx.playbook, { v, wa, hello, sign, subject, join, unknownLine });
  if (ctx.playbook?.strategy === "respect" && (o === "no_need" || ctx.escalate))
    return {
      subject,
      body: join([hello, wa ? null : "", ctx.escalate ? "Merci pour votre retour. Je transmets votre demande à votre commercial, qui reprend le dossier avec vous." : "Entendu, je prends bonne note et je respecte votre décision. Je reste à votre disposition si votre besoin évolue.", ...sign]),
      proposedDiscountPct: null,
      rationale: "Décision du client respectée : aucune nouvelle proposition.",
    };
  const validity = ctx.offer ? fmtDate(ctx.offer.validUntil) : null;
  // Rappel factuel de l'offre en cours (données du système uniquement)
  const offerLine = ctx.offer ? `Pour rappel, votre proposition ${ctx.offer.number} s'élève à ${fmt(ctx.offer.totalHt)} HT${validity ? `, valable jusqu'au ${validity}` : ""}.` : null;
  const reply = (parts: (string | null)[], rationale: string, proposedDiscountPct: number | null = null): ObjectionReply => ({ subject, body: join([...parts, ...sign]), proposedDiscountPct, rationale });

  // Remise demandée ET accordée dans la limite de la politique : réponse claire, sans argumentaire contradictoire.
  if (ctx.analysis.requestedDiscountPct !== null && !ctx.escalate && ctx.allowedDiscountPct && ctx.allowedDiscountPct > 0) {
    const pct = ctx.allowedDiscountPct.toLocaleString("fr-FR");
    return reply([hello, wa ? null : "", `C'est entendu : je peux vous accorder ${pct} % sur ${ctx.offer ? `la proposition ${ctx.offer.number} (${fmt(ctx.offer.totalHt)} HT avant remise${validity ? `, valable jusqu'au ${validity}` : ""})` : "cette offre"}.`,
      wa ? null : "", wa ? "Un « OK » et je lance la commande ?" : "Je vous propose de valider la commande sur cette base : un « OK » suffit."], `Remise de ${pct} % accordée dans la limite de la politique.`, ctx.allowedDiscountPct);
  }
  // Remise demandée au-delà du plafond : la valeur est défendue, la demande est transmise (jamais promise).
  const discountEscalation = ctx.escalate && ctx.analysis.requestedDiscountPct !== null
    ? `Votre demande de remise dépasse ce que je suis en mesure d'accorder : je la transmets dès aujourd'hui à votre commercial, qui revient vers vous rapidement.${ctx.analysis.requestedQuantity ? ` J'ai bien noté la quantité envisagée (${ctx.analysis.requestedQuantity}).` : ""}`
    : null;

  switch (o) {
    case "competition":
      return reply([hello, wa ? null : "", OBJECTION_ARGUMENTS.competition, offerLine, ...facts, ctx.escalate ? "Je partage aussi votre remarque avec votre commercial pour que nous fassions la comparaison ensemble." : null,
        wa ? null : "", RESEARCH_QUESTIONS.competition!], "Concurrence : comparaison sur des bases identiques, conditions demandées, commercial informé.");
    case "think_later":
      return reply([hello, wa ? null : "", referenceAnswer("think_later", { prepared: false }), offerLine, wa ? null : "", "Lequel de ces points souhaitez-vous que je vous détaille en priorité ?"],
        "Hésitation : recherche du vrai point de blocage, synthèse proposée.");
    case "no_time":
      return reply([hello, wa ? null : "", "Je comprends, je fais court.", ctx.offer ? `• Proposition ${ctx.offer.number} : ${fmt(ctx.offer.totalHt)} HT${validity ? `, valable jusqu'au ${validity}` : ""}.` : null,
        "L'offre complète reste consultable quand cela vous convient.", wa ? null : "", "Un « OK » suffit pour valider : je m'occupe du reste ?"], "Client pressé : synthèse courte, validation simple.");
    case "existing_supplier":
      return reply([hello, wa ? null : "", referenceAnswer("existing_supplier", { prepared: !!ctx.offer }), offerLine, wa ? null : "", CLOSINGS.meeting], "Fournisseur en place : approche complémentaire, rendez-vous proposé.");
    case "no_need":
      return reply([hello, wa ? null : "", OBJECTION_ARGUMENTS.no_need, wa ? null : "", CLOSINGS.meeting], "Pas de besoin : décision respectée, échange court proposé.");
    default:
      break;
  }

  // Objection prix / budget : on défend la valeur avec les faits calculés par le système, puis on propose d'ajuster.
  const priceLike = o === "too_expensive" || o === "budget";
  const valueFacts = priceLike && ctx.salesFacts?.length ? ctx.salesFacts.slice(0, wa ? 2 : 3) : [];
  const argument = priceLike && valueFacts.length
    ? (v.tone === "dynamic" ? "Je comprends, mais cette offre vaut vraiment le coup :" : "Je comprends votre attention au prix. Quelques éléments sur cette offre :")
    : OBJECTION_ARGUMENTS[o];
  const parts: (string | null)[] = [hello, wa ? null : "", wa ? null : "Je vous remercie pour votre retour.", wa ? null : "", argument, ...valueFacts.map((f) => `• ${f}`), ...facts, priceLike ? offerLine : null];
  if (priceLike && !ctx.escalate)
    parts.push(wa ? null : "", "Si le montant vous freine, je peux ajuster les quantités ou vous préparer une sélection plus courte, centrée sur les références qui tournent le plus : dites-moi simplement le budget visé.");
  if (discountEscalation) parts.push(wa ? null : "", discountEscalation);
  if (unknownLine) parts.push(wa ? null : "", unknownLine);
  // E — engager une décision (sauf refus ; « trop cher » se termine déjà par la question du prix de vente cible)
  if (o !== "refusal" && o !== "too_expensive")
    parts.push(wa ? null : "", wa ? "On valide la commande sur cette base ?" : CLOSINGS.nextStep.replace("Je peux", "Je peux, si vous le souhaitez,").replace(".", " ?"));
  return reply(parts, ctx.escalate ? "Demande au-delà du plafond de remise : transfert au commercial, valeur de l'offre défendue." : `Réponse à l'objection « ${o} » en défendant la valeur de l'offre.`);
}

const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function playbookReply(
  ctx: ObjectionCtx, pb: PlaybookCtx,
  t: { v: Voice; wa: boolean; hello: string | null; sign: string[]; subject: string; join: (p: (string | null)[]) => string; unknownLine: string | null },
): ObjectionReply {
  const o = ctx.analysis.objection ?? "too_expensive";
  const gap = t.wa ? null : "";
  // P.R.O.V.E. : ouverture adaptée à ce que les outils ont réellement analysé et préparé
  const parts: (string | null)[] = [t.hello, gap, proveOpening(o, { prepared: !!pb.revised, analysed: pb.counterArguments.length > 0 || !!pb.declaredStock, dynamic: t.v.tone === "dynamic" })];
  if (pb.declaredStock) parts.push(`• Stock déclaré : ${Number(pb.declaredStock.qty)} pièce(s)${pb.declaredStock.productName ? ` de « ${pb.declaredStock.productName} »` : " (référence à préciser)"}.`);
  parts.push(...pb.counterArguments.slice(0, t.wa ? 2 : 3).map((a) => `• ${a}`));
  if (pb.removed.length) parts.push(gap, pb.removed.length === 1 ? `J'ai retiré « ${pb.removed[0]!.name} » : ${lc(pb.removed[0]!.reason)}` : "J'ai retiré :", ...(pb.removed.length > 1 ? pb.removed.slice(0, 3).map((r) => `• « ${r.name} » : ${lc(r.reason)}`) : []));
  if (pb.revised) {
    const docs = pb.revised.documents.length ? (t.wa ? " Je vous joins la proposition en PDF." : " Vous trouverez ci-joint la proposition et l'analyse de couverture détaillée (Excel, avec photos et niveau de confiance).") : "";
    parts.push(gap, `Nouvelle proposition ${pb.revised.number} : ${fmt(pb.revised.totalHt)} HT au lieu de ${fmt(pb.revised.originalTotalHt)} HT, ajustée à votre rythme de vente.${docs}`);
  } else if (pb.followUpDate) {
    parts.push(gap, `D'après ces éléments, votre stock couvre vos besoins pour l'instant : je reviens vers vous le ${fmtDate(pb.followUpDate)} pour refaire le point.`);
  }
  if (ctx.escalate) parts.push(gap, "Votre demande de remise dépasse ce que je peux accorder : je la transmets à votre commercial.");
  if (t.unknownLine) parts.push(gap, t.unknownLine);
  if (pb.counterArguments.some((a) => /estimation/.test(a))) parts.push(gap, t.wa ? "(Estimations d'après vos achats : vos chiffres de vente me permettraient d'affiner.)" : "Ces chiffres sont des estimations calculées à partir de vos achats ; si vous me transmettez votre stock ou vos sorties caisse, j'affine l'analyse.");
  if (pb.question) parts.push(gap, pb.question);
  return {
    subject: t.subject,
    body: t.join([...parts, ...t.sign]),
    proposedDiscountPct: null,
    rationale: pb.revised ? `Objection « ${o} » traitée par l'analyse : offre révisée ${pb.revised.number}.` : `Objection « ${o} » : offre défendue avec les données${pb.followUpDate ? ", reprise de contact planifiée" : ""}.`,
  };
}


export type ChatFacts = {
  question: string;
  topOpportunities: { customer: string; title: string; value: string | null; href: string }[];
  dormantCount: number;
  pendingApprovals: number;
  repliesToHandle: number;
};

export function mockChat(f: ChatFacts): ChatAnswer {
  const q = f.question.toLowerCase();
  if (/dormant|inactif/.test(q))
    return { answer: `J'ai identifié ${f.dormantCount} client(s) inactif(s) au-delà de leur rythme d'achat habituel. Je vous recommande de commencer par ceux dont le panier moyen est le plus élevé.`, suggestions: [{ label: "Voir les clients dormants", href: "/clients?statut=dormant" }] };
  if (/valid|approb/.test(q))
    return { answer: `${f.pendingApprovals} élément(s) attendent votre validation.`, suggestions: [{ label: "Voir les validations", href: "/#validations" }] };
  if (/répon|message|mail/.test(q))
    return { answer: `${f.repliesToHandle} réponse(s) client(s) sont à traiter.`, suggestions: [{ label: "Ouvrir les conversations", href: "/conversations" }] };
  const top = f.topOpportunities.slice(0, 3);
  return {
    answer: top.length
      ? `Voici mes priorités du jour :\n${top.map((t, i) => `${i + 1}. ${t.customer} — ${t.title}${t.value ? ` (potentiel estimé ${fmt(t.value)} HT)` : ""}`).join("\n")}`
      : "Aucune opportunité ouverte pour le moment. Importez vos factures pour que je puisse analyser votre portefeuille.",
    suggestions: top.map((t) => ({ label: t.customer.slice(0, 80), href: t.href })),
  };
}

export type FollowupCtx = {
  contact: ContactCtx;
  offer: { number: string; totalHt: string; validUntil: string | null } | null;
  attempt: number;
  senderName: string;
  companyName: string;
  voice?: Voice;
};

/** Relance sans réponse — courte, polie, sans nouvelle promesse. */
export function mockFollowup(ctx: FollowupCtx): EmailDraft {
  const v = parseVoice(ctx.voice);
  const validity = ctx.offer ? fmtDate(ctx.offer.validUntil) : null;
  // Chaque relance apporte un élément nouveau (validité, ajustement, rendez-vous) — jamais le même message.
  const intro = ctx.attempt <= 1
    ? `Un point utile sur ${ctx.offer ? `votre proposition ${ctx.offer.number}` : "notre dernier échange"} : je peux en ajuster les quantités à votre rythme de vente si besoin.`
    : `Dernier point sur ${ctx.offer ? `la proposition ${ctx.offer.number}` : "notre échange"} : ${CLOSINGS.meeting.charAt(0).toLowerCase()}${CLOSINGS.meeting.slice(1)}`;
  const body = [
    greeting(ctx.contact), "", intro,
    ctx.offer ? `Elle s'élève à ${fmt(ctx.offer.totalHt)} HT${validity ? ` et reste valable jusqu'au ${validity}` : ""}.` : "",
    "", v.tone === "dynamic" ? "Un simple « OK » et je lance la commande ; je peux aussi ajuster les quantités si besoin." : "Je peux enregistrer votre commande sur simple retour de votre part, ou ajuster les quantités si besoin.",
    ...signoff(v, ctx.senderName, ctx.companyName, "email"),
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
  return {
    subject: ctx.offer ? `Relance — proposition ${ctx.offer.number}` : "Relance",
    body,
    personalizationBasis: "generic",
    arguments: [`Relance n° ${ctx.attempt}`],
  };
}

export type MeetingCtx = {
  contact: ContactCtx;
  channel: "email" | "whatsapp";
  format: "visio" | "showroom" | "phone";
  newProductNames: string[];
  permanentsCount: number;
  senderName: string;
  companyName: string;
  voice?: Voice;
};

export const MEETING_FORMAT_LABEL = { visio: "en visioconférence", showroom: "dans notre showroom", phone: "par téléphone" } as const;

/** Proposition de rendez-vous : contexte utile au client, sans exposer d'analyse interne (baisse de CA, etc.), sans créneau inventé. */
export function mockMeetingProposal(ctx: MeetingCtx): EmailDraft {
  const v = parseVoice(ctx.voice);
  const where = MEETING_FORMAT_LABEL[ctx.format];
  const reasons = [
    ctx.permanentsCount ? `faire le point sur vos ${ctx.permanentsCount} références habituelles` : "faire le point sur vos besoins",
    ctx.newProductNames.length ? `vous présenter ${ctx.newProductNames.length === 1 ? "une nouveauté adaptée" : `${ctx.newProductNames.length} nouveautés adaptées`} à votre assortiment (${ctx.newProductNames.slice(0, 3).join(", ")})` : null,
  ].filter(Boolean).join(" et ");
  const body = ctx.channel === "whatsapp"
    ? `${greeting(ctx.contact).replace(/,$/, " !")}\nJe vous propose un point de 20 minutes ${where} pour ${reasons}. Quel créneau vous conviendrait cette semaine ou la suivante ?${emoji(v, "whatsapp", "📅")}\n${pushSignature(ctx.companyName)}`
    : `${greeting(ctx.contact)}

Je vous propose un rendez-vous de 20 minutes ${where} pour ${reasons}.

Quel créneau vous conviendrait cette semaine ou la suivante ? Je m'adapte à vos disponibilités.
${signoff(v, ctx.senderName, ctx.companyName, "email").join("\n")}`;
  return { subject: "Un point ensemble ?", body, personalizationBasis: ctx.permanentsCount ? "purchase_history" : "generic", arguments: [reasons] };
}
