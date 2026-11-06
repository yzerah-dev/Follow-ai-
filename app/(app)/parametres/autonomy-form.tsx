"use client";

import { useActionState } from "react";
import { updateAutonomyAction, type ActionResult } from "@/app/actions/commercial";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

export type AutonomyInitial = {
  level: "supervised" | "semi_autonomous" | "autonomous";
  discountWithoutApproval: boolean;
  maxOfferHt: string;
  dailySendLimit: number;
  dailyOfferLimit: number;
  days: number[];
  start: string;
  end: string;
  followupAfterDays: number;
  maxFollowups: number;
  maxDiscountPct: string;
};

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export function AutonomyForm({ initial, readOnly }: { initial: AutonomyInitial; readOnly: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updateAutonomyAction, null);
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="autonomyLevel">Niveau d&apos;autonomie</Label>
        <Select id="autonomyLevel" name="autonomyLevel" defaultValue={initial.level} disabled={readOnly} className="w-full">
          <option value="supervised">Supervisé — chaque envoi est validé par un humain</option>
          <option value="semi_autonomous">Semi-autonome — LÉA envoie les messages simples</option>
          <option value="autonomous">Autonome — LÉA envoie tout ce qui respecte la politique</option>
        </Select>
      </div>
      <label className="flex items-start gap-2 text-[13px]">
        <input type="checkbox" name="discountWithoutApproval" defaultChecked={initial.discountWithoutApproval} disabled={readOnly} className="mt-0.5" />
        <span>
          LÉA peut accorder seule une remise jusqu&apos;à <strong>{initial.maxDiscountPct} %</strong> (au-delà : transfert au commercial)
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="autonomousMaxOfferHt">Montant max. d&apos;une offre envoyée seule (€ HT, vide = sans plafond)</Label>
          <Input id="autonomousMaxOfferHt" name="autonomousMaxOfferHt" defaultValue={initial.maxOfferHt} disabled={readOnly} inputMode="decimal" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="dailyOfferLimit">Offres préparées par jour (max.)</Label>
          <Input id="dailyOfferLimit" name="dailyOfferLimit" type="number" min={0} max={1000} defaultValue={initial.dailyOfferLimit} disabled={readOnly} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="dailySendLimit">Envois automatiques par jour (max.)</Label>
          <Input id="dailySendLimit" name="dailySendLimit" type="number" min={0} max={10000} defaultValue={initial.dailySendLimit} disabled={readOnly} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="followupAfterDays">Relance après (jours)</Label>
            <Input id="followupAfterDays" name="followupAfterDays" type="number" min={1} max={60} defaultValue={initial.followupAfterDays} disabled={readOnly} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="maxFollowups">Relances max.</Label>
            <Input id="maxFollowups" name="maxFollowups" type="number" min={0} max={10} defaultValue={initial.maxFollowups} disabled={readOnly} />
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Plage d&apos;envoi (heure de Paris)</Label>
        <div className="flex flex-wrap items-center gap-2">
          {DAYS.map((d, i) => (
            <label key={d} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12.5px]">
              <input type="checkbox" name="days" value={i + 1} defaultChecked={initial.days.includes(i + 1)} disabled={readOnly} /> {d}
            </label>
          ))}
          <Input name="windowStart" type="time" defaultValue={initial.start} disabled={readOnly} className="w-28" aria-label="Début" />
          <span className="text-[12px] text-faint">→</span>
          <Input name="windowEnd" type="time" defaultValue={initial.end} disabled={readOnly} className="w-28" aria-label="Fin" />
        </div>
        <p className="text-[12px] text-faint">Hors plage ou au-delà du quota, LÉA programme l&apos;envoi au prochain créneau.</p>
      </div>
      {!readOnly ? (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer l'autonomie"}</Button>
          {state ? <span className={state.ok ? "text-[12.5px] text-success" : "text-[12.5px] text-danger"}>{state.ok ? state.message : state.error}</span> : null}
        </div>
      ) : (
        <p className="text-[12px] text-faint">Modifiable par un administrateur.</p>
      )}
      <p className="rounded-md bg-muted px-3 py-2 text-[12px] text-subtle">
        Toujours soumis à un humain, quel que soit le niveau : remise au-delà du plafond, concurrence, question ouverte, expéditeur non vérifié,
        contenu suspect, 3<sup>e</sup> relance. Jamais d&apos;envoi sans consentement ni à une adresse en liste d&apos;opposition. LinkedIn : préparation seulement.
      </p>
    </form>
  );
}
