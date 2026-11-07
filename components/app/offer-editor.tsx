"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Search, Trash2, Plus, Check, AlertTriangle, Loader2, ArrowUpDown } from "lucide-react";
import { saveOfferLinesAction, searchOfferProductsAction } from "@/app/actions/commercial";
import type { EditorLine } from "@/features/offers/editor";
import { cn } from "@/lib/utils";

type Change = { op: "update"; productId: string; quantity?: string } | { op: "remove"; productId: string } | { op: "add"; productId: string; quantity?: string };
type SortKey = "lineNo" | "reference" | "category" | "type" | "lineTotalHt" | "quantity" | "lastOrderDate" | "confidence";

const TYPE_LABEL: Record<string, string> = { reorder: "Réassort", permanent: "Permanent", back_in_stock: "Retour en stock", complementary: "Complémentaire", new_product: "Nouveauté", manual: "Ajout manuel" };
const CONF_LABEL: Record<string, string> = { verified: "Vérifié", declared: "Déclaré", high: "Fiable", medium: "Moyenne", low: "Fragile" };
const AVAIL_LABEL: Record<string, string> = { in_stock: "En stock", low_stock: "Stock faible", out_of_stock: "Rupture", on_order: "En commande", unknown: "Inconnue" };
const CONF_ORDER: Record<string, number> = { verified: 0, declared: 1, high: 2, medium: 3, low: 4 };
const ROW = 64;
const eur = (v: string | number) => Number(v).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const GRID = "grid grid-cols-[36px_56px_minmax(220px,2.2fr)_minmax(120px,1fr)_110px_120px_96px_90px_70px_96px_104px_84px] items-center gap-2";

export function OfferEditor(props: { offerId: string; revision: number; editable: boolean; lines: EditorLine[]; totals: { totalHt: string; totalTtc: string } }) {
  const [rows, setRows] = useState(props.lines);
  const [revision, setRevision] = useState(props.revision);
  const [totals, setTotals] = useState({ ...props.totals, lines: props.lines.length });
  const [pending, setPending] = useState<Map<string, Change>>(new Map());
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; text?: string }>({ kind: "idle" });
  const [rejected, setRejected] = useState<{ productId: string; reason: string }[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [type, setType] = useState("");
  const [avail, setAvail] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "lineNo", dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkQty, setBulkQty] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [adding, setAdding] = useState("");
  const [results, setResults] = useState<{ id: string; reference: string; name: string; in_offer: boolean; availability: string }[]>([]);
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewport = useRef<HTMLDivElement>(null);

  const categories = useMemo(() => [...new Set(rows.map((r) => r.category).filter(Boolean) as string[])].sort(), [rows]);
  const view = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = rows.filter((r) =>
      (!term || r.reference.toLowerCase().includes(term) || r.description.toLowerCase().includes(term) || (r.ean ?? "").includes(term) || (r.brand ?? "").toLowerCase().includes(term)) &&
      (!cat || r.category === cat) && (!type || (r.recommendationType ?? "manual") === type) && (!avail || r.availability === avail));
    const val = (r: EditorLine): string | number => {
      switch (sort.key) {
        case "lineTotalHt": return Number(r.lineTotalHt);
        case "quantity": return Number(r.quantity);
        case "confidence": return CONF_ORDER[r.confidence ?? ""] ?? 9;
        case "type": return r.recommendationType ?? "manual";
        case "category": return r.category ?? "";
        case "lastOrderDate": return r.lastOrderDate ?? "";
        case "reference": return r.reference;
        default: return r.lineNo;
      }
    };
    return [...list].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [rows, q, cat, type, avail, sort]);

  // Virtualisation : seules les lignes visibles (+ marge) sont rendues — fluide à 1 000 lignes.
  const height = 560;
  const start = Math.max(0, Math.floor(scrollTop / ROW) - 6);
  const end = Math.min(view.length, Math.ceil((scrollTop + height) / ROW) + 6);

  const queue = (changes: Change[]) => {
    setPending((prev) => {
      const next = new Map(prev);
      for (const c of changes) next.set(c.productId, c);
      return next;
    });
    setStatus({ kind: "saving", text: "Modifications en attente…" });
  };

  // Sauvegarde automatique (anti-rebond 800 ms), une seule requête pour toutes les modifications en attente.
  useEffect(() => {
    if (!pending.size || !props.editable) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const batch = [...pending.values()];
      setPending(new Map());
      startTransition(async () => {
        setStatus({ kind: "saving", text: "Enregistrement…" });
        const r = await saveOfferLinesAction(props.offerId, revision, batch);
        if (!r.ok) { setStatus({ kind: "error", text: r.error }); return; }
        setRevision(r.revision);
        setTotals(r.totals);
        setRejected(r.rejected);
        setStatus({ kind: "saved", text: `Enregistré · révision ${r.revision}${r.statusReset ? " · l'offre repasse en validation" : ""}` });
        if (batch.some((c) => c.op !== "remove") || r.rejected.length) {
          // Valeurs recalculées par le serveur (prix, colisage) : rechargement léger des lignes concernées
          const res = await fetch(`/api/offers/${props.offerId}/lines`, { cache: "no-store" });
          if (res.ok) setRows(await res.json());
        }
      });
    }, 800);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [pending, props.editable, props.offerId, revision]);

  const setQty = (productId: string, quantity: string) => {
    setRows((rs) => rs.map((r) => (r.productId === productId ? { ...r, quantity } : r)));
    if (/^\d+([.,]\d{1,3})?$/.test(quantity)) queue([{ op: "update", productId, quantity }]);
  };
  const removeSelected = () => {
    const ids = [...selected];
    setRows((rs) => rs.filter((r) => !selected.has(r.productId)));
    queue(ids.map((productId) => ({ op: "remove" as const, productId })));
    setSelected(new Set());
  };
  const bulk = (mode: "set" | "mult") => {
    if (!/^\d+([.,]\d+)?$/.test(bulkQty)) return;
    const v = Number(bulkQty.replace(",", "."));
    const changes: Change[] = [];
    setRows((rs) => rs.map((r) => {
      if (!selected.has(r.productId)) return r;
      const quantity = String(mode === "set" ? v : Math.max(1, Math.round(Number(r.quantity) * v)));
      changes.push({ op: "update", productId: r.productId, quantity });
      return { ...r, quantity };
    }));
    queue(changes);
  };
  const allVisibleSelected = view.length > 0 && view.every((r) => selected.has(r.productId));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(view.map((r) => r.productId)));
  const header = (label: string, key?: SortKey, right = false) => (
    <button type="button" disabled={!key} onClick={() => key && setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : 1 }))}
      className={cn("flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-faint", right && "justify-end", key && "hover:text-foreground")}>
      {label}{key ? <ArrowUpDown className={cn("size-3", sort.key === key ? "text-primary" : "opacity-40")} /> : null}
    </button>
  );

  // Recherche produit (anti-rebond 250 ms) déclenchée par la saisie, pas par un effet.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAddingChange = (v: string) => {
    setAdding(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (v.trim().length < 2) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => setResults(await searchOfferProductsAction(props.offerId, v)), 250);
  };

  return (
    <div className="space-y-3" data-testid="offer-editor">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher : référence, EAN, désignation, marque" aria-label="Rechercher dans l'offre"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-3 text-[13px]" />
        </label>
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filtrer par catégorie" className="rounded-lg border border-border bg-surface px-2 py-2 text-[13px]">
          <option value="">Toutes catégories</option>{categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filtrer par type de recommandation" className="rounded-lg border border-border bg-surface px-2 py-2 text-[13px]">
          <option value="">Tous types</option>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={avail} onChange={(e) => setAvail(e.target.value)} aria-label="Filtrer par disponibilité" className="rounded-lg border border-border bg-surface px-2 py-2 text-[13px]">
          <option value="">Toutes disponibilités</option>{Object.entries(AVAIL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className={cn("ml-auto inline-flex items-center gap-1.5 text-[12.5px]", status.kind === "error" ? "text-danger" : "text-subtle")} role="status" data-testid="save-status">
          {status.kind === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : status.kind === "saved" ? <Check className="size-3.5 text-success" /> : status.kind === "error" ? <AlertTriangle className="size-3.5" /> : null}
          {status.text ?? (props.editable ? "Sauvegarde automatique" : "Offre envoyée : lecture seule")}
        </span>
      </div>

      {props.editable ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[13px]">
          <span className="font-medium">{selected.size} sélectionnée(s)</span>
          <input value={bulkQty} onChange={(e) => setBulkQty(e.target.value)} placeholder="Qté / coef." aria-label="Quantité ou coefficient" className="w-24 rounded-md border border-border bg-surface px-2 py-1" />
          <button type="button" disabled={!selected.size} onClick={() => bulk("set")} className="rounded-md border border-border bg-surface px-2.5 py-1 disabled:opacity-40">Fixer la quantité</button>
          <button type="button" disabled={!selected.size} onClick={() => bulk("mult")} className="rounded-md border border-border bg-surface px-2.5 py-1 disabled:opacity-40">Multiplier</button>
          <button type="button" disabled={!selected.size} onClick={removeSelected} className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-surface px-2.5 py-1 text-danger disabled:opacity-40"><Trash2 className="size-3.5" /> Exclure</button>
          <label className="relative ml-auto">
            <Plus className="pointer-events-none absolute left-2 top-1.5 size-4 text-faint" />
            <input value={adding} onChange={(e) => onAddingChange(e.target.value)} placeholder="Ajouter un produit (réf., EAN, nom)" aria-label="Ajouter un produit" className="w-64 rounded-md border border-border bg-surface py-1 pl-7 pr-2" />
            {results.length ? (
              <ul className="absolute right-0 z-20 mt-1 max-h-72 w-96 overflow-auto rounded-lg border border-border bg-surface p-1 shadow-pop">
                {results.map((p) => (
                  <li key={p.id}>
                    <button type="button" disabled={p.in_offer} onClick={() => { queue([{ op: "add", productId: p.id }]); setAdding(""); setResults([]); }}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted disabled:opacity-40">
                      <span className="truncate">{p.reference} · {p.name}</span>
                      <span className="shrink-0 text-faint">{p.in_offer ? "déjà dans l'offre" : AVAIL_LABEL[p.availability]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </label>
        </div>
      ) : null}

      {rejected.length ? (
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-[12.5px] text-warning">{rejected.length} modification(s) refusée(s) : {rejected.slice(0, 3).map((r) => r.reason).join(" · ")}</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border">
        <div className="min-w-[1240px]">
          <div className={cn(GRID, "border-b border-border bg-muted/60 px-3 py-2")}>
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Tout sélectionner" disabled={!props.editable} />
            {header("Photo")}{header("Produit", "reference")}{header("Catégorie", "category")}{header("Type", "type")}{header("Historique", "lastOrderDate")}
            {header("Quantité", "quantity", true)}{header("PU HT", undefined, true)}{header("Colis")}{header("Dispo.")}{header("Total HT", "lineTotalHt", true)}{header("Confiance", "confidence")}
          </div>
          <div ref={viewport} style={{ height: Math.min(height, Math.max(ROW, view.length * ROW)) }} className="overflow-y-auto" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} data-testid="offer-lines">
            <div style={{ height: view.length * ROW, position: "relative" }}>
              {view.slice(start, end).map((r, k) => (
                <div key={r.productId} style={{ position: "absolute", top: (start + k) * ROW, height: ROW, left: 0, right: 0 }} className={cn(GRID, "border-b border-border/70 px-3 text-[12.5px]", selected.has(r.productId) && "bg-primary-soft/40")} data-testid="offer-line" title={r.rationale ?? undefined}>
                  <input type="checkbox" checked={selected.has(r.productId)} disabled={!props.editable} aria-label={`Sélectionner ${r.reference}`}
                    onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.productId)) n.delete(r.productId); else n.add(r.productId); return n; })} />
                  {/* eslint-disable-next-line @next/next/no-img-element -- miniature privée servie après contrôle RLS */}
                  {r.imageId ? <img src={`/api/product-images/${r.imageId}`} alt="" loading="lazy" className="h-11 w-11 rounded-md border border-border object-cover" /> : <span className="text-[10.5px] leading-tight text-faint">Photo non disponible</span>}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.description}</span>
                    <span className="block truncate text-[11px] text-faint">{r.reference}{r.ean ? ` · EAN ${r.ean}` : ""}{r.brand ? ` · ${r.brand}` : ""}</span>
                    {r.rationale ? <span className="block truncate text-[11px] text-subtle">{r.rationale}</span> : null}
                  </span>
                  <span className="truncate text-subtle">{r.category ?? "—"}</span>
                  <span className="truncate">{TYPE_LABEL[r.recommendationType ?? "manual"]}</span>
                  <span className="text-[11.5px] text-subtle">{r.purchaseCount ? `${r.purchaseCount} cmd` : "Jamais acheté"}{r.lastOrderDate ? <span className="block text-faint">dern. {new Date(`${r.lastOrderDate}T00:00:00Z`).toLocaleDateString("fr-FR")}</span> : null}</span>
                  {props.editable ? (
                    <input value={r.quantity.replace(/\.0+$/, "")} onChange={(e) => setQty(r.productId, e.target.value)} inputMode="decimal" aria-label={`Quantité ${r.reference}`}
                      className="w-full rounded-md border border-border bg-surface px-2 py-1 text-right tabular" />
                  ) : <span className="tabular text-right">{Number(r.quantity)}</span>}
                  <span className="tabular text-right">{eur(r.unitPriceHt)}</span>
                  <span className="text-subtle">{r.unitsPerCase ? `× ${r.unitsPerCase}` : "—"}</span>
                  <span className={cn("text-[11.5px]", r.availability === "in_stock" ? "text-success" : r.availability === "unknown" ? "text-faint" : "text-warning")}>{AVAIL_LABEL[r.availability] ?? r.availability}</span>
                  <span className="tabular text-right font-medium">{eur(r.lineTotalHt)}</span>
                  <span className="text-[11.5px] text-subtle">{r.confidence ? CONF_LABEL[r.confidence] : "—"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <span className="text-subtle">{view.length} ligne(s) affichée(s) sur {rows.length}</span>
        <span>Total : <strong className="tabular" data-testid="editor-total">{eur(totals.totalHt)}</strong> HT · {eur(totals.totalTtc)} TTC · {totals.lines} ligne(s)</span>
      </div>
    </div>
  );
}
