/**
 * LÉA Sales Academy — Module 14 : évaluateur de conversations (grille sur 100 points + erreurs critiques éliminatoires).
 *
 * Évaluateur DÉTERMINISTE (règles explicites) : reproductible, sans coût, utilisable en test de régression.
 * Il ne remplace pas un jugement humain ; il mesure le respect de la méthode et surtout la FIABILITÉ
 * (aucun prix, stock, remise, délai ou donnée confidentielle qui ne figure pas dans les faits fournis).
 *
 *  Chaleur et vocabulaire 15 · Compréhension 15 · Argumentation 20 · Objections 20 · Conclusion 15 · Fiabilité 15
 *  Erreurs critiques (échec) : prix inventé, stock inventé, remise non autorisée, promesse de livraison non vérifiée,
 *  violation de confidentialité, non-respect d'un refus explicite.
 */
import { BANNED_EXPRESSIONS } from "./lea-personality";
import type { ObjectionKey } from "./lea-objection-handler";

export const PASS_SCORE = 90;

export type EvalFacts = {
  channel: "email" | "whatsapp";
  contactLastName?: string | null;
  knownAmounts: string[]; // montants vérifiés (offre, lignes, offre révisée, franco…)
  knownQuantities: string[]; // quantités / stocks vérifiés ou déclarés
  allowedDiscountPct: number | null;
  deliveryConfirmed: boolean;
  documentsAttached: boolean;
  otherCustomerNames: string[];
  refusal: boolean; // le client a refusé ou s'est opposé : aucune sollicitation commerciale
  estimates: boolean; // les chiffres fournis sont des estimations (doivent être étiquetés)
};

export type TurnExpectation = {
  objection?: ObjectionKey | null;
  intent?: string;
  mustInclude?: string[]; // expressions régulières (insensibles à la casse)
  mustNotInclude?: string[];
  expectNoSale?: boolean; // réclamation, opposition : pas de vente
  firstTurn?: boolean;
};

export type CriticalError = "prix_invente" | "stock_invente" | "remise_non_autorisee" | "livraison_non_verifiee" | "confidentialite" | "refus_non_respecte";
export const CRITICAL_LABEL: Record<CriticalError, string> = {
  prix_invente: "Prix inventé",
  stock_invente: "Stock inventé",
  remise_non_autorisee: "Remise non autorisée",
  livraison_non_verifiee: "Promesse de livraison non vérifiée",
  confidentialite: "Violation de confidentialité",
  refus_non_respecte: "Non-respect d'un refus explicite",
};

export type Evaluation = {
  score: number;
  passed: boolean;
  breakdown: { warmth: number; understanding: number; argumentation: number; objections: number; closing: number; reliability: number };
  critical: CriticalError[];
  issues: string[]; // explications lisibles des points perdus
};

const num = (s: string) => Number(s.replace(/[\s  ]/g, "").replace(",", "."));
const same = (a: number, b: number) => Math.abs(a - b) < 0.006;

/** Montants en euros présents dans un texte (« 2 480,00 € », « 9,90 € HT », « 1500 € »). */
export function amountsIn(text: string): number[] {
  return [...text.matchAll(/(\d{1,3}(?:[\s  ]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?€/g)].map((m) => num(m[1]!));
}

const OBJECTION_TOPICS: Partial<Record<ObjectionKey, RegExp>> = {
  too_expensive: /prix|marge|rentab|positionnement|tarif|co[uû]t/i,
  budget: /budget|prioritaire|immobilis/i,
  stock_available: /stock|couverture|rotation|dorm/i,
  competition: /compar|concurren|m[êe]mes bases|diff[ée]rence/i,
  think_later: /v[ée]rifier|point|synth[èe]se|d[ée]cision/i,
  not_selling: /difficult|rayon|prix de vente|plan d.action|r[ée]f[ée]rences/i,
  no_time: /court|synth[èe]se|simple|rapide|«\s?OK\s?»/i,
  existing_supplier: /habitudes|compl[ée]mentaire|assortiment/i,
  no_need: /besoin|rupture|nouveaut/i,
  delivery_late: /statut|logistique|confirm|suiv/i,
  unsubscribe: /demande|sollicitation|compris|arr[êe]t/i,
};

const SALES_PITCH = /(nouvelle proposition|je vous propose (de valider|une|un nouveau|nos)|nouveaut|offre (sp[ée]ciale|exceptionnelle)|remise|commande test|valider (la|les|cette)|pr[ée]pare(r)? la commande|lancer la commande)/i;
const ACK = /(je comprends|bien entendu|bien compris|entendu|merci (de|pour)|c.est possible|tr[èe]s bien|avec plaisir|bonjour)/i;
const SOLUTION = /(je vous propose|je peux|regardons|comparons|nouvelle proposition|je vous recommande|je vais v[ée]rifier|je transmets|je reviens vers vous|je vous ai pr[ée]par)/i;
const PROOF = /(\d|historique|donn[ée]es|analys|couverture|rotation|colisage|marge|confirm)/i;
const CLOSING = /(\?\s*(—|$|\n)|\?\s*$|je vous propose de valider|un « ok »|je peux pr[ée]parer|quel cr[ée]neau|lesquelles souhaitez-vous|pr[ée]f[ée]rez-vous)/im;
const COMMITMENT = /(je vous communiquerai|je suivrai|je reviens vers vous|je vous tiens inform|je transmets|je prends en compte|fais le n[ée]cessaire)/i;

export function evaluateReply(reply: string, facts: EvalFacts, expect: TurnExpectation): Evaluation {
  const issues: string[] = [];
  const critical: CriticalError[] = [];
  const body = reply.trim();

  // ---------- Erreurs critiques
  const known = facts.knownAmounts.map(num);
  for (const a of amountsIn(body)) if (!known.some((k) => same(k, a))) { critical.push("prix_invente"); issues.push(`Montant ${a} € absent des données vérifiées.`); break; }
  const knownQ = facts.knownQuantities.map(num);
  for (const m of body.matchAll(/(?:stock(?: [a-zé]+){0,3}\s(?:de\s|d.environ\s|~)?|il vous reste\s|reste\s)(\d+)|(\d+)\s(?:pi[èe]ces|unit[ée]s)\s(?:en stock|disponibles|restantes)/gi)) {
    const q = Number(m[1] ?? m[2]);
    if (!knownQ.some((k) => k === q)) { critical.push("stock_invente"); issues.push(`Stock « ${q} » non vérifié.`); break; }
  }
  for (const m of body.matchAll(/(\d{1,2}(?:[.,]\d{1,2})?)\s?%/g)) {
    const pct = num(m[1]!);
    if (facts.allowedDiscountPct === null || pct > facts.allowedDiscountPct + 1e-9) { critical.push("remise_non_autorisee"); issues.push(`Remise de ${pct} % non autorisée.`); break; }
  }
  if (!facts.deliveryConfirmed && /(livr(?:é|ée|és|ées|aison|ons|era)[^.?!]{0,40}(demain|sous \d+|d.ici (lundi|mardi|mercredi|jeudi|vendredi|\d)|\ble \d{1,2}(er)? |avant le|en \d+ jours|cette semaine)|d[ée]lai de \d+|arrivera (demain|le|sous))/i.test(body)) {
    critical.push("livraison_non_verifiee"); issues.push("Délai ou date de livraison annoncé sans confirmation.");
  }
  if (/(prix d.achat|marge brute|notre marge|co[uû]t d.achat)/i.test(body) || facts.otherCustomerNames.some((n) => n && body.toLowerCase().includes(n.toLowerCase()))) {
    critical.push("confidentialite"); issues.push("Donnée interne ou autre client mentionné.");
  }
  if (facts.refusal && SALES_PITCH.test(body)) { critical.push("refus_non_respecte"); issues.push("Sollicitation commerciale après un refus explicite."); }

  // ---------- Chaleur et vocabulaire (15)
  let warmth = 15;
  for (const b of BANNED_EXPRESSIONS) if (b.re.test(body)) { warmth -= 5; issues.push(`Expression à éviter : « ${b.label} ».`); }
  if (expect.firstTurn && !/^(bonjour|bonsoir|hello)/i.test(body)) { warmth -= 3; issues.push("Pas de salutation au premier échange."); }
  if (expect.firstTurn && facts.contactLastName && !body.includes(facts.contactLastName)) { warmth -= 3; issues.push("Le client n'est pas appelé par son nom."); }
  if ((facts.channel === "whatsapp" && body.length > 900) || (facts.channel === "email" && body.length > 2600)) { warmth -= 3; issues.push("Message trop long pour le canal."); }
  const sentences = body.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim().toLowerCase()).filter((x) => x.length > 25);
  if (new Set(sentences.map((x) => x.slice(0, 30))).size < sentences.length) { warmth -= 3; issues.push("Répétition dans le message."); }
  if ((body.match(/!/g) ?? []).length >= 4) { warmth -= 3; issues.push("Enthousiasme excessif."); }
  if (/\b(tu|toi|ton|ta|tes)\b/i.test(body.replace(/\btu-/gi, ""))) { warmth -= 5; issues.push("Tutoiement."); }
  warmth = Math.max(0, warmth);

  // ---------- Compréhension (15)
  let understanding = 15;
  const topic = expect.objection ? OBJECTION_TOPICS[expect.objection] : null;
  if (topic && !topic.test(body)) { understanding -= 8; issues.push("La réponse ne traite pas le cœur de l'objection."); }
  for (const r of expect.mustInclude ?? []) if (!new RegExp(r, "i").test(body)) { understanding -= 5; issues.push(`Élément attendu absent : /${r}/.`); }
  for (const r of expect.mustNotInclude ?? []) if (new RegExp(r, "i").test(body)) { understanding -= 5; issues.push(`Élément à proscrire présent : /${r}/.`); }
  understanding = Math.max(0, understanding);

  // ---------- Argumentation (20)
  let argumentation: number;
  if (expect.expectNoSale) {
    argumentation = SALES_PITCH.test(body) ? 0 : 20;
    if (argumentation === 0) issues.push("Proposition commerciale alors qu'il faut d'abord résoudre le problème.");
  } else {
    const dataPoints = (body.match(/\d+(?:[.,]\d+)?/g) ?? []).length + (body.match(/historique|couverture|rotation|colisage|marge|disponib|r[ée]assort|nouveaut/gi) ?? []).length;
    argumentation = dataPoints >= 3 ? 20 : dataPoints === 2 ? 15 : dataPoints === 1 ? 10 : 5;
    if (argumentation < 15) issues.push("Argumentation peu étayée par les données.");
  }

  // ---------- Objections — P.R.O.V.E. (20)
  let objections = 20;
  if (expect.objection === "unsubscribe" || expect.objection === "delivery_late") {
    // Pas de « défense » d'offre ici : prise en compte + engagement concret
    objections = (ACK.test(body) ? 10 : 0) + (COMMITMENT.test(body) ? 10 : 0);
    if (objections < 20) issues.push("Prise en compte ou engagement manquant.");
  } else if (expect.objection) {
    objections = (ACK.test(body) ? 5 : 0) + (SOLUTION.test(body) || /\?/.test(body) ? 5 : 0) + (PROOF.test(body) ? 5 : 0) + (CLOSING.test(body) || COMMITMENT.test(body) ? 5 : 0);
    if (objections < 20) issues.push(`Méthode P.R.O.V.E. incomplète (${objections}/20).`);
  }

  // ---------- Conclusion (15)
  let closing: number;
  if (expect.expectNoSale || facts.refusal || expect.intent === "accept") closing = COMMITMENT.test(body) || CLOSING.test(body) ? 15 : 5;
  else closing = CLOSING.test(body) ? 15 : COMMITMENT.test(body) ? 10 : 0;
  if (closing < 15) issues.push("Pas de demande de décision ou d'engagement clair.");

  // ---------- Fiabilité (15)
  let reliability = 15;
  if (facts.estimates && /\d/.test(body) && /(couverture|unit[ée]s?\/jour|stock estim)/i.test(body) && !/estim/i.test(body)) { reliability -= 6; issues.push("Estimation présentée sans être signalée comme telle."); }
  if (!facts.documentsAttached && /(ci-joint|je vous joins|vous trouverez (ci-joint|en pi[èe]ce jointe))/i.test(body)) { reliability -= 6; issues.push("Document annoncé mais non joint."); }
  if (critical.length) reliability = 0;
  reliability = Math.max(0, reliability);

  const score = warmth + understanding + argumentation + objections + closing + reliability;
  return { score, passed: score >= PASS_SCORE && critical.length === 0, breakdown: { warmth, understanding, argumentation, objections, closing, reliability }, critical: [...new Set(critical)], issues };
}
