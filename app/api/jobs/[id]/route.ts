import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/auth/context";
import { withUser } from "@/lib/database/client";
import { jobStatus } from "@/features/creative-studio/jobs";

/** Avancement d'une génération (RLS : une tâche d'une autre organisation est introuvable). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new NextResponse("Non authentifié", { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse("Introuvable", { status: 404 });
  const s = await withUser(ctx.userId, (db) => jobStatus(db, ctx.org.organizationId, id));
  if (!s) return new NextResponse("Introuvable", { status: 404 });
  return NextResponse.json(s, { headers: { "Cache-Control": "no-store" } });
}
