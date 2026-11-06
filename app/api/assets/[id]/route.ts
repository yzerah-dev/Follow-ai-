import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/auth/context";
import { withUser } from "@/lib/database/client";
import { getFile } from "@/lib/storage";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new NextResponse("Non authentifié", { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse("Introuvable", { status: 404 });
  const row = await withUser(ctx.userId, async (db) =>
    (await db.query<{ storage_path: string; mime_type: string; filename: string }>(`select storage_path, mime_type, filename from generated_assets where id = $1 and organization_id = $2`, [id, ctx.org.organizationId])).rows[0],
  );
  if (!row) return new NextResponse("Introuvable", { status: 404 });
  const inline = new URL(req.url).searchParams.get("inline") === "1" && row.mime_type === "application/pdf";
  const data = await getFile(row.storage_path);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": row.mime_type,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${row.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
