"use client";

import { useActionState } from "react";
import { saveWhatsAppConnectionAction, disconnectWhatsAppAction, type ActionResult } from "@/app/actions/commercial";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { ActionButton } from "@/components/app/action-button";

export type WhatsAppSetupInitial = {
  connected: boolean;
  phoneNumberId: string;
  wabaId: string;
  testMode: boolean;
  testNumbers: string[];
  approvedTemplates: string[];
  hasToken: boolean;
};

/** Connexion du vrai WhatsApp Business (Meta). Les identifiants restent côté serveur ; le jeton n'est jamais réaffiché. */
export function WhatsAppSetup({ initial, templates, customers, webhookUrl }: {
  initial: WhatsAppSetupInitial; templates: { name: string; text: string }[]; customers: { id: string; name: string }[]; webhookUrl: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveWhatsAppConnectionAction, null);
  return (
    <div className="mt-4 space-y-4 rounded-md border border-border p-4" data-testid="whatsapp-setup">
      <div>
        <h3 className="text-[14px] font-semibold">Connecter le vrai WhatsApp Business (Meta)</h3>
        <p className="mt-1 text-[12.5px] text-subtle">
          Adresse à indiquer à Meta (« URL de rappel » du webhook) : <code className="break-all rounded bg-muted px-1">{webhookUrl}</code>.
          Le jeton de vérification et la clé secrète de l’app Meta se règlent chez l’hébergeur (WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET).
        </p>
      </div>
      <form action={action} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="wa-pnid">Identifiant du numéro (Phone number ID)</Label>
            <Input id="wa-pnid" name="phoneNumberId" inputMode="numeric" defaultValue={initial.phoneNumberId} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wa-waba">Identifiant du compte WhatsApp Business (facultatif)</Label>
            <Input id="wa-waba" name="wabaId" inputMode="numeric" defaultValue={initial.wabaId} />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="wa-token">Jeton d’accès Meta</Label>
          <Input id="wa-token" name="accessToken" type="password" autoComplete="off"
            placeholder={initial.hasToken ? "Jeton enregistré (chiffré) — laisser vide pour le conserver" : "Collez ici le jeton fourni par Meta"} />
          <p className="text-[12px] text-faint">Stocké chiffré, jamais réaffiché, jamais transmis à l’IA.</p>
        </div>
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" name="testMode" defaultChecked={initial.testMode} className="mt-0.5" />
          <span><b>Mode test</b> : LÉA n’écrit pour de vrai qu’aux numéros de test ci-dessous ; toutes les autres conversations restent simulées et les messages d’autres numéros sont ignorés.</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="wa-tests">Numéros de test (séparés par des virgules)</Label>
            <Input id="wa-tests" name="testNumbers" defaultValue={initial.testNumbers.join(", ")} placeholder="06 12 34 56 78" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wa-cust">Vous êtes reconnu comme le client…</Label>
            <Select id="wa-cust" name="testCustomerId" defaultValue="" className="w-full">
              <option value="">— ne pas rattacher —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-[13px] font-medium">Modèles approuvés par Meta (nécessaires pour écrire en premier au client)</legend>
          {templates.map((t) => (
            <label key={t.name} className="flex items-start gap-2 text-[12.5px]">
              <input type="checkbox" name="approvedTemplates" value={t.name} defaultChecked={initial.approvedTemplates.includes(t.name)} className="mt-0.5" />
              <span><code>{t.name}</code> — <span className="text-subtle">{t.text.slice(0, 90)}…</span></span>
            </label>
          ))}
          <p className="text-[12px] text-faint">Ne cochez un modèle qu’une fois validé par Meta. Sans modèle, LÉA répond seulement quand le client lui écrit (fenêtre de 24 h).</p>
        </fieldset>
        <label className="flex items-start gap-2 rounded-md bg-warning-soft/60 p-3 text-[13px]">
          <input type="checkbox" name="confirmRealSends" required className="mt-0.5" />
          <span>J’autorise LÉA à envoyer de vrais messages WhatsApp au nom de l’entreprise (uniquement aux numéros de test tant que le mode test est actif).</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>{pending ? "Connexion…" : initial.connected ? "Mettre à jour" : "Connecter WhatsApp"}</Button>
          {initial.connected ? <ActionButton size="sm" variant="secondary" action={disconnectWhatsAppAction} confirm="Couper le vrai WhatsApp ? Plus aucun message réel ne partira.">Déconnecter</ActionButton> : null}
          {state ? <span className={state.ok ? "text-[12.5px] text-success" : "text-[12.5px] text-danger"}>{state.ok ? state.message : state.error}</span> : null}
        </div>
      </form>
    </div>
  );
}
