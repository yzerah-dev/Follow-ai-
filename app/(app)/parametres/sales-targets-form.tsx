"use client";

import { useActionState } from "react";
import { saveSalesTargetAction, type ActionResult } from "@/app/actions/commercial";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

const eur = (v: string | null) => (v === null ? "—" : Number(v).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }));

function TargetRow({ scope, ownerUserId, label, current, realized, readOnly }: { scope: "company" | "portfolio"; ownerUserId?: string; label: string; current: string | null; realized: string; readOnly: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveSalesTargetAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 border-b border-border/70 py-2 last:border-0">
      <input type="hidden" name="scope" value={scope} />
      {ownerUserId ? <input type="hidden" name="ownerUserId" value={ownerUserId} /> : null}
      <div className="min-w-[180px] flex-1">
        <p className="text-[13px] font-medium">{label}</p>
        <p className="text-[11.5px] text-subtle">Objectif actuel : {eur(current)} · réalisé à date : {eur(realized)}</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`t-${scope}-${ownerUserId ?? "c"}`}>Objectif annuel HT</Label>
        <Input id={`t-${scope}-${ownerUserId ?? "c"}`} name="targetHt" inputMode="decimal" defaultValue={current ? Number(current).toFixed(2) : ""} disabled={readOnly} className="w-36" />
      </div>
      {!readOnly ? <Button size="sm" type="submit" disabled={pending}>{pending ? "…" : "Enregistrer"}</Button> : null}
      {state ? <span role="status" className={`w-full text-[12px] ${state.ok ? "text-success" : "text-danger"}`}>{state.ok ? state.message : state.error}</span> : null}
    </form>
  );
}

/** Objectifs de l'entreprise et des portefeuilles commerciaux (fixés par la direction ; sinon somme des objectifs clients). */
export function SalesTargetsForm(props: { readOnly: boolean; company: { annual: string | null; explicit: boolean; realized: string }; owners: { userId: string; name: string; annual: string | null; explicit: boolean; realized: string }[] }) {
  return (
    <div>
      <TargetRow scope="company" label={`Entreprise${props.company.explicit ? "" : " (somme des objectifs clients tant qu'aucun objectif n'est saisi)"}`} current={props.company.annual} realized={props.company.realized} readOnly={props.readOnly} />
      {props.owners.map((o) => (
        <TargetRow key={o.userId} scope="portfolio" ownerUserId={o.userId} label={`Portefeuille — ${o.name}${o.explicit ? "" : " (somme des objectifs de ses clients)"}`} current={o.annual} realized={o.realized} readOnly={props.readOnly} />
      ))}
    </div>
  );
}
