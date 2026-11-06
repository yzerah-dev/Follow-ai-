"use client";

import { useState, useTransition } from "react";
import { Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { decideMessageAction, simulateReplyAction, type ActionResult } from "@/app/actions/commercial";

export function MessageApproval({ messageId, conversationId, subject, body, writable, simulatedChannel }: { messageId: string; conversationId: string; subject: string; body: string; writable: boolean; simulatedChannel: boolean }) {
  const [s, setS] = useState(subject);
  const [b, setB] = useState(body);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  if (!writable) return <p className="whitespace-pre-line text-[13.5px] leading-relaxed">{body}</p>;
  return (
    <div className="space-y-2.5">
      <Input value={s} onChange={(e) => setS(e.target.value)} maxLength={160} aria-label="Objet" />
      <Textarea value={b} onChange={(e) => setB(e.target.value)} rows={Math.min(18, b.split("\n").length + 2)} maxLength={8000} aria-label="Message" className="leading-relaxed" />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="success"
          disabled={pending}
          onClick={() => start(async () => setResult(await decideMessageAction(messageId, conversationId, { decision: "approved", subject: s, body: b })))}
        >
          <Send /> {simulatedChannel ? "Valider et envoyer (simulation)" : "Valider et envoyer"}
        </Button>
        <Button variant="danger" disabled={pending} onClick={() => start(async () => setResult(await decideMessageAction(messageId, conversationId, { decision: "rejected" })))}>
          <X /> Refuser
        </Button>
        {result ? <span className={result.ok ? "text-[12.5px] text-success" : "text-[12.5px] text-danger"}>{result.ok ? result.message : result.error}</span> : null}
      </div>
    </div>
  );
}

const SAMPLES = [
  "Bonjour, votre offre est trop chère, pouvez-vous nous faire une remise de 5 % ?",
  "Bonjour, nous avons encore du stock, revenez vers nous le mois prochain.",
  "C'est validé pour nous, vous pouvez lancer la commande.",
  "Bonjour, pourrions-nous organiser un rendez-vous en visio pour voir les nouveautés ?",
];

export function SimulateReply({ conversationId }: { conversationId: string }) {
  const [text, setText] = useState(SAMPLES[0]!);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-warning/40 bg-warning-soft/50 p-4">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-warning">Outil de démonstration — simuler une réponse client</p>
      <div className="flex flex-wrap gap-1.5">
        {SAMPLES.map((x) => (
          <button key={x} onClick={() => setText(x)} className="rounded-full border border-warning/30 bg-surface px-2.5 py-1 text-[11.5px] hover:bg-warning-soft">
            {x.slice(0, 42)}…
          </button>
        ))}
      </div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} aria-label="Réponse simulée" />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={pending || !text.trim()} onClick={() => start(async () => setResult(await simulateReplyAction(conversationId, text)))}>
          {pending ? "Réception et analyse par LÉA…" : "Simuler la réponse du client"}
        </Button>
        {result ? <span className={result.ok ? "text-[12.5px] text-success" : "text-[12.5px] text-danger"}>{result.ok ? result.message : result.error}</span> : null}
      </div>
    </div>
  );
}
