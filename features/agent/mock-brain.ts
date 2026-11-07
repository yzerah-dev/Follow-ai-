/**
 * Cerveau SIMULÉ de LÉA — utilisé quand aucun fournisseur IA n'est configuré (LLM_PROVIDER=mock)
 * et dans les tests. Règles déterministes, clairement signalées dans l'interface (« IA simulée »).
 * Il respecte les mêmes contrats (schémas Zod) que le fournisseur réel.
 */
import { OBJECTION_LABEL, type EmailDraft, type ObjectionReply, type ReplyAnalysis, type Objection, type ChatAnswer } from "./schemas";
import { sanitizeText } from "@/lib/security/untrusted";

export type ContactCtx = { salutation: string | null; firstName: string | null; lastName: string | null } | null;

export type OfferEmailCtx = {
  customerName: string;
  contact: ContactCtx;
  offer: { number: string; validUntil: string | null; totalHt: string; lines: { reference: string; description: string; quantity: string }[] };
  history: { invoiceCount: number; usualReferences: string[] };
  newProductNames: string[];
  senderName: string;
  companyName: string;
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
};

export function greeting(contact: ContactCtx): string {
  if (contact?.salutation && contact.lastName) return `Bonjour ${contact.salutation === "Mme" ? "Madame" : "Monsieur"} ${contact.lastName},`;
  if (contact?.firstName || contact?.lastName) return `Bonjour ${[contact.firstName, contact.lastName].filter(Boolean).join(" ")},`;
  return "Bonjour,";
}

const fmt = (v: string) => `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ")} €`;
const fmtDate = (d: string | null) => (d ? new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)) : null);

export function mockOfferEmail(ctx: OfferEmailCtx): EmailDraft {
  const personalized = ctx.history.invoiceCount >= 3 && ctx.history.usualReferences.length > 0;
  const refs = ctx.offer.lines.slice(0, 6).map((l) => `• ${l.description} (réf. ${l.reference}) — ${Number(l.quantity)} unités`).join("\n");
  const intro = personalized
    ? `Au regard de vos derniers achats, j'ai préparé une sélection de réassort sur les références que vous travaillez régulièrement.`
    : `J'ai préparé une proposition sur une sélection de références de notre gamme.`;
  const news = ctx.newProductNames.length
    ? `\n\nJ'y ai ajouté ${ctx.newProductNames.length === 1 ? "une nouveauté susceptible" : `${ctx.newProductNames.length} nouveautés susceptibles`} de compléter votre assortiment : ${ctx.newProductNames.join(", ")}.`
    : "";
  const validity = fmtDate(ctx.offer.validUntil);
  const body = `${greeting(ctx.contact)}

${intro}${news}

${refs}

Le montant de la proposition s'élève à ${fmt(ctx.offer.totalHt)} HT${validity ? `, valable jusqu'au ${validity}` : ""}. Vous trouverez le détail dans l'offre ${ctx.offer.number} jointe.

Je peux enregistrer votre commande dès votre retour, ou organiser un rendez-vous de présentation en visioconférence si vous le souhaitez.

Bien cordialement,

${ctx.senderName}
${ctx.companyName}`;
  return {
    subject: personalized ? `Votre réassort — proposition ${ctx.offer.number}` : `Proposition commerciale ${ctx.offer.number}`,
    body,
    personalizationBasis: personalized ? "purchase_history" : "generic",
    arguments: [
      personalized ? `Basé sur ${ctx.history.invoiceCount} factures et vos références habituelles` : "Sélection de la gamme",
      "Quantités ajustées au colisage",
      ...(ctx.newProductNames.length ? ["Nouveautés en complément"] : []),
    ],
  };
}

const RULES: { objection: Objection; patterns: RegExp[] }[] = [
  { objection: "competition", patterns: [/concurren/i, /autre fournisseur/i, /ailleurs/i, /moins cher chez/i] },
  { objection: "delivery", patterns: [/frais de (port|livraison)/i, /\bfranco\b/i] }, // avant « trop élevé » : « frais de port trop élevés »
  { objection: "too_expensive", patterns: [/trop cher/i, /prix (trop )?élevé/i, /trop élevé/i, /\bremise\b/i, /réduction/i, /geste commercial/i, /baisser (le|vos) prix/i] },
  { objection: "stock_available", patterns: [/encore du stock/i, /il nous en reste/i, /stock suffisant/i, /déjà (du|en) stock/i, /pas encore écoulé/i] },
  { objection: "budget", patterns: [/budget/i, /trésorerie/i] },
  { objection: "delivery", patterns: [/frais de port/i, /livraison/i, /transport/i, /franco/i] },
  { objection: "lead_time", patterns: [/délai/i, /quand (pourriez|pouvez)/i, /date de livraison/i, /au plus vite/i] },
  { objection: "no_time", patterns: [/pas le temps/i, /débordé/i, /plus tard/i, /rappelez/i] },
  { objection: "no_need", patterns: [/pas besoin/i, /pas nécessaire/i, /pas intéressé/i] },
  { objection: "refusal", patterns: [/non merci/i, /ne souhaitons pas/i, /ne sommes pas intéressés/i] },
];

export function mockAnalyzeReply(text: string): ReplyAnalysis {
  const t = sanitizeText(text, 6000);
  const discount = t.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s?%/);
  const qty = t.match(/(\d{1,6})\s?(unités|pièces|colis|cartons|pcs)/i);
  const price = t.match(/(\d{1,6}(?:[.,]\d{1,2})?)\s?(€|euros?)\s?(HT)?/i);
  if (/désinscri|ne plus recevoir|retirez[- ]moi|\bstop\b/i.test(t))
    return { intent: "unsubscribe", objection: null, requestedDiscountPct: null, requestedQuantity: null, targetPrice: null, sentiment: "negative", summary: "Le client demande à ne plus être sollicité.", nextAction: "Inscrire l'adresse en liste d'opposition et cesser les envois." };
  if (/absent|out of office|congés jusqu/i.test(t) && t.length < 400)
    return { intent: "out_of_office", objection: null, requestedDiscountPct: null, requestedQuantity: null, targetPrice: null, sentiment: "neutral", summary: "Réponse automatique d'absence.", nextAction: "Reprogrammer la relance après la date de retour." };
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

const OBJECTION_ARGUMENTS: Record<Objection, string> = {
  too_expensive: "Je comprends votre attention portée au prix. Les tarifs de cette proposition sont ceux de vos conditions en vigueur et les quantités sont calées sur votre rythme de vente habituel, ce qui limite le stock immobilisé.",
  no_need: "Je comprends. Si votre besoin évolue, je reste à votre disposition ; je peux aussi vous présenter nos nouveautés lors d'un court échange.",
  stock_available: "C'est noté. Je peux décaler la livraison ou ajuster les quantités pour qu'elles correspondent à l'écoulement de votre stock actuel.",
  competition: "Merci pour votre transparence. Au-delà du prix, nous vous garantissons la continuité de vos références habituelles et un interlocuteur dédié ; si vous m'indiquez les références et le prix constaté, je fais le point avec mon responsable.",
  budget: "Je comprends la contrainte budgétaire. Nous pouvons fractionner la proposition et commencer par les références qui tournent le plus vite chez vous.",
  delivery: "Concernant la livraison, je vérifie les conditions applicables à votre compte et reviens vers vous avec une réponse précise.",
  lead_time: "Concernant les délais, je confirme la disponibilité de chaque référence auprès de notre logistique avant de vous donner une date ferme.",
  no_time: "Je comprends que votre emploi du temps est chargé. Je vous propose de valider la commande directement par retour d'email, ou un échange de 10 minutes au moment qui vous convient.",
  refusal: "Je prends bonne note de votre retour et vous remercie de votre réponse. Je reste à votre disposition pour vos prochains besoins.",
  no_response: "Je me permets de revenir vers vous concernant notre proposition.",
};

export function mockObjectionReply(ctx: ObjectionCtx): ObjectionReply {
  const wa = ctx.channel === "whatsapp";
  const subject = ctx.offer ? `RE: Proposition ${ctx.offer.number}` : "RE: Votre message";
  // WhatsApp : ton de messagerie, court ; pas de formule d'appel répétée au fil de la discussion.
  const hello = wa ? (ctx.turn > 0 ? null : greeting(ctx.contact).replace(/,$/, " !")) : greeting(ctx.contact);
  const sign = wa ? [`— LÉA, ${ctx.companyName}`] : ["", "Bien cordialement,", "", ctx.senderName, ctx.companyName];
  const facts = ctx.answers.length ? (wa ? ctx.answers.map((a) => `• ${a}`) : ["", ...ctx.answers.map((a) => `• ${a}`)]) : [];
  const unknownLine = ctx.unknownLabels.length
    ? `Concernant ${ctx.unknownLabels.join(" et ")}, je vérifie auprès de votre commercial et je reviens vers vous très vite${wa ? "." : " avec une réponse précise."}`
    : null;
  const join = (parts: (string | null)[]) => parts.filter((x): x is string => x !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();

  if (ctx.analysis.intent === "accept") {
    return {
      subject,
      body: join([hello, wa ? null : "", wa ? "Merci pour votre confirmation !" : "Je vous remercie pour votre confirmation.", wa ? null : "",
        `Votre commande${ctx.offer ? ` (proposition ${ctx.offer.number})` : ""} est bien prise en compte et transmise à nos équipes. Vous recevrez la confirmation de commande dès son enregistrement.`, ...sign]),
      proposedDiscountPct: null,
      rationale: "Accord du client : confirmation et préparation de la demande de commande.",
    };
  }
  if (ctx.analysis.intent === "meeting_request") {
    return {
      subject,
      body: join([hello, wa ? null : "", "Avec plaisir.", "Votre commercial vous contacte très prochainement pour convenir d'un créneau, en visioconférence ou au showroom selon votre préférence.", ...sign]),
      proposedDiscountPct: null,
      rationale: "Demande de rendez-vous : prise de contact par le commercial (aucun créneau inventé).",
    };
  }
  if (ctx.analysis.intent === "question" || (ctx.answers.length && !ctx.analysis.objection)) {
    return {
      subject,
      body: join([hello, wa ? null : "", wa ? null : "Merci pour votre question.", ...facts, unknownLine ? (wa ? unknownLine : `\n${unknownLine}`) : null,
        wa ? "Je vous prépare la commande sur cette base ?" : "\nSouhaitez-vous que je prépare la commande sur cette base ?", ...sign]),
      proposedDiscountPct: null,
      rationale: `Réponse factuelle à partir des données (${ctx.answers.length} élément(s))${ctx.unknownLabels.length ? `, ${ctx.unknownLabels.join(", ")} transmis au commercial` : ""}.`,
    };
  }

  const o = ctx.analysis.objection ?? "no_response";
  const parts: (string | null)[] = [hello, wa ? null : "", wa ? null : "Je vous remercie pour votre retour.", wa ? null : "", OBJECTION_ARGUMENTS[o], ...facts];
  let proposed: number | null = null;
  if (ctx.analysis.requestedDiscountPct !== null || o === "too_expensive" || o === "competition") {
    if (ctx.escalate) {
      parts.push(wa ? null : "", `Votre demande dépasse ce que je suis en mesure de vous accorder directement : je la transmets dès aujourd'hui à votre commercial, qui revient vers vous rapidement.${ctx.analysis.requestedQuantity ? ` J'ai bien noté la quantité envisagée (${ctx.analysis.requestedQuantity}).` : ""}`);
    } else if (ctx.allowedDiscountPct && ctx.allowedDiscountPct > 0) {
      proposed = ctx.allowedDiscountPct;
      parts.push(wa ? null : "", `Pour concrétiser votre commande, je peux vous accorder un geste de ${ctx.allowedDiscountPct.toLocaleString("fr-FR")} % sur cette offre${ctx.offer ? ` (${ctx.offer.number})` : ""}.`);
    }
  }
  if (unknownLine) parts.push(wa ? null : "", unknownLine);
  if (o !== "refusal") parts.push(wa ? null : "", wa ? "On valide la commande sur cette base ?" : "Souhaitez-vous que je prépare la commande sur cette base, ou préférez-vous en discuter lors d'un rendez-vous en visioconférence ?");
  return {
    subject,
    body: join([...parts, ...sign]),
    proposedDiscountPct: proposed,
    rationale: ctx.escalate
      ? "Demande au-delà du plafond de remise : transfert au commercial, valeur de l'offre défendue."
      : `Réponse à l'objection « ${o} » en défendant la valeur de l'offre${proposed ? `, geste de ${proposed} % dans la limite de la politique` : ""}.`,
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
};

/** Relance sans réponse — courte, polie, sans nouvelle promesse. */
export function mockFollowup(ctx: FollowupCtx): EmailDraft {
  const validity = ctx.offer ? fmtDate(ctx.offer.validUntil) : null;
  const intro = ctx.attempt <= 1
    ? `Je me permets de revenir vers vous concernant ${ctx.offer ? `notre proposition ${ctx.offer.number}` : "notre dernier échange"}.`
    : `Je reviens une dernière fois vers vous au sujet de ${ctx.offer ? `notre proposition ${ctx.offer.number}` : "notre échange"}.`;
  const body = [
    greeting(ctx.contact), "", intro,
    ctx.offer ? `Elle s'élève à ${fmt(ctx.offer.totalHt)} HT${validity ? ` et reste valable jusqu'au ${validity}` : ""}.` : "",
    "", "Je peux enregistrer votre commande sur simple retour de votre part, ou ajuster les quantités si besoin.",
    "", "Bien cordialement,", "", ctx.senderName, ctx.companyName,
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
};

export const MEETING_FORMAT_LABEL = { visio: "en visioconférence", showroom: "dans notre showroom", phone: "par téléphone" } as const;

/** Proposition de rendez-vous : contexte utile au client, sans exposer d'analyse interne (baisse de CA, etc.), sans créneau inventé. */
export function mockMeetingProposal(ctx: MeetingCtx): EmailDraft {
  const where = MEETING_FORMAT_LABEL[ctx.format];
  const reasons = [
    ctx.permanentsCount ? `faire le point sur vos ${ctx.permanentsCount} références habituelles` : "faire le point sur vos besoins",
    ctx.newProductNames.length ? `vous présenter ${ctx.newProductNames.length === 1 ? "une nouveauté adaptée" : `${ctx.newProductNames.length} nouveautés adaptées`} à votre assortiment (${ctx.newProductNames.slice(0, 3).join(", ")})` : null,
  ].filter(Boolean).join(" et ");
  const body = ctx.channel === "whatsapp"
    ? `${greeting(ctx.contact).replace(/,$/, " !")}\nJe vous propose un point de 20 minutes ${where} pour ${reasons}. Quel créneau vous conviendrait cette semaine ou la suivante ?\n— LÉA, ${ctx.companyName}`
    : `${greeting(ctx.contact)}

Je vous propose un rendez-vous de 20 minutes ${where} pour ${reasons}.

Quel créneau vous conviendrait cette semaine ou la suivante ? Je m'adapte à vos disponibilités.

Bien cordialement,

${ctx.senderName}
${ctx.companyName}`;
  return { subject: "Un point ensemble ?", body, personalizationBasis: ctx.permanentsCount ? "purchase_history" : "generic", arguments: [reasons] };
}
