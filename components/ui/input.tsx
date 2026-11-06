import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm shadow-card outline-none placeholder:text-faint focus:border-primary/50 focus:ring-2 focus:ring-primary/15",
        className,
      )}
      {...p}
    />
  );
}

export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-card outline-none placeholder:text-faint focus:border-primary/50 focus:ring-2 focus:ring-primary/15",
        className,
      )}
      {...p}
    />
  );
}

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[12px] font-medium text-subtle", className)} {...p} />;
}

export function Select({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn("h-9 rounded-md border border-border bg-surface px-2.5 text-sm shadow-card outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15", className)}
      {...p}
    />
  );
}
