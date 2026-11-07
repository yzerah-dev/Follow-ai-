"use client";

import { useState, useTransition } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createOfferForCustomerAction } from "@/app/actions/commercial";

/** Construction de l'offre complète par le moteur de sélection : nombre de références et budget du client. */
export function OfferBuilderForm({ customerId }: { customerId: string }) {
  const [maxLines, setMaxLines] = useState("200");
  const [budget, setBudget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="offer-builder">
      <label className="text-[11.5px] text-subtle">
        Références max.
        <input value={maxLines} onChange={(e) => setMaxLines(e.target.value)} inputMode="numeric" aria-label="Nombre maximal de références"
          className="mt-0.5 block w-24 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-foreground" />
      </label>
      <label className="text-[11.5px] text-subtle">
        Budget HT (optionnel)
        <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder="ex. 5000" aria-label="Budget HT"
          className="mt-0.5 block w-28 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-foreground" />
      </label>
      <Button disabled={pending} onClick={() => start(async () => {
        setError(null);
        const n = Number(maxLines);
        if (!Number.isInteger(n) || n < 1 || n > 1000) { setError("Entre 1 et 1 000 références."); return; }
        if (budget && !/^\d+([.,]\d{1,2})?$/.test(budget)) { setError("Budget invalide."); return; }
        const r = await createOfferForCustomerAction(customerId, { maxLines: n, budgetHt: budget || null });
        if (r && !r.ok) setError(r.error);
      })}>
        {pending ? "LÉA analyse le catalogue…" : <>Préparer l&apos;offre complète <ArrowRight /></>}
      </Button>
      {error ? <span role="alert" className="w-full text-[12px] text-danger">{error}</span> : null}
    </div>
  );
}
