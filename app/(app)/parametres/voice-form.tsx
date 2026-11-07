"use client";

import { useActionState } from "react";
import { updateVoiceAction, type ActionResult } from "@/app/actions/commercial";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

export type VoiceInitial = {
  tone: "warm" | "dynamic" | "formal" | "expert";
  length: "short" | "medium";
  whatsappEmojis: boolean;
  assistantTitle: string;
  styleNotes: string;
  defaultChannel: "email" | "whatsapp";
  followupChannels: string[];
  companyName: string;
};

export function VoiceForm({ initial, readOnly }: { initial: VoiceInitial; readOnly: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updateVoiceAction, null);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="tone">Ton</Label>
          <Select id="tone" name="tone" defaultValue={initial.tone} disabled={readOnly} className="w-full">
            <option value="warm">Chaleureux et direct</option>
            <option value="dynamic">Commercial dynamique</option>
            <option value="formal">Très professionnel</option>
            <option value="expert">Expert conseil</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="length">Longueur des e-mails</Label>
          <Select id="length" name="length" defaultValue={initial.length} disabled={readOnly} className="w-full">
            <option value="short">Courts (5 à 8 lignes)</option>
            <option value="medium">Moyens (10 à 15 lignes, avec arguments)</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="assistantTitle">Présentation</Label>
          <div className="flex items-center gap-1.5 text-[13px]">
            <span className="shrink-0">LÉA,</span>
            <Input id="assistantTitle" name="assistantTitle" defaultValue={initial.assistantTitle} disabled={readOnly} />
            <span className="shrink-0">de {initial.companyName}</span>
          </div>
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-[13px]">
          <input type="checkbox" name="whatsappEmojis" defaultChecked={initial.whatsappEmojis} disabled={readOnly} />
          Quelques emojis sur WhatsApp (jamais par e-mail)
        </label>
      </div>
      <div className="space-y-1">
        <Label htmlFor="styleNotes">Consignes de style (formules, vocabulaire, positionnement — sans chiffres)</Label>
        <textarea id="styleNotes" name="styleNotes" defaultValue={initial.styleNotes} disabled={readOnly} rows={6} maxLength={2000}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] leading-relaxed" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="defaultChannel">Canal prioritaire</Label>
          <Select id="defaultChannel" name="defaultChannel" defaultValue={initial.defaultChannel} disabled={readOnly} className="w-full">
            <option value="whatsapp">WhatsApp, sinon e-mail</option>
            <option value="email">E-mail, sinon WhatsApp</option>
          </Select>
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="space-y-1">
            <Label htmlFor={`followup${i + 1}`}>{i + 1}re relance</Label>
            <Select id={`followup${i + 1}`} name={`followup${i + 1}`} defaultValue={initial.followupChannels[i] ?? "same"} disabled={readOnly} className="w-full">
              <option value="same">Même canal</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
            </Select>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-faint">
        La voix change la forme des messages, jamais le fond : prix, stock, remises et arguments (« meilleure vente », « stock limité »…) viennent uniquement des données.
        Sur WhatsApp, le premier message et les relances utilisent les modèles approuvés par Meta ; la discussion est libre dès que le client répond.
      </p>
      {!readOnly ? (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer la voix"}</Button>
          {state ? <p className={state.ok ? "text-[13px] text-success" : "text-[13px] text-danger"} role="status">{state.ok ? state.message : state.error}</p> : null}
        </div>
      ) : null}
    </form>
  );
}
