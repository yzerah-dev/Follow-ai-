/**
 * Moteur d'opportunités hybride — partie déterministe.
 * Chaque opportunité porte sa justification, sa confiance, ses sources et une valeur ESTIMÉE
 * (null si aucun prix connu). Une estimation n'est jamais une commande.
 * L'analyse IA (lib/ai) enrichit ensuite le texte, sans modifier les chiffres.
 */
import { dec, round2, D } from "@/lib/money";
import { addDays, toIsoDate } from "@/lib/utils";
import { customerSummary, productHabits, type InvoiceLite, type LineLite } from "@/features/invoices/analytics";
import { resolvePrice, type PriceRow } from "@/features/offers/pricing";
import { computeTargetProgress, type TargetInput } from "@/features/customers/targets";
import { MISSION_OF } from "./missions";

export type OpportunityType = "reorder" | "dormant_customer" | "new_product" | "cross_sell" | "back_in_stock" | "campaign" | "unclosed_offer" | "appointment" | "target_gap";

export type EngineProduct = {
  id: string;
  reference: string;
  name: string;
  category: string | null;
  salePriceHt: string | null;
  isNew: boolean;
  launchedAt: string | null;
  availability: string;
  status: string;
};

export type EngineCustomer = { id: string; name: string; status: string };

export type EngineSettings = { dormantAfterDays: number; reorderLookaheadDays: number };

export type OpportunityCandidate = {
  customerId: string;
  type: OpportunityType;
  productIds: string[];
  title: string;
  justification: string;
  confidence: number;
  estimatedValueHt: string | null;
  priority: number;
  recommendedAction: string;
  suggestedDate: string;
  dataSources: string[];
  details: Record<string, unknown>;
  dedupeKey: string;
  expiresAt: string;
};

export type EngineInput = {
  today: string;
  customer: EngineCustomer;
  invoices: InvoiceLite[];
  lines: LineLite[];
  products: EngineProduct[];
  prices: PriceRow[];
  settings: EngineSettings;
  coPurchase?: Map<string, { productId: string; lift: number; confidence: number; support: number }[]>;
  activeCampaigns?: { id: string; name: string; productIds: string[]; endsOn: string | null }[];
  openOffers?: { id: string; number: string; status: string; sentAt: string | null; totalHt: string }[];
  /** Mission 3 : produits redevenus disponibles récemment (dernier relevé > 0 après un relevé à 0). */
  restocks?: { productId: string; restockedAt: string }[];
  /** Mission 5 : date du dernier rendez-vous réalisé (null = aucun enregistré). */
  lastMeetingAt?: string | null;
  meetingIntervalDays?: number;
  /** Mission 6 : objectif de CA de la période en cours. */
  target?: TargetInput | null;
  targetAlertPct?: number;
  /** Refus, pause ou opposition : aucune sollicitation proactive. */
  blockedReason?: string | null;
};

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const fmtEur = (v: string) => `${dec(v).toDecimalPlaces(0).toNumber().toLocaleString("fr-FR").replace(/ /g, " ")} €`;

/**
 * Priorisation : potentiel (valeur estimée, échelle log), urgence (date conseillée) et probabilité de conversion (confiance).
 * Sans valeur chiffrée connue, le potentiel est neutre (0,2) : on ne l'invente pas.
 */
export function scoreOpportunity(value: string | null, confidence: number, urgencyDays: number) {
  const potential = value ? clamp(Math.log10(1 + dec(value).toNumber()) / 5) : 0.2; // ~1 pour 100 k€
  const urgency = clamp(1 - Math.max(0, urgencyDays) / 60);
  const probability = clamp(confidence);
  return {
    priority: Math.round(clamp(0.4 * potential + 0.3 * urgency + 0.3 * probability) * 100),
    potential: Number(potential.toFixed(3)),
    urgency: Number(urgency.toFixed(3)),
    probability: Number(probability.toFixed(3)),
  };
}

export function priorityScore(value: string | null, confidence: number, urgencyDays: number): number {
  return scoreOpportunity(value, confidence, urgencyDays).priority;
}

export function detectOpportunities(input: EngineInput): OpportunityCandidate[] {
  const { today, customer, products, prices, settings } = input;
  const out: OpportunityCandidate[] = [];
  if (customer.status === "blocked" || customer.status === "lost" || input.blockedReason) return out;
  const productById = new Map(products.map((p) => [p.id, p]));
  const summary = customerSummary(input.invoices, today);
  const habits = productHabits(input.invoices, input.lines, today);
  const sources = (n: number) => [`${n} facture(s) analysée(s)`, "lignes de factures", "tarifs"];
  const priceOf = (productId: string, qty: string) => {
    const p = productById.get(productId);
    if (!p) return null;
    return resolvePrice({ id: p.id, salePriceHt: p.salePriceHt }, customer.id, prices, today, Number(qty));
  };
  const expires = (days: number) => addDays(today, days).toISOString();

  // 1. Réassort probable — produits achetés régulièrement dont la prochaine échéance approche
  const isDormant = summary.daysSinceLast !== null && summary.daysSinceLast > settings.dormantAfterDays;
  if (!isDormant) {
    const due = habits.filter(
      (h) =>
        h.orders >= 3 &&
        h.meanIntervalDays !== null &&
        h.daysUntilNext !== null &&
        h.daysUntilNext <= settings.reorderLookaheadDays &&
        h.daysUntilNext >= -Math.max(30, h.meanIntervalDays) &&
        productById.get(h.productId)?.status === "active",
    );
    if (due.length) {
      let value = new D(0);
      let priced = 0;
      for (const h of due) {
        const pr = priceOf(h.productId, h.avgQtyPerOrder);
        if (pr) {
          value = value.plus(dec(pr.unitPriceHt).times(dec(h.avgQtyPerOrder)));
          priced++;
        }
      }
      const regularity = due.reduce((a, h) => a + (h.intervalCv === null ? 0.5 : clamp(1 - h.intervalCv)), 0) / due.length;
      const depth = clamp(due.reduce((a, h) => a + h.orders, 0) / due.length / 8);
      const confidence = Number(clamp(0.35 + 0.4 * regularity + 0.25 * depth, 0, 0.95).toFixed(3));
      const minDays = Math.min(...due.map((h) => h.daysUntilNext ?? 0));
      const estimated = priced ? round2(value).toFixed(2) : null;
      const ids = due.map((h) => h.productId).sort();
      out.push({
        customerId: customer.id,
        type: "reorder",
        productIds: ids,
        title: `Réassort probable de ${due.length} référence${due.length > 1 ? "s" : ""}`,
        justification:
          `${customer.name} commande ces références en moyenne tous les ${Math.round(due.reduce((a, h) => a + (h.meanIntervalDays ?? 0), 0) / due.length)} jours ` +
          `(${due.map((h) => productById.get(h.productId)?.reference).join(", ")}). ` +
          (minDays < 0 ? `La prochaine commande attendue a ${-minDays} jour(s) de retard.` : `Prochaine commande attendue d'ici ${minDays} jour(s).`) +
          (estimated ? ` Potentiel estimé sur la base des quantités habituelles : ${fmtEur(estimated)} HT.` : " Aucun prix connu : potentiel non estimé."),
        confidence,
        estimatedValueHt: estimated,
        priority: priorityScore(estimated, confidence, Math.max(0, minDays)),
        recommendedAction: "Préparer une offre de réassort et l'envoyer après validation.",
        suggestedDate: toIsoDate(addDays(today, Math.max(0, Math.min(minDays - 3, 7)))),
        dataSources: sources(summary.invoiceCount),
        details: {
          items: due.map((h) => ({
            productId: h.productId,
            avgQty: h.avgQtyPerOrder,
            meanIntervalDays: h.meanIntervalDays,
            lastDate: h.lastDate,
            nextExpected: h.nextExpected,
            orders: h.orders,
          })),
        },
        dedupeKey: `reorder:${customer.id}:${ids.join(",")}`,
        expiresAt: expires(settings.reorderLookaheadDays + 14),
      });
    }
  }

  // 2. Client dormant — ancien acheteur régulier sans commande depuis longtemps
  if (summary.invoiceCount >= 2 && summary.daysSinceLast !== null) {
    const threshold = Math.max(settings.dormantAfterDays, (summary.meanIntervalDays ?? 0) * 2.5);
    if (summary.daysSinceLast > threshold) {
      const estimated = summary.avgBasket;
      const confidence = Number(clamp(0.3 + 0.05 * Math.min(summary.invoiceCount, 8), 0, 0.75).toFixed(3));
      const top = habits.slice(0, 5).map((h) => h.productId);
      out.push({
        customerId: customer.id,
        type: "dormant_customer",
        productIds: top,
        title: `Client inactif depuis ${summary.daysSinceLast} jours`,
        justification:
          `Dernière facture le ${summary.lastPurchase}, alors que le client commandait en moyenne tous les ${summary.meanIntervalDays ?? "?"} jours ` +
          `(${summary.invoiceCount} factures). Panier moyen historique : ${estimated ? fmtEur(estimated) : "inconnu"} HT.`,
        confidence,
        estimatedValueHt: estimated,
        priority: priorityScore(estimated, confidence, 10),
        recommendedAction: "Relancer avec une sélection de ses références habituelles et proposer un rendez-vous.",
        suggestedDate: today,
        dataSources: sources(summary.invoiceCount),
        details: { daysSinceLast: summary.daysSinceLast, meanIntervalDays: summary.meanIntervalDays, lastPurchase: summary.lastPurchase },
        dedupeKey: `dormant:${customer.id}`,
        expiresAt: expires(45),
      });
    }
  }

  // 3. Nouveautés pertinentes — dans les catégories que le client travaille
  const boughtIds = new Set(habits.map((h) => h.productId));
  const catRevenue = new Map<string, InstanceType<typeof D>>();
  let totalRev = new D(0);
  for (const h of habits) {
    const c = productById.get(h.productId)?.category;
    if (!c) continue;
    catRevenue.set(c, (catRevenue.get(c) ?? new D(0)).plus(dec(h.revenue)));
    totalRev = totalRev.plus(dec(h.revenue));
  }
  const strongCats = new Set(
    [...catRevenue.entries()].filter(([, v]) => totalRev.gt(0) && v.dividedBy(totalRev).gte(0.25)).map(([c]) => c),
  );
  const cutoffNew = toIsoDate(addDays(today, -120));
  const news = products.filter(
    (p) => p.status === "active" && p.isNew && p.category && strongCats.has(p.category) && !boughtIds.has(p.id) && (!p.launchedAt || p.launchedAt >= cutoffNew) && p.availability !== "out_of_stock",
  );
  if (news.length && !isDormant) {
    const pick = news.slice(0, 4);
    const ids = pick.map((p) => p.id).sort();
    out.push({
      customerId: customer.id,
      type: "new_product",
      productIds: ids,
      title: `${pick.length} nouveauté${pick.length > 1 ? "s" : ""} dans ses catégories`,
      justification: `Le client réalise une part significative de ses achats en ${[...strongCats].join(", ")}. Nouveautés non encore achetées : ${pick.map((p) => p.reference).join(", ")}.`,
      confidence: 0.45,
      estimatedValueHt: null,
      priority: priorityScore(null, 0.45, 20),
      recommendedAction: "Présenter les nouveautés dans la prochaine offre ou en rendez-vous.",
      suggestedDate: toIsoDate(addDays(today, 3)),
      dataSources: ["catalogue produits", "historique par catégorie"],
      details: { categories: [...strongCats] },
      dedupeKey: `new:${customer.id}:${ids.join(",")}`,
      expiresAt: expires(30),
    });
  }

  // 4. Vente complémentaire — produits souvent achetés avec ceux du client (lift > 1.5)
  if (input.coPurchase && !isDormant) {
    const scores = new Map<string, number>();
    for (const h of habits.slice(0, 15)) {
      for (const a of input.coPurchase.get(h.productId) ?? []) {
        if (boughtIds.has(a.productId) || a.lift < 2 || a.support < 4 || a.confidence < 0.25 || productById.get(a.productId)?.status !== "active") continue;
        scores.set(a.productId, Math.max(scores.get(a.productId) ?? 0, a.lift * a.confidence));
      }
    }
    const best = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (best.length) {
      const ids = best.map(([id]) => id).sort();
      const confidence = Number(clamp(0.25 + Math.min(0.35, best[0]![1] / 20), 0, 0.6).toFixed(3));
      out.push({
        customerId: customer.id,
        type: "cross_sell",
        productIds: ids,
        title: `Vente complémentaire : ${ids.length} référence${ids.length > 1 ? "s" : ""}`,
        justification: `Ces références sont fréquemment achetées par d'autres clients avec les produits habituels de ${customer.name} : ${ids.map((id) => productById.get(id)?.reference).join(", ")}.`,
        confidence,
        estimatedValueHt: null,
        priority: priorityScore(null, confidence, 25),
        recommendedAction: "Ajouter ces références en suggestion dans la prochaine offre.",
        suggestedDate: toIsoDate(addDays(today, 5)),
        dataSources: ["co-achats sur l'ensemble des factures de l'organisation"],
        details: { scores: Object.fromEntries(best) },
        dedupeKey: `cross:${customer.id}:${ids.join(",")}`,
        expiresAt: expires(30),
      });
    }
  }

  // 4 bis. Retour en stock — produits habituels du client redevenus disponibles
  if (input.restocks?.length && !isDormant) {
    const habitById = new Map(habits.map((h) => [h.productId, h]));
    const back = input.restocks.filter((r) => {
      const h = habitById.get(r.productId);
      const p = productById.get(r.productId);
      return h && h.orders >= 2 && p?.status === "active" && p.availability !== "out_of_stock" && r.restockedAt >= toIsoDate(addDays(today, -30));
    });
    if (back.length) {
      let value = new D(0);
      let priced = 0;
      for (const r of back) {
        const h = habitById.get(r.productId)!;
        const pr = priceOf(r.productId, h.avgQtyPerOrder);
        if (pr) {
          value = value.plus(dec(pr.unitPriceHt).times(dec(h.avgQtyPerOrder)));
          priced++;
        }
      }
      const ids = back.map((r) => r.productId).sort();
      const estimated = priced ? round2(value).toFixed(2) : null;
      out.push({
        customerId: customer.id,
        type: "back_in_stock",
        productIds: ids,
        title: `De retour en stock : ${ids.length} référence${ids.length > 1 ? "s" : ""} habituelle${ids.length > 1 ? "s" : ""}`,
        justification: `${ids.map((id) => productById.get(id)?.reference).join(", ")} ${ids.length > 1 ? "sont" : "est"} de nouveau disponible${ids.length > 1 ? "s" : ""} et fai${ids.length > 1 ? "saient" : "sait"} partie des achats réguliers de ${customer.name}.` +
          (estimated ? ` Potentiel estimé sur les quantités habituelles : ${fmtEur(estimated)} HT.` : " Prix non connu : potentiel à confirmer."),
        confidence: 0.6,
        estimatedValueHt: estimated,
        priority: 0,
        recommendedAction: "Prévenir le client du retour en stock et proposer une offre de réassort.",
        suggestedDate: today,
        dataSources: ["relevés de stock", "historique d'achat"],
        details: { restocks: back },
        dedupeKey: `back:${customer.id}:${ids.join(",")}`,
        expiresAt: expires(21),
      });
    }
  }

  // 5. Campagne — produits d'une campagne active que le client achète déjà
  for (const c of input.activeCampaigns ?? []) {
    const relevant = c.productIds.filter((id) => boughtIds.has(id));
    if (!relevant.length || isDormant) continue;
    out.push({
      customerId: customer.id,
      type: "campaign",
      productIds: relevant.sort(),
      title: `Campagne « ${c.name} » : ${relevant.length} référence(s) achetée(s)`,
      justification: `La campagne active « ${c.name} » concerne des références déjà achetées par le client.`,
      confidence: 0.55,
      estimatedValueHt: null,
      priority: priorityScore(null, 0.55, 15),
      recommendedAction: "Proposer l'offre de campagne au client.",
      suggestedDate: today,
      dataSources: ["campagnes", "historique d'achat"],
      details: { campaignId: c.id },
      dedupeKey: `campaign:${customer.id}:${c.id}`,
      expiresAt: c.endsOn ? new Date(`${c.endsOn}T23:59:59Z`).toISOString() : expires(30),
    });
  }

  // 6. Offre non conclue — envoyée depuis ≥ 7 jours sans résultat
  for (const o of input.openOffers ?? []) {
    if (!["sent", "negotiation"].includes(o.status) || !o.sentAt) continue;
    const age = Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(o.sentAt).getTime()) / 86_400_000);
    if (age < 7) continue;
    out.push({
      customerId: customer.id,
      type: "unclosed_offer",
      productIds: [],
      title: `Offre ${o.number} sans réponse depuis ${age} jours`,
      justification: `L'offre ${o.number} (${fmtEur(o.totalHt)} HT) a été envoyée il y a ${age} jours sans résultat commercial enregistré.`,
      confidence: 0.6,
      estimatedValueHt: dec(o.totalHt).toFixed(2),
      priority: priorityScore(o.totalHt, 0.6, 0),
      recommendedAction: "Relancer le client et proposer un échange.",
      suggestedDate: today,
      dataSources: ["offres", "conversations"],
      details: { offerId: o.id, ageDays: age },
      dedupeKey: `unclosed:${o.id}`,
      expiresAt: expires(14),
    });
  }

  // 7. Rendez-vous — client non rencontré depuis longtemps, ou dont le CA baisse fortement
  const interval = input.meetingIntervalDays ?? 180;
  const daysSinceMeeting = input.lastMeetingAt ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(input.lastMeetingAt)) / 86_400_000) : null;
  const strongDecline = summary.trendPct !== null && summary.trendPct <= -30 && dec(summary.revenue12m).gte(5000);
  const notMet = dec(summary.revenue12m).gte(10000) && (daysSinceMeeting === null || daysSinceMeeting > interval);
  if ((strongDecline || notMet) && !isDormant) {
    const permanents = habits.filter((h) => h.orders >= 3).length;
    const newsCount = news.length;
    // Format conseillé (déterministe) : showroom pour les comptes importants, visio sinon.
    const format = dec(summary.revenue12m).gte(50000) ? "showroom" : "visio";
    const argument = [
      `CA facturé sur 12 mois : ${fmtEur(summary.revenue12m)} HT${summary.trendPct !== null ? ` (tendance 90 jours : ${summary.trendPct > 0 ? "+" : ""}${summary.trendPct.toLocaleString("fr-FR")} %)` : ""}.`,
      daysSinceMeeting === null ? "Aucun rendez-vous enregistré avec ce client." : `Dernier rendez-vous il y a ${daysSinceMeeting} jours.`,
      permanents ? `${permanents} référence(s) permanente(s) à sécuriser.` : null,
      newsCount ? `${newsCount} nouveauté(s) adaptée(s) à présenter.` : null,
    ].filter((x): x is string => !!x);
    out.push({
      customerId: customer.id,
      type: "appointment",
      productIds: news.slice(0, 4).map((p) => p.id).sort(),
      title: strongDecline ? `CA en baisse de ${Math.abs(summary.trendPct!).toLocaleString("fr-FR")} % — rendez-vous conseillé` : `Client non rencontré ${daysSinceMeeting === null ? "à ce jour" : `depuis ${daysSinceMeeting} jours`} — rendez-vous conseillé`,
      justification: argument.join(" "),
      confidence: strongDecline ? 0.5 : 0.45,
      estimatedValueHt: null,
      priority: 0,
      recommendedAction: `Proposer un rendez-vous ${format === "showroom" ? "au showroom" : "en visioconférence"} (ou par téléphone selon la préférence du client).`,
      suggestedDate: toIsoDate(addDays(today, 2)),
      dataSources: ["factures 12 mois", "rendez-vous", "catalogue"],
      details: { trendPct: summary.trendPct, daysSinceMeeting, format, argument, reason: strongDecline ? "decline" : "not_met" },
      dedupeKey: `appointment:${customer.id}`,
      expiresAt: expires(30),
    });
  }

  // 8. Objectif de CA — retard à date → plan d'accélération chiffré à partir des leviers détectés
  if (input.target) {
    const progress = computeTargetProgress(input.invoices, input.target, today, input.targetAlertPct ?? 10);
    if (progress.status === "behind" && progress.gapHt) {
      const gap = dec(progress.gapHt).abs();
      const levers = out
        .filter((o) => o.customerId === customer.id && o.type !== "appointment")
        .map((o) => ({ type: o.type, title: o.title, valueHt: o.estimatedValueHt }));
      const priced = levers.filter((l) => l.valueHt);
      const covered = priced.reduce((a, l) => a.plus(dec(l.valueHt!)), new D(0));
      const plan = [
        ...levers.map((l) => `${l.title}${l.valueHt ? ` (≈ ${fmtEur(l.valueHt)} HT)` : " (potentiel à confirmer)"}`),
        out.some((o) => o.type === "appointment") ? "Rendez-vous commercial pour présenter la gamme et les nouveautés." : null,
      ].filter((x): x is string => !!x);
      out.push({
        customerId: customer.id,
        type: "target_gap",
        productIds: [],
        title: `Objectif CA : retard de ${fmtEur(gap.toFixed(2))} à date`,
        justification:
          `Réalisé ${fmtEur(progress.realizedHt)} HT pour un attendu à date de ${fmtEur(progress.expectedToDateHt!)} HT (${progress.gapPct!.toLocaleString("fr-FR")} %) sur un objectif ${progress.periodType === "year" ? "annuel" : "mensuel"} de ${fmtEur(progress.targetHt)} HT. ` +
          (progress.forecastHt ? `Projection de fin de période au rythme actuel : ${fmtEur(progress.forecastHt)} HT. ` : "") +
          (priced.length ? `Les leviers chiffrés couvrent ${fmtEur(covered.toFixed(2))} HT du retard.` : "Aucun levier chiffré disponible : plan à confirmer avec le commercial."),
        confidence: 0.55,
        // Valeur = part du retard couverte par des leviers chiffrés (jamais un montant inventé).
        estimatedValueHt: priced.length ? round2(D.min(gap, covered)).toFixed(2) : null,
        priority: 0,
        recommendedAction: plan.length ? `Plan d'accélération : ${plan.join(" · ")}` : "Plan d'accélération à construire avec le commercial (aucun levier détecté).",
        suggestedDate: today,
        dataSources: ["objectif client", "factures de la période", progress.method === "seasonality_n1" ? "saisonnalité N-1" : "prorata temporis"],
        details: { progress, plan, levers },
        dedupeKey: `target:${customer.id}:${progress.periodType}:${progress.periodStart}`,
        expiresAt: expires(14),
      });
    }
  }

  // Priorisation homogène (potentiel × urgence × probabilité) et rattachement à la mission
  for (const o of out) {
    const urgencyDays = Math.round((Date.parse(`${o.suggestedDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    const reorderLate = o.type === "reorder" ? Math.min(0, ...((o.details.items as { nextExpected: string | null }[] | undefined) ?? []).map((i) => (i.nextExpected ? Math.round((Date.parse(`${i.nextExpected}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : 0))) : 0;
    const scoring = scoreOpportunity(o.estimatedValueHt, o.confidence, o.type === "reorder" ? Math.max(0, urgencyDays + reorderLate) : urgencyDays);
    o.priority = scoring.priority;
    o.details = { ...o.details, scoring, mission: MISSION_OF[o.type] };
  }

  return out;
}
