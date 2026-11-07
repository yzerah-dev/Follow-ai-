/**
 * Réponses factuelles aux questions des clients — 100 % issues des données de l'organisation.
 * Ce qui n'est pas connu n'est JAMAIS inventé : il est signalé et transmis au commercial.
 * Utilisé par le cerveau simulé ET fourni au modèle IA réel comme seule base autorisée.
 */
import { dec } from "@/lib/money";

export const TOPICS = ["price", "total", "validity", "availability", "franco", "delivery_time", "payment", "packaging", "minimum"] as const;
export type Topic = (typeof TOPICS)[number];

export const TOPIC_LABEL: Record<Topic, string> = {
  price: "les prix",
  total: "le montant",
  validity: "la validité de l'offre",
  availability: "la disponibilité",
  franco: "le franco de port",
  delivery_time: "le délai de livraison",
  payment: "les conditions de paiement",
  packaging: "le conditionnement",
  minimum: "le minimum de commande",
};

const RULES: { topic: Topic; re: RegExp }[] = [
  { topic: "validity", re: /(jusqu'?\s?(à|a) quand|valable|validit|expire)/i },
  { topic: "total", re: /(montant|total|combien (au total|en tout|ça fait)|ça fait combien)/i },
  { topic: "price", re: /(prix|tarif|co[uû]te|combien|€ (l'unité|pièce)|prix unitaire)/i },
  { topic: "availability", re: /(stock|disponib|dispo\b|en rupture|vous (en )?avez)/i },
  { topic: "franco", re: /(franco|frais de port|port offert|frais de livraison|transport)/i },
  { topic: "delivery_time", re: /(délai|delai|quand (serons|serai|sera|pourriez|pouvez)|date de livraison|livr(é|e|er) (quand|sous)|sous combien de temps)/i },
  { topic: "payment", re: /(paiement|payer|règlement|reglement|facturation|échéance|traite|virement|chèque)/i },
  { topic: "packaging", re: /(colis|carton|colisage|conditionn|par combien|pcb|à l'unité)/i },
  { topic: "minimum", re: /(minimum|mini de commande|commande minimale)/i },
];

export function detectTopics(text: string): Topic[] {
  return [...new Set(RULES.filter((r) => r.re.test(text)).map((r) => r.topic))];
}

export type FactLine = { reference: string; description: string; quantity: string; unitPriceHt: string; unitsPerCase: number | null; availability: string; qtyAvailable: string | null; availableFrom: string | null };
export type Facts = {
  offer: { number: string; validUntil: string | null; totalHt: string; totalTtc: string; lines: FactLine[] } | null;
  customer: { francoAmount: string | null; minOrderAmount: string | null; paymentTerms: string | null };
};

const eur = (v: string) => `${dec(v).toNumber().toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ")} €`;
const date = (d: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Lignes de l'offre explicitement citées par le client (référence ou mot significatif de la désignation). */
function mentioned(lines: FactLine[], text: string): FactLine[] {
  const t = norm(text);
  return lines.filter((l) => t.includes(norm(l.reference)) || norm(l.description).split(/\s+/).some((w) => w.length >= 5 && t.includes(w)));
}

export function answerFromFacts(topics: Topic[], facts: Facts, text: string): { answers: string[]; unknown: Topic[] } {
  const answers: string[] = [];
  const unknown: Topic[] = [];
  const o = facts.offer;
  const focus = o ? (mentioned(o.lines, text).length ? mentioned(o.lines, text) : o.lines).slice(0, 5) : [];
  for (const topic of topics) {
    switch (topic) {
      case "price":
        if (!o) unknown.push(topic);
        else answers.push(...focus.map((l) => `${l.description} (réf. ${l.reference}) : ${eur(l.unitPriceHt)} HT l'unité.`));
        break;
      case "total":
        if (!o) unknown.push(topic);
        else answers.push(`Le montant de la proposition ${o.number} est de ${eur(o.totalHt)} HT, soit ${eur(o.totalTtc)} TTC.`);
        break;
      case "validity":
        if (!o?.validUntil) unknown.push(topic);
        else answers.push(`La proposition ${o.number} est valable jusqu'au ${date(o.validUntil)}.`);
        break;
      case "availability": {
        if (!o) {
          unknown.push(topic);
          break;
        }
        let anyUnknown = false;
        for (const l of focus) {
          if (l.availability === "unknown") anyUnknown = true;
          else if (l.availability === "out_of_stock" || l.availability === "on_order")
            answers.push(`${l.description} : en réapprovisionnement${l.availableFrom ? `, disponible à partir du ${date(l.availableFrom)}` : " (date à confirmer)"}.`);
          else if (l.qtyAvailable !== null && dec(l.qtyAvailable).lt(dec(l.quantity))) answers.push(`${l.description} : stock disponible inférieur à la quantité proposée, je fais confirmer le reliquat.`);
          else answers.push(`${l.description} : disponible en stock pour la quantité proposée.`);
        }
        if (anyUnknown) unknown.push(topic);
        break;
      }
      case "franco":
        if (!facts.customer.francoAmount) unknown.push(topic);
        else {
          const reached = o ? dec(o.totalHt).gte(dec(facts.customer.francoAmount)) : null;
          answers.push(`Votre franco de port est de ${eur(facts.customer.francoAmount)} HT${reached === null ? "." : reached ? " : cette commande l'atteint, le port est offert." : ` : il manque ${eur(dec(facts.customer.francoAmount).minus(dec(o!.totalHt)).toFixed(2))} HT pour l'atteindre.`}`);
        }
        break;
      case "payment":
        if (!facts.customer.paymentTerms) unknown.push(topic);
        else answers.push(`Vos conditions de paiement : ${facts.customer.paymentTerms}.`);
        break;
      case "packaging": {
        if (!o) {
          unknown.push(topic);
          break;
        }
        const known = focus.filter((l) => l.unitsPerCase);
        if (!known.length) unknown.push(topic);
        answers.push(...known.map((l) => `${l.description} : colis de ${l.unitsPerCase} unités.`));
        break;
      }
      case "minimum":
        if (!facts.customer.minOrderAmount) unknown.push(topic);
        else answers.push(`Le minimum de commande sur votre compte est de ${eur(facts.customer.minOrderAmount)} HT.`);
        break;
      case "delivery_time":
        unknown.push(topic); // aucune donnée logistique fiable : jamais de délai inventé
        break;
    }
  }
  return { answers, unknown };
}
