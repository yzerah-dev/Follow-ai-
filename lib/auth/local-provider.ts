import { withPrivileged } from "@/lib/database/client";

/**
 * Fournisseur d'authentification local : vérifie le mot de passe bcrypt stocké dans auth.users
 * (même format que Supabase Auth / GoTrue) via pgcrypto.crypt().
 * Utilise la connexion privilégiée UNIQUEMENT pour cette vérification.
 */
export async function verifyCredentials(email: string, password: string): Promise<{ id: string; email: string } | null> {
  const normalized = email.trim().toLowerCase();
  return withPrivileged(async (db) => {
    const r = await db.query<{ id: string; email: string }>(
      `select id, email from auth.users
       where lower(email) = $1 and encrypted_password is not null
         and encrypted_password = extensions.crypt($2, encrypted_password)`,
      [normalized, password],
    );
    return r.rows[0] ?? null;
  });
}
