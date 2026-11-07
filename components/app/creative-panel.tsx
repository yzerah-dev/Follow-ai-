"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Sheet, BookOpen, Image as ImageIcon, LayoutTemplate, Camera, Check, X, Download, Eye, ListOrdered, Mail, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { generateAssetsAction, decideAssetAction, resumeJobAction, type ActionResult } from "@/app/actions/commercial";
import { cn } from "@/lib/utils";

const KINDS = [
  { key: "offer_pdf", label: "Offre PDF", icon: FileText },
  { key: "offer_excel", label: "Offre Excel illustrée", icon: Sheet },
  { key: "coverage_excel", label: "Analyse de couverture", icon: Sheet },
  { key: "synthesis_pdf", label: "Synthèse commerciale", icon: FileText },
  { key: "priority_pdf", label: "Sélection prioritaire", icon: ListOrdered },
  { key: "email_txt", label: "Email personnalisé", icon: Mail },
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
  const router = useRouter();
  const [job, setJob] = useState<{ id: string; status: string; progress: number; total: number; step: string | null; error: string | null } | null>(null);
  // Suivi de la génération en tâche de fond (sondage léger toutes les secondes, arrêté à la fin).
  useEffect(() => {
    if (!job || job.status === "succeeded" || job.status === "failed") return;
    const t = setTimeout(async () => {
      const r = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
      if (!r.ok) return;
      const s = await r.json();
      setJob(s);
      if (s.status === "succeeded" || s.status === "failed") router.refresh();
    }, 1000);
    return () => clearTimeout(t);
  }, [job, router]);

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
                  const r = await generateAssetsAction(offerId, selected);
                  setResult(r);
                  if (r.ok && r.jobId) setJob({ id: r.jobId, status: "queued", progress: 0, total: selected.length, step: null, error: null });
                })
              }
            >
              {pending ? "Lancement…" : "Créer mes supports"}
            </Button>
            {result && !job ? <span className={cn("text-[12.5px]", result.ok ? "text-success" : "text-danger")}>{result.ok ? result.message : result.error}</span> : null}
          </div>
          {job ? (
            <div className="rounded-lg border border-border px-3 py-2.5" data-testid="job-progress">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="flex items-center gap-1.5 font-medium">
                  {job.status === "succeeded" ? <Check className="size-4 text-success" /> : job.status === "failed" ? <X className="size-4 text-danger" /> : <Loader2 className="size-4 animate-spin" />}
                  {job.status === "succeeded" ? "Documents prêts" : job.status === "failed" ? "Génération interrompue" : `Génération en cours${job.step ? ` : ${KINDS.find((k) => k.key === job.step)?.label ?? job.step}` : "…"}`}
                </span>
                <span className="tabular text-subtle">{job.progress} / {job.total}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={job.progress} aria-valuemax={job.total}>
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${job.total ? (job.progress / job.total) * 100 : 0}%` }} />
              </div>
              {job.status === "failed" ? (
                <div className="mt-2 flex items-center gap-2 text-[12px] text-danger">
                  <span className="flex-1">{job.error}</span>
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await resumeJobAction(job.id); setResult(r); if (r.ok) setJob({ ...job, status: "queued", error: null }); })}>Reprendre</Button>
                </div>
              ) : null}
            </div>
          ) : null}
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
