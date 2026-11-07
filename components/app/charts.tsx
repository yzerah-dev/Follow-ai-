"use client";

import { useState } from "react";

/** Courbe d'évolution (une série) avec réticule et info-bulle au survol. */
/** `partialLast` : le dernier point est une période en cours (segment en pointillés). */
export function AreaChart({ points, height = 170, ariaLabel, partialLast = false }: { points: { label: string; value: number; display: string }[]; height?: number; ariaLabel: string; partialLast?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 560;
  const padX = 12;
  const padTop = 16;
  const padBottom = 26;
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) => padX + (i * (w - padX * 2)) / Math.max(1, points.length - 1);
  const y = (v: number) => padTop + (1 - v / max) * (height - padTop - padBottom);
  const seg = (i: number) => `${x(i).toFixed(1)},${y(Math.max(0, points[i]!.value)).toFixed(1)}`;
  const line = points.map((_, i) => `${i ? "L" : "M"}${seg(i)}`).join(" ");
  const n = points.length;
  const solid = partialLast && n > 1 ? points.slice(0, -1).map((_, i) => `${i ? "L" : "M"}${seg(i)}`).join(" ") : line;
  const area = `${line} L${x(points.length - 1)},${height - padBottom} L${x(0)},${height - padBottom} Z`;
  const h = hover !== null ? points[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--chart-1)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--chart-1)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={padX} x2={w - padX} y1={height - padBottom} y2={height - padBottom} stroke="var(--color-border)" />
        <path d={area} fill="url(#area-fill)" />
        <path d={solid} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {partialLast && n > 1 ? <path d={`M${seg(n - 2)} L${seg(n - 1)}`} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" /> : null}
        {points.map((p, i) => (
          <g key={p.label}>
            <circle cx={x(i)} cy={y(Math.max(0, p.value))} r={i === points.length - 1 || hover === i ? 4.5 : 3} fill="var(--chart-1)" stroke="var(--color-surface)" strokeWidth="2" />
            <text x={x(i)} y={height - 7} textAnchor="middle" fontSize="11" fill="var(--color-subtle)">{p.label}</text>
            {/* zone de survol plus large que le point */}
            <rect x={x(i) - (w - padX * 2) / Math.max(1, points.length - 1) / 2} y={0} width={(w - padX * 2) / Math.max(1, points.length - 1)} height={height - padBottom} fill="transparent" onMouseEnter={() => setHover(i)} />
          </g>
        ))}
        {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={padTop} y2={height - padBottom} stroke="var(--color-border-strong)" strokeDasharray="3 3" pointerEvents="none" /> : null}
      </svg>
      {h ? (
        <div className="pointer-events-none absolute -translate-x-1/2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] shadow-pop" style={{ left: `${(x(hover!) / w) * 100}%`, top: 0 }}>
          <span className="text-subtle">{h.label}</span> · <span className="font-semibold tabular">{h.display}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Anneau de répartition : segments séparés, légende avec valeurs (l'identité ne repose jamais sur la couleur seule). */
export function Donut({ segments, centerLabel, ariaLabel }: { segments: { label: string; pct: number; display: string; color: string }[]; centerLabel: string; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const r = 52;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.pct, 0) || 1;
  // Décalage cumulé de chaque segment, calculé avant le rendu.
  const offsets = segments.map((_, i) => segments.slice(0, i).reduce((a, s) => a + (s.pct / total) * c, 0));
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 140 140" className="h-40 w-40 shrink-0" role="img" aria-label={ariaLabel}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--color-muted)" strokeWidth="18" />
        {segments.map((s, i) => {
          const len = (s.pct / total) * c;
          const gap = s.pct > 0 && segments.filter((x) => x.pct > 0).length > 1 ? 2 : 0;
          const el = s.pct > 0 ? (
            <circle
              key={s.label}
              cx="70" cy="70" r={r} fill="none" stroke={s.color} strokeWidth={hover === i ? 21 : 18}
              strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-offsets[i]!} transform="rotate(-90 70 70)"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            >
              <title>{`${s.label} : ${s.pct.toLocaleString("fr-FR")} % (${s.display})`}</title>
            </circle>
          ) : null;
          return el;
        })}
        <text x="70" y="75" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--color-foreground)">{hover !== null ? `${segments[hover]!.pct.toLocaleString("fr-FR")} %` : centerLabel}</text>
      </svg>
      <ul className="min-w-[180px] flex-1 space-y-2.5">
        {segments.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2.5 text-[13.5px]" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="flex-1">{s.label}</span>
            <span className="tabular text-subtle">{s.display}</span>
            <span className="tabular w-14 text-right font-medium">{s.pct.toLocaleString("fr-FR")} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
