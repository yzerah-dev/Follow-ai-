import Link from "next/link";
import { Search } from "lucide-react";

export function SearchForm({ q, placeholder, children }: { q?: string; placeholder: string; children?: React.ReactNode }) {
  return (
    <form className="mb-4 flex flex-wrap items-center gap-2" role="search">
      <div className="relative min-w-[260px] flex-1 sm:max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
        <input
          name="q"
          defaultValue={q}
          placeholder={placeholder}
          className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-sm shadow-card outline-none placeholder:text-faint focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
        />
      </div>
      {children}
      <button className="h-9 rounded-md border border-border bg-surface px-3 text-sm font-medium shadow-card hover:bg-muted">Filtrer</button>
    </form>
  );
}

export function Pagination({ page, pages, total, base, params }: { page: number; pages: number; total: number; base: string; params: Record<string, string | undefined> }) {
  const href = (p: number) => {
    const sp = new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `${base}?${sp.toString()}`;
  };
  return (
    <div className="flex items-center justify-between px-1 pt-3 text-[13px] text-subtle">
      <span>{total.toLocaleString("fr-FR")} résultat(s)</span>
      <div className="flex items-center gap-2">
        {page > 1 ? <Link className="rounded-md border border-border bg-surface px-2.5 py-1 hover:bg-muted" href={href(page - 1)}>Précédent</Link> : null}
        <span>
          Page {page} / {pages}
        </span>
        {page < pages ? <Link className="rounded-md border border-border bg-surface px-2.5 py-1 hover:bg-muted" href={href(page + 1)}>Suivant</Link> : null}
      </div>
    </div>
  );
}

export function pageParam(v: string | string[] | undefined) {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(n) && n > 0 && n < 10_000 ? n : 1;
}

export function strParam(v: string | string[] | undefined, max = 100) {
  const s = (Array.isArray(v) ? v[0] : v)?.trim();
  return s ? s.slice(0, max) : undefined;
}
