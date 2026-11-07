"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, Target, ListChecks, MessagesSquare, Package, Tag, FileText, Palette, BarChart3, Plug, Settings, LogOut, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { logoutAction, switchOrgAction } from "@/app/actions/auth";
import { ROLE_LABEL, type MemberRole } from "@/lib/auth/roles";
import { LeaAvatar } from "./lea-avatar";

type Counts = { approvals: number; replies: number; opportunities: number; actions: number };
type NavItem = { href: string; label: string; icon: typeof Home; badge?: keyof Counts };

const NAV: NavItem[] = [
  { href: "/", label: "Accueil", icon: Home },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/opportunites", label: "Opportunités", icon: Target, badge: "opportunities" },
  { href: "/actions", label: "Actions", icon: ListChecks, badge: "actions" },
  { href: "/conversations", label: "Conversations", icon: MessagesSquare, badge: "replies" },
  { href: "/produits", label: "Produits", icon: Package },
  { href: "/offres", label: "Offres", icon: Tag },
  { href: "/factures", label: "Factures", icon: FileText },
  { href: "/studio", label: "Studio créatif", icon: Palette },
  { href: "/rapports", label: "Rapports", icon: BarChart3 },
];
const BOTTOM: NavItem[] = [
  { href: "/connexions", label: "Connexions", icon: Plug },
  { href: "/parametres", label: "Paramètres", icon: Settings },
];

const LEA_STATUS = {
  autonomous: { label: "Active", dot: "bg-success", text: "text-success", bg: "bg-success-soft" },
  semi_autonomous: { label: "Active", dot: "bg-success", text: "text-success", bg: "bg-success-soft" },
  supervised: { label: "Supervisée", dot: "bg-info", text: "text-info", bg: "bg-info-soft" },
  paused: { label: "Suspendue", dot: "bg-danger", text: "text-danger", bg: "bg-danger-soft" },
} as const;

export function Sidebar(props: {
  orgName: string;
  orgId: string;
  isDemo: boolean;
  memberships: { id: string; name: string }[];
  userName: string;
  role: MemberRole;
  counts: Counts;
  leaStatus: keyof typeof LEA_STATUS;
}) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const st = LEA_STATUS[props.leaStatus];
  const item = (n: NavItem) => {
    const count = n.badge ? props.counts[n.badge] : 0;
    return (
      <Link
        key={n.href}
        href={n.href}
        className={cn(
          "group flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] font-medium transition-colors",
          active(n.href) ? "bg-primary-soft text-primary" : "text-foreground/80 hover:bg-muted hover:text-foreground",
        )}
      >
        <n.icon className={cn("size-[18px]", active(n.href) ? "text-primary" : "text-subtle group-hover:text-foreground")} strokeWidth={1.8} />
        <span className="flex-1">{n.label}</span>
        {count > 0 ? <span className="rounded-full bg-primary px-2 text-[11px] font-semibold leading-5 text-white">{count > 99 ? "99+" : count}</span> : null}
      </Link>
    );
  };
  return (
    <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col overflow-y-auto border-r border-border bg-surface px-4 py-5 md:flex">
      <Link href="/" className="mb-6 flex items-center gap-2 px-2" aria-label="LÉA.AI — accueil">
        <svg width="30" height="22" viewBox="0 0 30 22" aria-hidden>
          <circle cx="7" cy="14" r="6.5" fill="#6e44ff" />
          <circle cx="17" cy="7" r="6.5" fill="#9b6bff" />
          <circle cx="24" cy="15" r="5" fill="#c4a8ff" />
        </svg>
        <span className="text-[21px] font-bold tracking-tight">léa.ai</span>
      </Link>

      <div className="mb-5 flex items-center gap-3 rounded-2xl px-2 py-1" data-testid="lea-card">
        <LeaAvatar size={52} />
        <div className="min-w-0">
          <p className="text-[15px] font-bold leading-tight">LÉA</p>
          <p className="text-[12.5px] text-subtle">Votre commerciale IA</p>
          <span className={cn("mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium", st.bg, st.text)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", st.dot)} /> {st.label}
          </span>
        </div>
      </div>

      <nav className="flex flex-col gap-1" aria-label="Navigation principale">{NAV.map(item)}</nav>
      <div className="mt-auto flex flex-col gap-1 pt-4">
        {BOTTOM.map(item)}
        {props.memberships.length > 1 ? (
          <form action={switchOrgAction} className="mt-2">
            <label className="relative block">
              <span className="sr-only">Organisation</span>
              <select
                name="organizationId"
                defaultValue={props.orgId}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="w-full appearance-none truncate rounded-xl border border-border bg-surface py-2 pl-3 pr-8 text-[12.5px] font-medium"
              >
                {props.memberships.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <ChevronsUpDown className="pointer-events-none absolute right-2.5 top-2.5 size-3.5 text-faint" />
            </label>
          </form>
        ) : null}
        <div className="mt-2 flex items-center gap-3 rounded-2xl border border-border p-3 shadow-card">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-subtle">
            <FileText className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-semibold" title={props.orgName}>{props.orgName}</p>
            <p className="truncate text-[11.5px] text-subtle">{props.userName} · {ROLE_LABEL[props.role]}</p>
            {props.isDemo ? <p className="text-[11px] text-warning">Démonstration</p> : null}
          </div>
          <form action={logoutAction}>
            <button className="rounded-lg p-1.5 text-faint hover:bg-muted hover:text-foreground" title="Se déconnecter" aria-label="Se déconnecter">
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

/** Navigation mobile (la barre latérale est masquée sous 768 px) : bandeau défilant horizontalement. */
export function MobileNav({ counts }: { counts: Counts }) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <nav className="flex gap-1.5 overflow-x-auto px-4 pt-3 md:hidden" aria-label="Navigation mobile">
      {[...NAV, ...BOTTOM].map((n) => {
        const count = n.badge ? counts[n.badge] : 0;
        return (
          <Link
            key={n.href}
            href={n.href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium",
              active(n.href) ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-foreground/80",
            )}
          >
            <n.icon className="size-4" strokeWidth={1.8} />
            {n.label}
            {count > 0 ? <span className="rounded-full bg-primary px-1.5 text-[10.5px] font-semibold leading-4 text-white">{count > 99 ? "99+" : count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
