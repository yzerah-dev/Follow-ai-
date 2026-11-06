"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, FileText, Package, Tag, MessagesSquare, Plug, Settings, LogOut, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { logoutAction, switchOrgAction } from "@/app/actions/auth";
import { ROLE_LABEL, type MemberRole } from "@/lib/auth/roles";

const NAV = [
  { href: "/", label: "Accueil", icon: Home },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/factures", label: "Factures", icon: FileText },
  { href: "/produits", label: "Produits", icon: Package },
  { href: "/offres", label: "Offres", icon: Tag },
  { href: "/conversations", label: "Conversations", icon: MessagesSquare, badge: "replies" as const },
];
const BOTTOM = [
  { href: "/connexions", label: "Connexions", icon: Plug },
  { href: "/parametres", label: "Paramètres", icon: Settings },
];

export function Sidebar(props: {
  orgName: string;
  orgId: string;
  memberships: { id: string; name: string }[];
  userName: string;
  role: MemberRole;
  counts: { approvals: number; replies: number };
}) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const item = (n: { href: string; label: string; icon: typeof Home; badge?: "replies" }) => {
    const count = n.badge ? props.counts[n.badge] : 0;
    return (
      <Link
        key={n.href}
        href={n.href}
        className={cn(
          "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] font-medium transition-colors",
          active(n.href) ? "bg-surface text-foreground shadow-card ring-1 ring-border" : "text-subtle hover:bg-surface/70 hover:text-foreground",
        )}
      >
        <n.icon className={cn("size-4", active(n.href) ? "text-primary" : "text-faint group-hover:text-subtle")} />
        <span className="flex-1">{n.label}</span>
        {count > 0 ? <span className="rounded-full bg-primary px-1.5 text-[10.5px] font-semibold leading-[18px] text-white">{count}</span> : null}
      </Link>
    );
  };
  return (
    <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r border-border bg-muted/60 px-3 py-4 md:flex">
      <div className="mb-5 flex items-center gap-2 px-1.5">
        <div className="lea-gradient flex h-7 w-7 items-center justify-center rounded-md text-[13px] font-bold text-white">F</div>
        <span className="text-[15px] font-semibold tracking-tight">Follow.AI</span>
      </div>
      {props.memberships.length > 1 ? (
        <form action={switchOrgAction} className="mb-4">
          <label className="relative block">
            <span className="sr-only">Organisation</span>
            <select
              name="organizationId"
              defaultValue={props.orgId}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="w-full appearance-none truncate rounded-md border border-border bg-surface py-1.5 pl-2.5 pr-7 text-[12.5px] font-medium shadow-card"
            >
              {props.memberships.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <ChevronsUpDown className="pointer-events-none absolute right-2 top-2 size-3.5 text-faint" />
          </label>
        </form>
      ) : (
        <div className="mb-4 truncate rounded-md px-2.5 py-1 text-[12.5px] font-medium text-subtle" title={props.orgName}>
          {props.orgName}
        </div>
      )}
      <nav className="flex flex-col gap-0.5">{NAV.map(item)}</nav>
      <div className="mt-auto flex flex-col gap-0.5">
        {BOTTOM.map(item)}
        <div className="mt-3 flex items-center gap-2 border-t border-border px-1.5 pt-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium">{props.userName}</p>
            <p className="text-[11px] text-faint">{ROLE_LABEL[props.role]}</p>
          </div>
          <form action={logoutAction}>
            <button className="rounded-md p-1.5 text-faint hover:bg-surface hover:text-foreground" title="Se déconnecter" aria-label="Se déconnecter">
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
