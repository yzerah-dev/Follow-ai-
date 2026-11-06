import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, children }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-subtle">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong bg-surface px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-faint">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-subtle">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Stat({ label, value, hint, tone = "default", href }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "primary" | "success" | "warning"; href?: string }) {
  const inner = (
    <div className={cn("rounded-lg border border-border bg-surface px-4 py-3.5 shadow-card transition-colors", href && "hover:border-border-strong")}>
      <p className="text-[12px] font-medium text-subtle">{label}</p>
      <p
        className={cn(
          "tabular mt-1 text-[22px] font-semibold tracking-tight",
          tone === "primary" && "text-primary",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[12px] text-faint">{hint}</p> : null}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-subtle">{label}</span>
      <span className="text-right font-medium">{children ?? <span className="text-faint">Non renseigné</span>}</span>
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  return <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-subtle", className)}>{initials}</div>;
}

export function LeaMark({ size = 28 }: { size?: number }) {
  return (
    <div className="lea-gradient lea-glow flex shrink-0 items-center justify-center rounded-full text-white" style={{ width: size, height: size, fontSize: size * 0.38, fontWeight: 700 }}>
      L
    </div>
  );
}
