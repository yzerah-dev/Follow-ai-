import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/auth/context";
import { withUser } from "@/lib/database/client";
import { buildCustomerCatalog } from "@/features/creative-studio/service";
import { toIsoDate } from "@/lib/utils";

/** Catalogue personnalisé (PDF) d'un client (RLS : un client d'une autre organisation est introuvable). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new NextResponse("Non authentifié", { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse("Introuvable", { status: 404 });
  try {
    const file = await withUser(ctx.userId, (db) => buildCustomerCatalog(db, ctx.org.organizationId, id, toIsoDate(new Date())));
    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${file.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof Error && e.message === "Client introuvable.") return new NextResponse("Introuvable", { status: 404 });
    if (e instanceof Error && e.message.startsWith("Aucune référence")) return new NextResponse(e.message, { status: 409 });
    throw e;
  }
}
