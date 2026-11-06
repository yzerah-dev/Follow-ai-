"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { processImportAction } from "@/app/actions/imports";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

export function MappingForm({ importId, headers, initial, fields }: { importId: string; headers: string[]; initial: Record<string, string | null>; fields: { key: string; label: string; required: boolean }[] }) {
  const [mapping, setMapping] = useState<Record<string, string | null>>(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const used = new Set(Object.values(mapping).filter(Boolean));
  const missing = fields.filter((f) => f.required && !used.has(f.key));
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {headers.map((h) => (
          <label key={h} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
            <span className="truncate text-[13px] font-medium" title={h}>{h}</span>
            <Select value={mapping[h] ?? ""} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value || null })} className="w-56">
              <option value="">— Ignorer —</option>
              {fields.map((f) => (
                <option key={f.key} value={f.key} disabled={used.has(f.key) && mapping[h] !== f.key}>
                  {f.label}
                  {f.required ? " *" : ""}
                </option>
              ))}
            </Select>
          </label>
        ))}
      </div>
      {missing.length ? <p className="text-[13px] text-warning">Champs obligatoires non associés : {missing.map((m) => m.label).join(", ")}</p> : null}
      {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      <Button
        disabled={pending || missing.length > 0}
        onClick={() =>
          start(async () => {
            const r = await processImportAction(importId, mapping);
            if (!r.ok) setError(r.error ?? "Erreur");
            else router.refresh();
          })
        }
      >
        {pending ? "Lancement…" : "Valider et importer"}
      </Button>
    </div>
  );
}

export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 1500);
    return () => clearInterval(t);
  }, [router]);
  return <p className="mb-4 text-[13px] text-info">Import en cours de traitement… la page se met à jour automatiquement.</p>;
}
