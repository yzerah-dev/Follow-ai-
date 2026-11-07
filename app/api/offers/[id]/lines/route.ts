import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/auth/context";
import { withUser } from "@/lib/database/client";
import { loadEditorLines } from "@/features/offers/editor";

/** Lignes d'une offre pour l'éditeur (RLS : une offre d'une autre organisation renvoie une liste vide). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new NextResponse("Non authentifié", { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse("Introuvable", { status: 404 });
  const lines = await withUser(ctx.userId, async (db) => {
    const ok = (await db.query(`select 1 from offers where id = $1 and organization_id = $2`, [id, ctx.org.organizationId])).rowCount;
    return ok ? loadEditorLines(db, id) : null;
  });
  if (!lines) return new NextResponse("Introuvable", { status: 404 });
  return NextResponse.json(lines, { headers: { "Cache-Control": "private, no-store" } });
}
