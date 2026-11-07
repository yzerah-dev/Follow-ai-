/**
 * Normalisation des numéros de téléphone en E.164 (sans dépendance externe).
 * Défaut France : 06 12 34 56 78 → +33612345678. Retourne null si le numéro n'est pas exploitable.
 */
export function toE164(raw: string | null | undefined, defaultCountry = "33"): string | null {
  if (!raw) return null;
  let s = raw.replace(/[\s.\-()]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (/^0\d{9}$/.test(s)) s = `+${defaultCountry}${s.slice(1)}`;
  if (/^\d{10,15}$/.test(s)) s = `+${s}`; // identifiant WhatsApp (wa_id) sans « + »
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
  return s;
}

/** Mobile français (06 / 07) : seul type de numéro utilisable pour WhatsApp / SMS dans la démo. */
export const isMobileFr = (e164: string | null) => !!e164 && /^\+33[67]\d{8}$/.test(e164);

export function formatPhone(e164: string | null): string {
  if (!e164) return "—";
  const m = e164.match(/^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return m ? `+33 ${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}` : e164;
}
