"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Sparkles, X, ArrowUp } from "lucide-react";
import { askLeaAction } from "@/app/actions/lea";
import { LeaMark } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";

type Msg = { role: "user" | "lea"; text: string; suggestions?: { label: string; href: string }[] };

const QUICK = ["Quelles sont mes priorités du jour ?", "Quels clients sont inactifs ?", "Qu'est-ce qui attend ma validation ?"];

export function LeaPanel({ simulated }: { simulated: boolean }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, start] = useTransition();

  const ask = (q: string) => {
    if (!q.trim()) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    start(async () => {
      try {
        const r = await askLeaAction(q);
        setMessages((m) => [...m, { role: "lea", text: r.answer, suggestions: r.suggestions }]);
      } catch {
        setMessages((m) => [...m, { role: "lea", text: "Je n'ai pas pu traiter la demande. Réessayez." }]);
      }
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          className="lea-gradient lea-glow fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full py-2.5 pl-3 pr-4 text-sm font-semibold text-white transition-transform hover:scale-[1.03]"
          aria-label="Ouvrir LÉA"
        >
          <Sparkles className="size-4" /> LÉA
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/10" />
        <Dialog.Content className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-[420px] flex-col border-l border-border bg-surface shadow-pop outline-none">
          <div className="flex items-center gap-3 border-b border-border px-5 py-4">
            <LeaMark size={32} />
            <div className="flex-1">
              <Dialog.Title className="text-sm font-semibold">LÉA</Dialog.Title>
              <Dialog.Description className="text-[12px] text-subtle">Votre assistante commerciale</Dialog.Description>
            </div>
            {simulated ? <Badge tone="warning">IA simulée</Badge> : <Badge tone="primary">Claude</Badge>}
            <Dialog.Close className="rounded-md p-1.5 text-faint hover:bg-muted" aria-label="Fermer">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-subtle">Bonjour, je prépare votre travail commercial. Que souhaitez-vous savoir ?</p>
                <div className="flex flex-col gap-2">
                  {QUICK.map((q) => (
                    <button key={q} onClick={() => ask(q)} className="rounded-lg border border-border px-3 py-2 text-left text-[13px] hover:border-primary/40 hover:bg-primary-soft/40">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex gap-2.5"}>
                {m.role === "lea" ? <LeaMark size={24} /> : null}
                <div className={m.role === "user" ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-[13.5px] text-white" : "max-w-[85%] space-y-2"}>
                  <p className="whitespace-pre-line text-[13.5px] leading-relaxed">{m.text}</p>
                  {m.suggestions?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {m.suggestions.map((s) => (
                        <Link key={s.href + s.label} href={s.href} onClick={() => setOpen(false)} className="rounded-full border border-border px-2.5 py-1 text-[12px] font-medium text-primary hover:bg-primary-soft">
                          {s.label}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {pending ? <p className="pl-8 text-[13px] text-faint">LÉA réfléchit…</p> : null}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="border-t border-border p-3"
          >
            <div className="flex items-end gap-2 rounded-xl border border-border bg-surface px-3 py-2 focus-within:border-primary/50">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ask(input);
                  }
                }}
                rows={1}
                maxLength={1000}
                placeholder="Demandez à LÉA…"
                className="max-h-32 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-faint"
              />
              <button type="submit" disabled={pending || !input.trim()} className="lea-gradient rounded-lg p-1.5 text-white disabled:opacity-40" aria-label="Envoyer">
                <ArrowUp className="size-4" />
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
