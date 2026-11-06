"use client";

import { useActionState } from "react";
import { updateSettingsAction, type ActionResult } from "@/app/actions/commercial";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

type Initial = { maxAutoDiscountPct: string; dormantAfterDays: number; reorderLookaheadDays: number; offerValidityDays: number; primaryColor: string; companyName: string };

export function SettingsForm({ initial, readOnly }: { initial: Initial; readOnly: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updateSettingsAction, null);
  const field = (name: keyof Initial, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={String(initial[name])} disabled={readOnly} {...props} />
    </div>
  );
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {field("maxAutoDiscountPct", "Remise max. sans transfert (%)", { type: "number", step: "0.01", min: 0, max: 100 })}
      {field("offerValidityDays", "Validité des offres (jours)", { type: "number", min: 1, max: 365 })}
      {field("dormantAfterDays", "Client dormant après (jours)", { type: "number", min: 15, max: 1000 })}
      {field("reorderLookaheadDays", "Horizon de réassort (jours)", { type: "number", min: 1, max: 120 })}
      {field("companyName", "Nom affiché sur les documents", { maxLength: 120 })}
      {field("primaryColor", "Couleur principale", { pattern: "#[0-9a-fA-F]{6}" })}
      {!readOnly ? (
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer"}</Button>
          {state ? <span className={state.ok ? "text-[12.5px] text-success" : "text-[12.5px] text-danger"}>{state.ok ? state.message : state.error}</span> : null}
        </div>
      ) : (
        <p className="text-[12px] text-faint sm:col-span-2">Modifiable par un administrateur.</p>
      )}
    </form>
  );
}
