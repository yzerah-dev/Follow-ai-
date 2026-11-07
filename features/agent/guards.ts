/**
 * Garde-fous déterministes appliqués à TOUTE sortie IA avant qu'elle ne devienne un brouillon.
 * Le modèle propose, le backend dispose.
 */
export type GuardResult = { ok: true } | { ok: false; reasons: string[] };

/** Montants en euros cités dans un texte (« 2 480,00 € », « 9,90 € HT »). */
export function amountsInText(text: string): number[] {
  return [...text.matchAll(/(\d{1,3}(?:[\s  ]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?€/g)].map((m) => Number(m[1]!.replace(/[\s  ]/g, "").replace(",", ".")));
}

export function checkMessage(body: string, opts: { allowedDiscountPct: number | null; personalizedAllowed: boolean; forbiddenTerms?: string[]; deliveryConfirmed?: boolean; knownAmounts?: (string | number | null | undefined)[] }): GuardResult {
  const reasons: string[] = [];
  // 1. Aucune remise au-delà de ce que la politique autorise
  for (const m of body.matchAll(/(\d{1,2}(?:[.,]\d{1,2})?)\s?%/g)) {
    const pct = Number(m[1]!.replace(",", "."));
    if (opts.allowedDiscountPct === null || pct > opts.allowedDiscountPct + 1e-9) reasons.push(`Remise de ${pct} % non autorisée dans le message.`);
  }
  // 2. Pas de personnalisation affirmée sans historique
  if (!opts.personalizedAllowed && /(vos derniers achats|vos achats habituels|vous travaillez régulièrement|personnalisée)/i.test(body))
    reasons.push("Personnalisation affirmée sans historique d'achat suffisant.");
  // 3. Vouvoiement
  if (/\b(tu|toi|ton|ta|tes)\b/i.test(body.replace(/\b(tu)\s?-/gi, ""))) reasons.push("Tutoiement détecté : le vouvoiement est requis.");
  // 4. Données internes interdites (prix d'achat, marges)
  for (const t of opts.forbiddenTerms ?? []) if (t && body.includes(t)) reasons.push("Donnée interne détectée dans le message.");
  if (/(prix d'achat|marge brute|notre marge)/i.test(body)) reasons.push("Mention de prix d'achat ou de marge.");
  // 5. Aucune promesse de livraison ou de délai non confirmée (Academy, module 6 — objection 9)
  if (!opts.deliveryConfirmed && /(livr(?:é|ée|és|ées|aison|ons|era)[^.?!]{0,40}(demain|sous \d+|d.ici (lundi|mardi|mercredi|jeudi|vendredi|\d)|\ble \d{1,2}(er)? |avant le|en \d+ jours|cette semaine)|d[ée]lai de \d+|arrivera (demain|le|sous))/i.test(body))
    reasons.push("Délai ou date de livraison annoncé sans confirmation.");
  // 6. Aucun montant qui ne figure pas dans les données vérifiées (si la liste des montants connus est fournie)
  if (opts.knownAmounts) {
    const known = opts.knownAmounts.filter((x) => x !== null && x !== undefined && x !== "").map((x) => Number(String(x).replace(",", ".")));
    for (const a of amountsInText(body)) if (!known.some((k) => Math.abs(k - a) < 0.006)) { reasons.push(`Montant ${a} € absent des données vérifiées.`); break; }
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
