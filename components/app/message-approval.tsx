"use client";

import { useState, useTransition } from "react";
import { Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { decideMessageAction, sendManualReplyAction, simulateReplyAction, simulateExcelReplyAction, type ActionResult } from "@/app/actions/commercial";

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
  "Bonjour, c'est bien disponible en stock ? Et quel est mon franco de port ?",
  "Jusqu'à quand l'offre est valable ? Et quel délai de livraison ?",
  "C'est un peu cher, vous pouvez faire un geste de 1 % ?",
  "Bonjour, votre offre est trop chère, pouvez-vous nous faire une remise de 5 % ?",
  "Bonjour, nous avons encore du stock, revenez vers nous le mois prochain.",
  "C'est validé pour nous, vous pouvez lancer la commande.",
  "Bonjour, pourrions-nous organiser un rendez-vous en visio pour voir les nouveautés ?",
];

export function SimulateReply({ conversationId, excelId }: { conversationId: string; excelId?: string | null }) {
  const [text, setText] = useState(SAMPLES[0]!);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [excelPending, startExcel] = useTransition();
  const [excelResult, setExcelResult] = useState<ActionResult | null>(null);
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-warning/40 bg-warning-soft/50 p-4">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-warning">Outil de démonstration — simuler une réponse client</p>
      <div className="flex flex-wrap gap-1.5">
        {SAMPLES.map((x) => (
          <button key={x} onClick={() => setText(x)} title={x} aria-label={x} className="rounded-full border border-warning/30 bg-surface px-2.5 py-1 text-[11.5px] hover:bg-warning-soft">
            {x.length > 44 ? `${x.slice(0, 44)}…` : x}
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
      <form
        className="space-y-2 border-t border-warning/30 pt-3"
        data-testid="simulate-excel"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startExcel(async () => setExcelResult(await simulateExcelReplyAction(conversationId, fd)));
        }}
      >
        <p className="text-[12.5px]">
          Le client renvoie l’Excel avec ses quantités{excelId ? <> — <a className="text-primary underline" href={`/api/assets/${excelId}`}>télécharger l’Excel de la sélection</a>, modifiez la colonne des quantités, puis joignez-le :</> : " :"}
        </p>
        <input type="file" name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required aria-label="Excel du client" className="block w-full text-[12.5px]" />
        <input type="text" name="body" placeholder="Texte du client (facultatif)" aria-label="Texte accompagnant le fichier" className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px]" />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="secondary" disabled={excelPending}>{excelPending ? "LÉA lit le fichier…" : "Joindre l’Excel en tant que client"}</Button>
          {excelResult ? <span className={excelResult.ok ? "text-[12.5px] text-success" : "text-[12.5px] text-danger"}>{excelResult.ok ? excelResult.message : excelResult.error}</span> : null}
        </div>
      </form>
    </div>
  );
}

/** Zone de réponse : un humain peut reprendre la main à tout moment. */
export function ReplyComposer({ conversationId, channel, blockedReason }: { conversationId: string; channel: "email" | "whatsapp"; blockedReason: string | null }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <div className="rounded-xl border border-border bg-surface p-3 shadow-card">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={channel === "whatsapp" ? 2 : 4}
        maxLength={channel === "whatsapp" ? 4096 : 8000}
        placeholder={channel === "whatsapp" ? "Écrire sur WhatsApp en votre nom…" : "Répondre par email en votre nom…"}
        aria-label="Votre réponse"
        disabled={!!blockedReason}
        className="border-0 shadow-none focus:ring-0"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending || !text.trim() || !!blockedReason}
          onClick={() =>
            start(async () => {
              const r = await sendManualReplyAction(conversationId, text);
              setResult(r);
              if (r.ok) setText("");
            })
          }
        >
          <Send /> {pending ? "Envoi…" : "Envoyer"}
        </Button>
        <span className="text-[12px] text-faint">{blockedReason ?? "Vous reprenez la main : LÉA continue sur les prochains messages du client."}</span>
        {result ? <span className={result.ok ? "text-[12.5px] text-success" : "text-[12.5px] text-danger"}>{result.ok ? result.message : result.error}</span> : null}
      </div>
    </div>
  );
}
