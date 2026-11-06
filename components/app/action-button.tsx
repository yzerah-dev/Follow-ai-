"use client";

import { useState, useTransition } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { ActionResult } from "@/app/actions/commercial";

/** Bouton qui exécute une action serveur et affiche son résultat (aucun faux bouton). */
export function ActionButton({
  action,
  children,
  pendingLabel,
  confirm,
  ...props
}: Omit<ButtonProps, "onClick" | "action"> & { action: () => Promise<ActionResult | void>; pendingLabel?: string; confirm?: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        {...props}
        disabled={pending || props.disabled}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const r = await action();
            if (r) setResult(r);
          });
        }}
      >
        {pending ? (pendingLabel ?? "En cours…") : children}
      </Button>
      {result && !result.ok ? (
        <span role="alert" className="max-w-xs text-[12px] text-danger">
          {result.error}
        </span>
      ) : null}
      {result && result.ok && result.message ? <span className="max-w-sm text-[12px] text-success">{result.message}</span> : null}
    </span>
  );
}
