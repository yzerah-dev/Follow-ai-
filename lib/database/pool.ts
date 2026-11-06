import pg from "pg";
import { env } from "@/lib/env";

// numeric -> string (précision décimale préservée, convertie en Decimal côté métier)
// int8 (count, sum d'entiers) -> number quand c'est sûr
pg.types.setTypeParser(20, (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : v;
});
// date -> chaîne ISO "YYYY-MM-DD" (évite les décalages de fuseau)
pg.types.setTypeParser(1082, (v) => v);

const globalForPool = globalThis as unknown as { __followPool?: pg.Pool };

export function pool(): pg.Pool {
  if (!globalForPool.__followPool) {
    globalForPool.__followPool = new pg.Pool({
      connectionString: env().DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return globalForPool.__followPool;
}
