import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DAY = 86_400_000;
export const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);
export const parseIsoDate = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);
export const daysBetween = (a: string | Date, b: string | Date) => {
  const da = typeof a === "string" ? parseIsoDate(a) : a;
  const db = typeof b === "string" ? parseIsoDate(b) : b;
  return Math.round((db.getTime() - da.getTime()) / DAY);
};
export const addDays = (d: string | Date, n: number) => {
  const base = typeof d === "string" ? parseIsoDate(d) : new Date(d);
  return new Date(base.getTime() + n * DAY);
};

export function formatDate(s: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }) {
  if (!s) return "—";
  const d = typeof s === "string" ? new Date(s.length === 10 ? `${s}T00:00:00Z` : s) : s;
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", ...opts }).format(d);
}

export function formatRelative(s: string | Date | null | undefined, now = new Date()) {
  if (!s) return "—";
  const d = typeof s === "string" ? new Date(s.length === 10 ? `${s}T00:00:00Z` : s) : s;
  const days = Math.round((now.getTime() - d.getTime()) / DAY);
  if (days === 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days > 0 && days < 60) return `il y a ${days} j`;
  if (days > 0) return `il y a ${Math.round(days / 30)} mois`;
  if (days === -1) return "demain";
  return `dans ${-days} j`;
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}
