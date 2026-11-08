"use client";

import { useActionState } from "react";
import { addVoiceExampleAction, removeVoiceExampleAction, type ActionResult } from "@/app/actions/commercial";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { ActionButton } from "@/components/app/action-button";
import { EXAMPLE_SITUATIONS, EXAMPLE_SITUATION_LABEL, type VoiceExample } from "@/features/agent/voice";

/** « Former LÉA » : messages modèles de l'équipe, dont LÉA imite le ton (jamais les chiffres). */
export function ExamplesForm({ examples, readOnly }: { examples: VoiceExample[]; readOnly: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addVoiceExampleAction, null);
  return (
    <div className="space-y-4">
      {examples.length ? (
        <ul className="space-y-2" data-testid="voice-examples">
          {examples.map((e) => (
            <li key={e.id} className="rounded-lg border border-border bg-surface-2/40 p-3">
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[12px] text-faint">
                <span>{EXAMPLE_SITUATION_LABEL[e.situation]} · {e.channel === "whatsapp" ? "WhatsApp" : "E-mail"}</span>
                {readOnly ? null : (
                  <ActionButton size="sm" variant="ghost" action={removeVoiceExampleAction.bind(null, e.id)} pendingLabel="…">Supprimer</ActionButton>
                )}
              </div>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{e.text}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-faint">Aucun message modèle pour l’instant.</p>
      )}
      {readOnly ? null : (
        <form action={action} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ex-situation">Situation</Label>
              <Select id="ex-situation" name="situation" defaultValue="offre" className="w-full">
                {EXAMPLE_SITUATIONS.map((s) => <option key={s} value={s}>{EXAMPLE_SITUATION_LABEL[s]}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ex-channel">Canal</Label>
              <Select id="ex-channel" name="channel" defaultValue="whatsapp" className="w-full">
                <option value="whatsapp">WhatsApp</option>
                <option value="email">E-mail</option>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ex-text">Un message que vous avez réellement envoyé à un client</Label>
            <textarea id="ex-text" name="text" rows={6} maxLength={1500} required minLength={20}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] leading-relaxed" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending}>{pending ? "Ajout…" : "Ajouter ce message modèle"}</Button>
            {state ? <span className={state.ok ? "text-[12.5px] text-success" : "text-[12.5px] text-danger"}>{state.ok ? state.message : state.error}</span> : null}
          </div>
        </form>
      )}
      <p className="text-[12px] text-faint">
        LÉA reprend le ton, les formules et la structure de ces messages. Elle ne reprend jamais leurs prix, quantités, stocks ni affirmations
        (« prix imbattable », « peu en stock ») : tout cela vient des données du jour. Utilisé par l’IA réelle ; le moteur de démonstration n’en tient pas compte.
      </p>
    </div>
  );
}
