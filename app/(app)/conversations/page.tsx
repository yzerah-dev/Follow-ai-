import Link from "next/link";
import { db } from "@/lib/auth/context";
import { formatRelative, cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { ChannelIcon, CHANNEL_LABEL } from "@/components/app/channel";
import { strParam } from "@/components/app/list-controls";

export const metadata = { title: "Conversations" };

const STATUS: Record<string, { label: string; tone: "primary" | "warning" | "neutral" | "success" }> = {
  open: { label: "Ouverte", tone: "neutral" },
  waiting_us: { label: "À traiter", tone: "primary" },
  waiting_customer: { label: "En attente du client", tone: "neutral" },
  closed: { label: "Clôturée", tone: "success" },
};

const TABS = [
  { key: "", label: "Toutes" },
  { key: "email", label: "Email" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "a-traiter", label: "À traiter" },
] as const;

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tabRaw = strParam(sp.canal) ?? "";
  const tab = TABS.some((t) => t.key === tabRaw) ? tabRaw : "";
  const { rows, counts } = await db(async (d, ctx) => {
    const params: unknown[] = [ctx.org.organizationId];
    let where = "c.organization_id = $1";
    if (tab === "email" || tab === "whatsapp") {
      params.push(tab);
      where += ` and c.channel = $${params.length}::channel`;
    }
    if (tab === "a-traiter")
      where += ` and (c.status = 'waiting_us' or exists (select 1 from messages m where m.conversation_id = c.id and m.status = 'pending_approval'))`;
    const rows = (await d.query<{ id: string; channel: string; subject: string | null; status: string; last_message_at: string | null; customer: string | null; contact: string | null; pending: number; unhandled: number; last_body: string | null; last_direction: string | null; last_by_lea: boolean | null; messages: number; identity_confidence: string }>(
      `select c.id, c.channel, c.subject, c.status, c.last_message_at, coalesce(cu.trade_name, cu.legal_name) as customer, c.identity_confidence,
              nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '') as contact,
              (select count(*)::int from messages m where m.conversation_id = c.id and m.status = 'pending_approval') as pending,
              (select count(*)::int from messages m where m.conversation_id = c.id and m.direction = 'inbound' and not m.handled) as unhandled,
              (select count(*)::int from messages m where m.conversation_id = c.id and m.status not in ('draft')) as messages,
              l.body as last_body, l.direction as last_direction, l.ai_generated as last_by_lea
       from conversations c left join customers cu on cu.id = c.customer_id left join contacts ct on ct.id = c.contact_id
       left join lateral (select left(m.body, 160) as body, m.direction, m.ai_generated from messages m where m.conversation_id = c.id and m.status <> 'draft' order by m.created_at desc limit 1) l on true
       where ${where} order by (c.status = 'waiting_us') desc, c.last_message_at desc nulls last limit 150`, params)).rows;
    const counts = (await d.query<{ email: number; whatsapp: number; todo: number; all: number }>(
      `select count(*)::int as all, count(*) filter (where channel = 'email')::int as email, count(*) filter (where channel = 'whatsapp')::int as whatsapp,
              count(*) filter (where status = 'waiting_us' or exists (select 1 from messages m where m.conversation_id = conversations.id and m.status = 'pending_approval'))::int as todo
       from conversations where organization_id = $1`, [ctx.org.organizationId])).rows[0]!;
    return { rows, counts };
  });
  const countFor = (k: string) => (k === "" ? counts.all : k === "email" ? counts.email : k === "whatsapp" ? counts.whatsapp : counts.todo);

  return (
    <>
      <PageHeader title="Conversations" description="Toutes les discussions de LÉA et de l'équipe avec les clients, email et WhatsApp réunis." />
      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Canaux">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key ? `/conversations?canal=${t.key}` : "/conversations"}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium",
              tab === t.key ? "border-primary/40 bg-primary-soft text-primary" : "border-border bg-surface text-subtle hover:bg-muted",
            )}
          >
            {t.key === "email" || t.key === "whatsapp" ? <ChannelIcon channel={t.key} size={14} /> : null}
            {t.label} <span className="text-faint">{countFor(t.key)}</span>
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState title="Aucune conversation" description="Les discussions apparaîtront ici dès que LÉA ou un client écrira." />
      ) : (
        <Card className="divide-y divide-border">
          {rows.map((c) => (
            <Link key={c.id} href={`/conversations/${c.id}`} className="flex items-start gap-3 px-5 py-3.5 hover:bg-muted/50" data-testid={`conversation-${c.channel}`}>
              <ChannelIcon channel={c.channel} size={18} boxed />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold">{c.customer ?? "Expéditeur non identifié"}</span>
                  {c.contact ? <span className="text-[12.5px] text-subtle">· {c.contact}</span> : null}
                  <span className="text-[11.5px] text-faint">{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
                  <Badge tone={STATUS[c.status]?.tone ?? "neutral"}>{STATUS[c.status]?.label}</Badge>
                  {c.pending ? <Badge tone="warning">{c.pending} à valider</Badge> : null}
                  {c.unhandled ? <Badge tone="primary">{c.unhandled} non traité(s)</Badge> : null}
                  {c.identity_confidence !== "verified" ? <Badge tone="outline">Identité {c.identity_confidence === "probable" ? "probable" : "inconnue"}</Badge> : null}
                </div>
                {c.channel === "email" && c.subject ? <p className="mt-0.5 truncate text-[13px] font-medium">{c.subject}</p> : null}
                <p className="mt-0.5 truncate text-[12.5px] text-subtle">
                  <span className="font-medium text-foreground/70">{c.last_direction === "inbound" ? "Client : " : c.last_by_lea ? "LÉA : " : "Équipe : "}</span>
                  {c.last_body}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <span className="block text-[11.5px] text-faint">{formatRelative(c.last_message_at)}</span>
                <span className="text-[11px] text-faint">{c.messages} msg</span>
              </div>
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}
