/**
 * Limiteur de débit à fenêtre glissante, en mémoire (par instance).
 * Suffisant en local / instance unique. En production multi-instance, brancher un store partagé
 * (ex. Upstash Redis) derrière la même interface — voir docs/SECURITY.md.
 */
type Bucket = { hits: number[] };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterMs: number } {
  const b = buckets.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= limit) {
    buckets.set(key, b);
    return { ok: false, retryAfterMs: windowMs - (now - b.hits[0]!) };
  }
  b.hits.push(now);
  buckets.set(key, b);
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (!v.hits.length) buckets.delete(k);
  return { ok: true, retryAfterMs: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}
