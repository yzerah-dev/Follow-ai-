"use client";

import { useState, useTransition } from "react";
import { FileText, Sheet, BookOpen, Image as ImageIcon, LayoutTemplate, Camera, Check, X, Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { generateAssetsAction, decideAssetAction, type ActionResult } from "@/app/actions/commercial";
import { cn } from "@/lib/utils";

const KINDS = [
  { key: "offer_pdf", label: "Offre PDF", icon: FileText },
  { key: "offer_excel", label: "Offre Excel illustrée", icon: Sheet },
  { key: "coverage_excel", label: "Analyse de couverture", icon: Sheet },
  { key: "product_sheet", label: "Fiches produits", icon: LayoutTemplate },
  { key: "catalog", label: "Catalogue", icon: BookOpen },
  { key: "poster", label: "Affiche", icon: ImageIcon },
  { key: "lifestyle_shooting", label: "Shooting lifestyle", icon: Camera },
] as const;

export type AssetView = {
  id: string;
  kind: string;
  filename: string;
  mime: string;
  status: "pending" | "approved" | "rejected";
  report: { ok?: boolean; checks?: { name: string; ok: boolean; detail?: string }[] };
  createdAt: string;
};

export function CreativePanel({ offerId, assets, writable }: { offerId: string; assets: AssetView[]; writable: boolean }) {
  const [selected, setSelected] = useState<string[]>(["offer_pdf", "offer_excel"]);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const toggle = (k: string) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  return (
    <div className="space-y-4">
      {writable ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => toggle(k.key)}
                aria-pressed={selected.includes(k.key)}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-[13px] transition-colors",
                  selected.includes(k.key) ? "border-primary/50 bg-primary-soft text-primary" : "border-border hover:bg-muted",
                )}
              >
                <k.icon className="size-4" />
                {k.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="lea"
              disabled={pending || selected.length === 0}
              onClick={() =>
                start(async () => {
                  setResult(await generateAssetsAction(offerId, selected));
                })
              }
            >
              {pending ? "LÉA compose vos supports…" : "Créer mes supports"}
            </Button>
            {result ? <span className={cn("text-[12.5px]", result.ok ? "text-success" : "text-danger")}>{result.ok ? result.message : result.error}</span> : null}
          </div>
          <p className="text-[12px] text-faint">
            Les documents sont composés à partir des photos sources et des données de l&apos;offre (aucun prix, packaging ou EAN modifié). La génération d&apos;images IA n&apos;est pas configurée.
          </p>
        </>
      ) : null}

      {assets.length ? (
        <div className="divide-y divide-border rounded-md border border-border">
          {assets.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5" data-testid="asset">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{a.filename}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <Badge tone={a.status === "approved" ? "success" : a.status === "rejected" ? "danger" : "warning"}>
                    {a.status === "approved" ? "Validé" : a.status === "rejected" ? "Rejeté" : "À valider"}
                  </Badge>
                  {a.report.checks ? (
                    <span className={cn("text-[11.5px]", a.report.ok ? "text-success" : "text-danger")} title={a.report.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join("\n")}>
                      {a.report.ok ? `Contrôles OK (${a.report.checks.length})` : `Contrôle échoué : ${a.report.checks.filter((c) => !c.ok).map((c) => c.name).join(", ")}`}
                    </span>
                  ) : null}
                </div>
              </div>
              {a.mime === "application/pdf" ? (
                <Button asChild variant="ghost" size="sm">
                  <a href={`/api/assets/${a.id}?inline=1`} target="_blank" rel="noreferrer">
                    <Eye /> Aperçu
                  </a>
                </Button>
              ) : null}
              <Button asChild variant="ghost" size="sm">
                <a href={`/api/assets/${a.id}`}>
                  <Download /> Télécharger
                </a>
              </Button>
              {writable && a.status === "pending" ? (
                <>
                  <Button size="sm" variant="success" disabled={pending} onClick={() => start(async () => setResult(await decideAssetAction(a.id, offerId, "approved")))}>
                    <Check /> Valider
                  </Button>
                  <Button size="sm" variant="danger" disabled={pending} onClick={() => start(async () => setResult(await decideAssetAction(a.id, offerId, "rejected")))}>
                    <X />
                  </Button>
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
