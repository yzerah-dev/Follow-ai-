import type { Db } from "./client";

/** Insertion multi-lignes paramétrée, par paquets (limite de 65535 paramètres). */
export async function insertMany(db: Db, table: string, columns: string[], rows: unknown[][], suffix = ""): Promise<void> {
  if (!/^[a-z_.]+$/.test(table) || columns.some((c) => !/^[a-z0-9_]+$/.test(c))) throw new Error("identifiant invalide");
  if (!rows.length) return;
  const per = Math.max(1, Math.floor(60000 / columns.length));
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const values: unknown[] = [];
    const tuples = chunk.map((r) => {
      const ph = r.map((v) => {
        values.push(v);
        return `$${values.length}`;
      });
      return `(${ph.join(",")})`;
    });
    await db.query(`insert into ${table} (${columns.join(",")}) values ${tuples.join(",")} ${suffix}`, values);
  }
}
