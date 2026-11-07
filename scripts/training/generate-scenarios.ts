/**
 * Génère les scénarios d'entraînement de LÉA (Academy, module 14) : 15 catégories × 7 personas = 105 scénarios
 * de plusieurs échanges, avec données d'achat, offre, politique de remise et attentes par tour.
 * Usage : npx tsx scripts/training/generate-scenarios.ts   → training/scenarios/<catégorie>.json
 * Les données sont fictives (aucun client réel).
 */
import { mkdirSync, writeFileSync } from "node:fs";

const TODAY = "2026-11-06";
const day = (n: number) => new Date(Date.UTC(2026, 10, 6) - n * 86_400_000).toISOString().slice(0, 10);
const PERSONAS = [
  { salutation: "M.", firstName: "Paul", lastName: "Martin", customer: "Maison Martin", channel: "email" },
  { salutation: "Mme", firstName: "Sophie", lastName: "Robert", customer: "Bazar des Vignes", channel: "whatsapp" },
  { salutation: "M.", firstName: "Karim", lastName: "Benali", customer: "Discount Benali", channel: "email" },
  { salutation: "Mme", firstName: "Claire", lastName: "Durand", customer: "Comptoir Durand", channel: "whatsapp" },
  { salutation: "M.", firstName: "Hugo", lastName: "Lefèvre", customer: "Hyper Lefèvre", channel: "email" },
  { salutation: "Mme", firstName: "Nadia", lastName: "Moreau", customer: "Marché Moreau", channel: "email" },
  { salutation: "M.", firstName: "Louis", lastName: "Garnier", customer: "Garnier Distribution", channel: "whatsapp" },
] as const;

const PRODUCTS = [
  ["Poêle 28 cm induction", "Plaid Duo", "Boîte hermétique", "Bougie parfumée"],
  ["Torchons x3", "Couronne Lin", "Vase Classique", "Photophore Bleu nuit"],
  ["Gants de jardin Duo", "Arrosoir Bambou", "Tuyau Bambou", "Semis Classique"],
];

/** 4 lignes : A en rupture, B à surveiller, C rotation lente, D couverte (historiques réalistes, prix différents). */
function offerFor(k: number, lineCount?: number) {
  const names = PRODUCTS[k % PRODUCTS.length]!;
  const price = (b: number) => (b + (k % 5) * 0.37).toFixed(2);
  const mk = (i: number, desc: string, qty: number, upc: number, unit: string, purchases: { date: string; qty: string }[]) =>
    ({ productId: `p${k}-${i}`, reference: `R${k}${i}`, description: desc, quantity: String(qty), unitPriceHt: unit, unitsPerCase: upc, availability: "in_stock", qtyAvailable: null, availableFrom: null, purchases });
  const lines = [
    mk(1, names[0]!, 24, 6, price(9.9), [121, 91, 61, 31].map((d) => ({ date: day(d), qty: "24" }))),
    mk(2, names[1]!, 12, 6, price(14.5), [100, 70, 40, 10].map((d) => ({ date: day(d), qty: "12" }))),
    mk(3, names[2]!, 30, 6, price(4.2), [260, 230, 200].map((d) => ({ date: day(d), qty: "30" }))),
    mk(4, names[3]!, 48, 12, price(3.1), [140, 95, 50, 5].map((d) => ({ date: day(d), qty: "48" }))),
  ];
  const total = lines.reduce((a, l) => a + Number(l.quantity) * Number(l.unitPriceHt), 0).toFixed(2);
  return { number: `OF-2026-${String(100 + k).padStart(5, "0")}`, totalHt: total, validUntil: "2026-12-06", lineCount, lines };
}

type Turn = { customer: string; expect: Record<string, unknown> };
type Cat = { key: string; title: string; persona: string; exam?: number; turns: (k: number, o: ReturnType<typeof offerFor>) => Turn[]; lineCount?: number; docs?: boolean };

const CATS: Cat[] = [
  { key: "acheteur-sympathique", title: "Acheteur sympathique : question prix puis accord", persona: "Acheteur cordial, client régulier", docs: true,
    turns: (_, o) => [
      { customer: `Bonjour Léa ! Quel est le prix de la référence ${o.lines[0]!.reference} ?`, expect: { intent: "question", mustInclude: ["€"] } },
      { customer: "Parfait, ok pour moi, vous pouvez lancer la commande.", expect: { intent: "accept", mustInclude: ["commande"] } },
    ] },
  { key: "acheteur-agressif", title: "Acheteur agressif : prix et remise excessive", persona: "Acheteur agressif, menace de partir",
    turns: () => [
      { customer: "Vos prix sont beaucoup trop chers, c'est du vol.", expect: { objection: "too_expensive" } },
      { customer: "Faites-moi 10 % de remise ou j'arrête de travailler avec vous.", expect: { mustInclude: ["commercial"], mustNotInclude: ["10\\s?%"] } },
    ] },
  { key: "client-presse", title: "Client pressé : synthèse courte puis montant", persona: "Acheteur très occupé",
    turns: () => [
      { customer: "Je n'ai pas le temps, faites court.", expect: { objection: "no_time" } },
      { customer: "Quel est le montant total ?", expect: { intent: "question", mustInclude: ["€"] } },
    ] },
  { key: "client-surstocke", title: "Client surstocké : stock déclaré, recalcul, nouveau montant", persona: "Magasin surstocké", exam: 1,
    turns: (_, o) => [
      { customer: `J'ai trop de stock, il m'en reste 40 de ${o.lines[1]!.description}.`, expect: { objection: "stock_available", mustInclude: ["Stock déclaré", "couverture"] } },
      { customer: "Quel est le nouveau montant total ?", expect: { intent: "question", mustInclude: ["€"] } },
    ] },
  { key: "client-sans-budget", title: "Client sans budget : priorisation puis budget chiffré", persona: "Trésorerie tendue",
    turns: () => [
      { customer: "Je n'ai pas de budget ce mois-ci.", expect: { objection: "budget" } },
      { customer: "Mon budget maximum, c'est 400 € pour ce mois-ci.", expect: { objection: "budget" } },
    ] },
  { key: "acheteur-prix", title: "Acheteur sensible au prix : défense du prix et concurrence", persona: "Acheteur centré sur le prix", exam: 2,
    turns: () => [
      { customer: "C'est trop cher pour moi.", expect: { objection: "too_expensive", mustNotInclude: ["\\d\\s?%"] } },
      { customer: "Un concurrent me fait moins cher sur les mêmes produits.", expect: { objection: "competition", mustInclude: ["compar"] } },
    ] },
  { key: "client-dormant", title: "Réactivation d'un client dormant", persona: "Ancien client inactif depuis 8 mois", exam: 3,
    turns: (_, o) => [
      { customer: `Bonjour, ça fait longtemps. Quel est le prix de ${o.lines[0]!.reference} aujourd'hui ?`, expect: { intent: "question", mustInclude: ["€"] } },
      { customer: "Je vais réfléchir.", expect: { objection: "think_later", mustInclude: ["synthèse|vérifier"] } },
    ] },
  { key: "grand-compte", title: "Grand compte : offre de 200 références", persona: "Centrale d'achat, 200 références", lineCount: 200, docs: true,
    turns: () => [
      { customer: "Quel est le montant total de la proposition ?", expect: { intent: "question", mustInclude: ["€"] } },
      { customer: "Je vais réfléchir, c'est beaucoup de références.", expect: { objection: "think_later" } },
    ] },
  { key: "client-mecontent", title: "Réclamation : livraison en retard", persona: "Client mécontent", exam: 7,
    turns: () => [
      { customer: "Ma livraison est en retard, c'est inadmissible !", expect: { intent: "complaint", expectNoSale: true, mustInclude: ["logistique|statut"] } },
      { customer: "Quand est-ce que je serai livré exactement ?", expect: { expectNoSale: true, mustNotInclude: ["demain", "sous \\d+ jours"] } },
    ] },
  { key: "client-hesitant", title: "Client hésitant : réflexion puis prix", persona: "Acheteur indécis",
    turns: () => [
      { customer: "Je ne sais pas trop, je vais réfléchir.", expect: { objection: "think_later" } },
      { customer: "C'est surtout le prix qui me gêne, c'est trop cher.", expect: { objection: "too_expensive" } },
    ] },
  { key: "negociation-difficile", title: "Négociation : remise au-delà puis dans le plafond", persona: "Acheteur négociateur", exam: 10,
    turns: () => [
      { customer: "Je veux 5 % de remise, sinon je ne commande pas.", expect: { mustInclude: ["commercial"], mustNotInclude: ["5\\s?%"] } },
      { customer: "Bon, et 1 % de remise alors ?", expect: { mustInclude: ["1\\s?%"] } },
    ] },
  { key: "reassort-volumineux", title: "Réassort volumineux : références qui dorment", persona: "Grand magasin, réassort de 200 lignes", lineCount: 200,
    turns: () => [
      { customer: "Ça ne se vend pas tout ça, il y a des références qui dorment.", expect: { objection: "not_selling" } },
      { customer: "Quel est le nouveau montant total ?", expect: { intent: "question", mustInclude: ["€"] } },
    ] },
  { key: "presentation-nouveautes", title: "Nouveautés face à un fournisseur en place", persona: "Client fidèle à un concurrent",
    turns: (_, o) => [
      { customer: "Je travaille déjà avec un fournisseur pour ces produits.", expect: { objection: "existing_supplier" } },
      { customer: `Donnez-moi quand même le prix de ${o.lines[3]!.reference}.`, expect: { intent: "question", mustInclude: ["€"] } },
    ] },
  { key: "baisse-ca", title: "Baisse de CA : obtenir un rendez-vous avec un acheteur difficile", persona: "Acheteur distant, CA en baisse", exam: 6,
    turns: () => [
      { customer: "Je n'ai besoin de rien, et vos relances m'agacent.", expect: { objection: "no_need" } },
      { customer: "Bon, d'accord pour un rendez-vous rapide.", expect: { intent: "meeting_request", mustInclude: ["rendez-vous|créneau|visio"] } },
    ] },
  { key: "suivi-commandes", title: "Suivi d'offre puis opposition", persona: "Client qui ne veut plus être sollicité",
    turns: () => [
      { customer: "Pouvez-vous me confirmer la validité et le montant de l'offre ?", expect: { intent: "question", mustInclude: ["€", "valable"] } },
      { customer: "Merci. Par contre je ne veux plus être contacté.", expect: { intent: "unsubscribe", expectNoSale: true } },
    ] },
];

mkdirSync(new URL("../../training/scenarios/", import.meta.url), { recursive: true });
let n = 0;
for (const [ci, c] of CATS.entries()) {
  const list = PERSONAS.map((p, pi) => {
    const k = ci * 7 + pi;
    const o = offerFor(k, c.lineCount);
    n++;
    return {
      id: `${c.key}-${pi + 1}`, category: c.key, title: c.title, persona: `${c.persona} — ${p.salutation} ${p.lastName} (${p.customer}), ${p.channel}`,
      ...(c.exam && pi === 0 ? { exam: c.exam } : {}),
      facts: {
        companyName: "JONAS", senderName: "Bruno Lefort", channel: p.channel, today: TODAY,
        contact: { salutation: p.salutation, firstName: p.firstName, lastName: p.lastName }, customerName: p.customer,
        customer: { francoAmount: "300.00", minOrderAmount: null, paymentTerms: "30 jours fin de mois" },
        policy: { maxAutoDiscountPct: "1.00", requireDiscountApproval: false },
        offer: o, salesFacts: [], alternatives: [{ productId: `n${k}`, name: "Nouveauté Lin naturel", unitPriceHt: "6.50", minQty: "6", reason: "Nouveauté adaptée à votre assortiment (quantité de découverte)." }],
        documentsAttached: !!c.docs, otherCustomerNames: ["Carrefour Market Lyon", "Leclerc Rennes"],
      },
      turns: c.turns(k, o),
    };
  });
  writeFileSync(new URL(`../../training/scenarios/${c.key}.json`, import.meta.url), JSON.stringify(list, null, 2) + "\n");
}
console.log(`${n} scénarios écrits dans training/scenarios/ (${CATS.length} catégories).`);
