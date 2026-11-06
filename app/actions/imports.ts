"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { canManage } from "@/lib/auth/roles";
import { withUser } from "@/lib/database/client";
import { rateLimit } from "@/lib/security/rate-limit";
import { createImport, processImport } from "@/features/imports/service";
import { MAX_IMPORT_BYTES } from "@/features/imports/parse";
import { runOpportunityScan } from "@/features/opportunities/service";
import { toIsoDate } from "@/lib/utils";

export type ImportState = { error?: string };

const ENTITY = z.enum(["customers", "contacts", "products", "prices", "inventory", "invoices"]);

export async function uploadImportAction(_: ImportState, form: FormData): Promise<ImportState> {
  const ctx = await requireContext();
  if (!canManage(ctx.org.role)) return { error: "Seuls les managers et administrateurs peuvent importer des données." };
  if (!rateLimit(`import:${ctx.userId}`, 10, 60_000).ok) return { error: "Trop d'imports en peu de temps." };
  const entity = ENTITY.safeParse(form.get("entity"));
  const file = form.get("file");
  if (!entity.success) return { error: "Type de données invalide." };
  if (!(file instanceof File) || file.size === 0) return { error: "Sélectionnez un fichier CSV ou XLSX." };
  if (file.size > MAX_IMPORT_BYTES) return { error: "Fichier trop volumineux (15 Mo maximum)." };
  let importId = "";
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    importId = (await withUser(ctx.userId, (db) => createImport(db, ctx.org.organizationId, ctx.userId, entity.data, file.name, buf))).importId;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Lecture du fichier impossible." };
  }
  redirect(`/parametres/imports/${importId}`);
}

export async function processImportAction(importId: string, mapping: Record<string, string | null>): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireContext();
  if (!canManage(ctx.org.role)) return { ok: false, error: "Action non autorisée." };
  const id = z.uuid().parse(importId);
  const m = z.record(z.string().max(200), z.string().max(64).nullable()).parse(mapping);
  const orgId = ctx.org.organizationId;
  // Traitement asynchrone : la requête répond immédiatement, l'import s'exécute ensuite (sous RLS).
  after(async () => {
    try {
      await withUser(ctx.userId, (db) => processImport(db, orgId, ctx.userId, id, m));
      await withUser(ctx.userId, (db) => runOpportunityScan(db, orgId, toIsoDate(new Date()), ctx.userId));
    } catch (e) {
      await withUser(ctx.userId, (db) => db.query(`update imports set status = 'failed', error = $2, finished_at = now() where id = $1`, [id, e instanceof Error ? e.message.slice(0, 500) : "Erreur"]));
    }
  });
  revalidatePath(`/parametres/imports/${id}`);
  return { ok: true };
}
