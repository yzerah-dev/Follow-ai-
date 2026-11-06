/**
 * Garde-fous déterministes appliqués à TOUTE sortie IA avant qu'elle ne devienne un brouillon.
 * Le modèle propose, le backend dispose.
 */
export type GuardResult = { ok: true } | { ok: false; reasons: string[] };

export function checkMessage(body: string, opts: { allowedDiscountPct: number | null; personalizedAllowed: boolean; forbiddenTerms?: string[] }): GuardResult {
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
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
