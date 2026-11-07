/**
 * Playbook commercial de LÉA — traitement des objections par la donnée (100 % déterministe).
 *
 * 1. Comprendre l'objection (analyse) sans la prendre pour un refus.
 * 2. Analyser la couverture de stock des références de l'offre (features/analytics/coverage.ts).
 * 3. Garder les références à fort potentiel, retirer celles qui ralentissent.
 * 4. Construire des contre-arguments chiffrés, vérifiables, avec leur niveau de certitude.
 * 5. Proposer une offre révisée (jamais plus chère que l'offre initiale, jamais au-delà du cycle de réassort du client).
 * 6. Chercher une décision concrète ; respecter un refus explicite ; s'arrêter après 2 révisions.
 *
 * Interdits : inventer un chiffre, créer une fausse urgence, présenter une estimation comme un stock vérifié,
 * pousser un client au-delà de son besoin estimé ou de son budget, promettre une rentabilité.
 */
import { dec, D, type Dec } from "@/lib/money";
import { addDays, toIsoDate } from "@/lib/utils";
import { fmtRate, type CoverageRow } from "@/features/analytics/coverage";
import type { Objection } from "./schemas";

export const PLAYBOOK_OBJECTIONS: Objection[] = ["too_expensive", "budget", "stock_available", "no_need", "not_selling"];
export const MAX_REVISIONS = 2;

export type PlaybookLine = { productId: string; name: string; quantity: string; unitPriceHt: string };
export type Alternative = { productId: string; name: string; unitPriceHt: string; minQty: string; reason: string };

export type PlaybookInput = {
  objection: Objection;
  lines: PlaybookLine[];
  coverage: Map<string, CoverageRow>;
  budgetHt: string | null;
  priorRevisions: number;
  alternatives: Alternative[];
  today: string;
};

export type PlaybookResult = {
  strategy: "revise" | "hold" | "respect";
  items: { productId: string; qty: string; reason: string }[];
  removed: { name: string; reason: string }[];
  counterArguments: string[];
  estimatedTotalHt: string | null;
  originalTotalHt: string;
  question: string;
  followUpDate: string | null; // « hold » sur trop de stock : date de reprise de contact proposée
  rationale: string;
};

const certainty = (r: CoverageRow) =>
  r.stockSource === "declared" ? (r.rateSource === "sell_out" ? "stock déclaré, ventes déclarées" : "stock déclaré, ventes estimées d'après vos achats") : "estimation d'après vos achats";

/** Argument chiffré et vérifiable sur une référence (toujours avec son niveau de certitude). */
export function coverageArgument(r: CoverageRow): string | null {
  if (r.dailyRate === null) return null;
  const rate = `${fmtRate(r.dailyRate)} unité(s)/jour`;
  if (r.coverageDays === null) return `« ${r.name} » : environ ${rate} (${certainty(r)}).`;
  return `« ${r.name} » : environ ${rate}, ${r.stockSource === "declared" ? "stock" : "stock estimé"} ~${r.stockOnHand} pièces, soit ~${r.coverageDays} jour(s) de couverture (${certainty(r)}).`;
}

const priority: Record<CoverageRow["risk"], number> = { high: 0, medium: 1, unknown: 2, low: 3 };

export function runPlaybook(i: PlaybookInput): PlaybookResult {
  const original = i.lines.reduce((a, l) => a.plus(dec(l.quantity).times(l.unitPriceHt)), new D(0));
  const base = { items: [], removed: [], counterArguments: [], estimatedTotalHt: null, originalTotalHt: original.toFixed(2), followUpDate: null };
  if (!PLAYBOOK_OBJECTIONS.includes(i.objection)) return { ...base, strategy: "hold", question: "", rationale: "Objection hors playbook." };
  if (i.priorRevisions >= MAX_REVISIONS)
    return { ...base, strategy: "respect", question: "", rationale: `Déjà ${i.priorRevisions} propositions révisées : LÉA n'insiste pas, le commercial reprend la main.` };

  const rows = i.lines.map((l) => ({ l, c: i.coverage.get(l.productId) ?? null }));
  const removed: PlaybookResult["removed"] = [];
  let kept: { l: PlaybookLine; c: CoverageRow | null; qty: Dec; reason: string }[] = [];

  const keepWithCoverage = (filter: (c: CoverageRow | null) => boolean) => {
    for (const { l, c } of rows) {
      if (c?.slowMover) { removed.push({ name: l.name, reason: c.reason }); continue; }
      if (!filter(c)) { removed.push({ name: l.name, reason: c?.reason ?? "Pas de donnée suffisante pour justifier cette référence maintenant." }); continue; }
      // Jamais plus que l'offre initiale, jamais au-delà du cycle de réassort estimé.
      const rec = c?.recommendedQty !== null && c?.recommendedQty !== undefined ? dec(c.recommendedQty) : null;
      if (rec !== null && rec.isZero()) { removed.push({ name: l.name, reason: c!.reason }); continue; }
      const qty = rec !== null ? D.min(rec, dec(l.quantity)) : dec(l.quantity);
      kept.push({ l, c, qty, reason: c?.reason ?? "Quantité habituelle." });
    }
  };

  switch (i.objection) {
    case "too_expensive":
    case "budget":
      keepWithCoverage(() => true);
      break;
    case "stock_available":
      keepWithCoverage((c) => c !== null && (c.risk === "high" || c.risk === "medium"));
      break;
    case "no_need":
      keepWithCoverage((c) => c !== null && c.risk === "high");
      break;
    case "not_selling": {
      // Retirer ce qui ralentit (à défaut : la référence la moins vendue), remplacer par des références qui tournent.
      keepWithCoverage(() => true);
      if (!removed.length && kept.length > 1) {
        const slowest = [...kept].sort((a, b) => dec(a.c?.dailyRate ?? 0).comparedTo(dec(b.c?.dailyRate ?? 0)))[0]!;
        kept = kept.filter((k) => k !== slowest);
        removed.push({ name: slowest.l.name, reason: "Référence la moins vendue de la sélection d'après vos achats." });
      }
      for (const a of i.alternatives.slice(0, 2))
        kept.push({ l: { productId: a.productId, name: a.name, quantity: a.minQty, unitPriceHt: a.unitPriceHt }, c: null, qty: dec(a.minQty), reason: a.reason });
      break;
    }
  }

  kept.sort((a, b) => priority[a.c?.risk ?? "unknown"] - priority[b.c?.risk ?? "unknown"]);
  // Budget annoncé par le client : on s'y tient (références prioritaires d'abord).
  if (i.budgetHt && (i.objection === "budget" || i.objection === "too_expensive")) {
    const budget = dec(i.budgetHt);
    let acc = new D(0);
    kept = kept.filter((k) => {
      const v = k.qty.times(k.l.unitPriceHt);
      if (acc.plus(v).lte(budget)) { acc = acc.plus(v); return true; }
      removed.push({ name: k.l.name, reason: "Retirée pour respecter le budget annoncé." });
      return false;
    });
  }

  const total = kept.reduce((a, k) => a.plus(k.qty.times(k.l.unitPriceHt)), new D(0));
  // Les références dont le client a déclaré le stock passent en premier : c'est sa donnée, on lui montre qu'on l'a prise en compte.
  const ordered = [...kept].sort((a, b) => Number(b.c?.stockSource === "declared") - Number(a.c?.stockSource === "declared"));
  const args = ordered.map((k) => (k.c ? coverageArgument(k.c) : `« ${k.l.name} » : ${k.reason}`)).filter((x): x is string => !!x).slice(0, 3);
  const items = kept.map((k) => ({ productId: k.l.productId, qty: k.qty.toFixed(3), reason: k.reason }));
  const changed = items.length > 0 && (removed.length > 0 || kept.some((k) => !k.qty.eq(dec(k.l.quantity))) || i.objection === "not_selling");
  const priceGuard = i.objection === "not_selling" || total.lt(original);

  if (!items.length || !changed || !priceGuard) {
    if (i.objection === "stock_available") {
      const covered = rows.map((r) => r.c?.coverageDays).filter((d): d is number => d !== null && d !== undefined);
      const days = covered.length ? Math.max(7, Math.min(45, Math.min(...covered) - 7)) : 21; // on garde le contact : 45 jours maximum
      const date = toIsoDate(addDays(i.today, days));
      return { ...base, removed, counterArguments: rows.map((r) => (r.c ? coverageArgument(r.c) : null)).filter((x): x is string => !!x).slice(0, 3), strategy: "hold", followUpDate: date,
        question: "Je vous propose de refaire le point à cette date pour ne pas risquer la rupture : cela vous convient-il ?", rationale: "Stock suffisant d'après l'analyse : reprise de contact programmée, aucune nouvelle offre." };
    }
    if (i.objection === "no_need") return { ...base, removed, strategy: "respect", question: "", rationale: "Aucune référence en risque de rupture : LÉA respecte la décision du client." };
    return { ...base, removed, counterArguments: args, strategy: "hold", question: "Souhaitez-vous que nous ajustions ensemble les quantités ?", rationale: "La sélection est déjà ajustée au besoin estimé : LÉA défend l'offre sans la réduire." };
  }
  return {
    ...base,
    strategy: "revise",
    items,
    removed,
    counterArguments: args,
    estimatedTotalHt: total.toFixed(2),
    question: i.objection === "no_need" ? "Je vous envoie uniquement ce qui risque de manquer : on valide ?" : "Cette version vous convient-elle ? Un « OK » suffit pour que je lance la commande.",
    rationale: `Offre révisée : ${items.length} référence(s) gardée(s), ${removed.length} retirée(s), ${total.toFixed(2)} € HT au lieu de ${original.toFixed(2)} € HT.`,
  };
}
