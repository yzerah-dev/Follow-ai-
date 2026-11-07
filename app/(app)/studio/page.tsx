import Link from "next/link";
import { Download, FileText, Sheet, LayoutTemplate, BookOpen, ImageIcon, Camera } from "lucide-react";
import { db } from "@/lib/auth/context";
import { formatRelative } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Studio créatif" };

const KIND = {
  offer_pdf: { label: "Offre PDF", icon: FileText },
  offer_excel: { label: "Offre Excel illustrée", icon: Sheet },
  coverage_excel: { label: "Analyse de couverture", icon: Sheet },
  product_sheet: { label: "Fiche produit", icon: LayoutTemplate },
  catalog: { label: "Catalogue", icon: BookOpen },
  poster: { label: "Affiche", icon: ImageIcon },
  lifestyle_shooting: { label: "Shooting lifestyle", icon: Camera },
} as Record<string, { label: string; icon: typeof FileText }>;

const STATUS = { pending: { label: "À valider", tone: "warning" }, approved: { label: "Validé", tone: "success" }, rejected: { label: "Refusé", tone: "danger" } } as const;

export default async function StudioPage() {
  const { assets, templates, counts } = await db(async (d, ctx) => {
    const org = ctx.org.organizationId;
    const assets = (await d.query<{ id: string; kind: string; filename: string; validation_status: keyof typeof STATUS; created_at: string; offer_id: string | null; offer_number: string | null; customer_name: string | null }>(
      `select a.id, a.kind, a.filename, a.validation_status, a.created_at, a.offer_id, o.number as offer_number, coalesce(c.trade_name, c.legal_name) as customer_name
       from generated_assets a left join offers o on o.id = a.offer_id left join customers c on c.id = o.customer_id
       where a.organization_id = $1 order by a.created_at desc limit 60`, [org])).rows;
    const templates = (await d.query<{ id: string; kind: string; name: string; version: number }>(
      `select id, kind, name, version from creative_templates where organization_id = $1 and is_active order by kind, name`, [org])).rows;
    const counts = (await d.query<{ total: number; pending: number; approved: number }>(
      `select count(*)::int as total, count(*) filter (where validation_status = 'pending')::int as pending, count(*) filter (where validation_status = 'approved')::int as approved
       from generated_assets where organization_id = $1`, [org])).rows[0]!;
    return { assets, templates, counts };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">Studio créatif</h1>
        <p className="mt-1 text-sm text-subtle">
          Les supports que LÉA produit pour vos offres : PDF, Excel illustrés, fiches produits. Ils se génèrent depuis une offre et reprennent fidèlement vos visuels produits (aucune retouche du packaging).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[["Supports générés", counts.total], ["À valider", counts.pending], ["Validés", counts.approved]].map(([label, v]) => (
          <div key={label} className="rounded-2xl border border-border bg-surface p-5 shadow-card">
            <p className="text-[13px] font-medium text-subtle">{label}</p>
            <p className="tabular mt-2 text-[26px] font-bold">{v}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Derniers supports</CardTitle>
            <Link href="/offres" className="text-[13px] font-medium text-primary hover:underline">Créer depuis une offre</Link>
          </CardHeader>
          <CardContent className="space-y-1 px-3 pb-3">
            {assets.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-subtle">Aucun support pour l&apos;instant. Ouvrez une offre et choisissez « Générer les supports ».</p>
            ) : null}
            {assets.map((a) => {
              const k = KIND[a.kind] ?? { label: a.kind, icon: FileText };
              const st = STATUS[a.validation_status];
              return (
                <div key={a.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-muted" data-testid="studio-asset">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><k.icon className="size-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold">{k.label} · {a.filename}</span>
                    <span className="block truncate text-[12px] text-subtle">
                      {a.offer_id ? <Link href={`/offres/${a.offer_id}`} className="hover:text-primary">{a.offer_number} · {a.customer_name}</Link> : "Sans offre"} · {formatRelative(a.created_at)}
                    </span>
                  </span>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  <a href={`/api/assets/${a.id}`} className="rounded-lg p-2 text-subtle hover:bg-surface hover:text-foreground" aria-label={`Télécharger ${a.filename}`} title="Télécharger">
                    <Download className="size-4" />
                  </a>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Modèles de marque</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 px-5 pb-4">
              {templates.length === 0 ? <p className="text-[13px] text-subtle">Modèles par défaut de LÉA.AI.</p> : null}
              {templates.map((t) => (
                <p key={t.id} className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="truncate">{t.name}</span>
                  <span className="shrink-0 text-[11.5px] text-faint">{KIND[t.kind]?.label ?? t.kind} · v{t.version}</span>
                </p>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Visuels génératifs</CardTitle>
              <Badge>Désactivés</Badge>
            </CardHeader>
            <CardContent className="px-5 pb-4 text-[13px] text-subtle">
              Les mises en scène générées par IA restent désactivées tant qu&apos;aucun fournisseur n&apos;est validé. Les supports utilisent uniquement vos photos produits approuvées.
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
