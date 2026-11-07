import { withPrivileged } from "@/lib/database/client";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";

/**
 * Secrets de connexion (jetons d'accès fournisseurs) : table sans accès applicatif,
 * lue/écrite uniquement ici via la connexion privilégiée, chiffrée en AES-256-GCM.
 * L'appelant doit avoir vérifié au préalable (sous RLS) que la connexion appartient à son organisation.
 */
export async function readConnectionSecret(organizationId: string, connectionId: string): Promise<Record<string, string> | null> {
  const row = await withPrivileged(async (db) =>
    (await db.query<{ ciphertext: string }>(`select ciphertext from connection_secrets where connection_id = $1 and organization_id = $2`, [connectionId, organizationId])).rows[0],
  );
  if (!row) return null;
  return JSON.parse(decryptSecret(row.ciphertext)) as Record<string, string>;
}

export async function writeConnectionSecret(organizationId: string, connectionId: string, secret: Record<string, string>) {
  await withPrivileged((db) =>
    db.query(
      `insert into connection_secrets (connection_id, organization_id, ciphertext) values ($1,$2,$3)
       on conflict (connection_id) do update set ciphertext = excluded.ciphertext, updated_at = now()`,
      [connectionId, organizationId, encryptSecret(JSON.stringify(secret))],
    ),
  );
}
