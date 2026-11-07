import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/auth/context";
import { withUser } from "@/lib/database/client";
import { getFile } from "@/lib/storage";
import { generateProductSheet } from "@/features/creative-studio/generators";
import { parseTemplate } from "@/features/creative-studio/templates";
import { rateLimit } from "@/lib/security/rate-limit";

/** Fiche produit PDF générée à la volée (composition contrôlée, données du référentiel uniquement). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new NextResponse("Non authentifié", { status: 401 });
  if (!rateLimit(`sheet:${ctx.userId}`, 30, 60_000).ok) return new NextResponse("Trop de demandes", { status: 429 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse("Introuvable", { status: 404 });
  const pdf = await withUser(ctx.userId, async (db) => {
    const p = (await db.query<{ reference: string; ean: string | null; brand: string | null; name: string; description: string | null; category: string | null; units_per_case: number | null; pcb: number | null; sale_price_ht: string | null; vat_rate: string; availability: string; marketing_points: string[]; weight_kg: string | null }>(
      `select reference, ean, brand, name, description, category, units_per_case, pcb, sale_price_ht, vat_rate, availability, marketing_points, weight_kg from products where id = $1 and organization_id = $2`,
      [id, ctx.org.organizationId])).rows[0];
    if (!p) return null;
    const img = (await db.query<{ storage_path: string; kind: string }>(`select storage_path, kind from product_images where product_id = $1 and approved order by is_primary desc limit 1`, [id])).rows[0];
    const s = (await db.query<{ name: string; is_demo: boolean; brand: { primaryColor?: string; companyName?: string } }>(`select o.name, o.is_demo, s.brand from organizations o join organization_settings s on s.organization_id = o.id where o.id = $1`, [ctx.org.organizationId])).rows[0]!;
    const tpl = parseTemplate({}, { primaryColor: s.brand.primaryColor });
    let image = null;
    if (img) {
      try {
        image = { data: await getFile(img.storage_path), mime: "image/png", isDemo: img.kind === "demo_placeholder" };
      } catch {
        image = null;
      }
    }
    return generateProductSheet(
      { reference: p.reference, ean: p.ean, brand: p.brand, name: p.name, description: p.description, category: p.category, unitsPerCase: p.units_per_case, pcb: p.pcb, priceHt: p.sale_price_ht, vatRate: p.vat_rate, availability: p.availability, marketingPoints: p.marketing_points, dimensions: null, weightKg: p.weight_kg, image },
      { companyName: s.brand.companyName ?? s.name, primaryColor: tpl.primaryColor, secondaryColor: tpl.secondaryColor, accentColor: tpl.accentColor, footerText: "Fiche générée par LÉA.AI — données du référentiel produit.", isDemo: s.is_demo },
    );
  });
  if (!pdf) return new NextResponse("Introuvable", { status: 404 });
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="fiche-produit.pdf"`, "Cache-Control": "private, no-store" } });
}
