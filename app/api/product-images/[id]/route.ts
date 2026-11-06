import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/auth/context";
import { withUser } from "@/lib/database/client";
import { getFile } from "@/lib/storage";

// Les fichiers sont privés : l'accès est vérifié par la RLS avant toute lecture.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new NextResponse("Non authentifié", { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse("Introuvable", { status: 404 });
  const row = await withUser(ctx.userId, async (db) => (await db.query<{ storage_path: string }>(`select storage_path from product_images where id = $1 and organization_id = $2`, [id, ctx.org.organizationId])).rows[0]);
  if (!row) return new NextResponse("Introuvable", { status: 404 });
  try {
    const data = await getFile(row.storage_path);
    return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new NextResponse("Fichier manquant", { status: 404 });
  }
}
