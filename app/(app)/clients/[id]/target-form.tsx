"use client";

import { useActionState } from "react";
import { setCustomerTargetAction, type ActionResult } from "@/app/actions/commercial";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

export function TargetForm({ customerId, suggestion }: { customerId: string; suggestion: string | null }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(setCustomerTargetAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="customerId" value={customerId} />
      <Select name="periodType" defaultValue="year" aria-label="Période">
        <option value="year">Objectif annuel</option>
        <option value="month">Objectif du mois</option>
      </Select>
      <Input name="targetHt" inputMode="decimal" placeholder={suggestion ? `ex. ${suggestion}` : "Montant HT"} className="w-36" aria-label="Montant de l'objectif HT" required />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "…" : "Enregistrer"}</Button>
      {state ? <span className={state.ok ? "text-[12px] text-success" : "text-[12px] text-danger"}>{state.ok ? state.message : state.error}</span> : null}
    </form>
  );
}
