import Link from "next/link";
import { Mail, MessageCircle, Briefcase, Smartphone, Phone } from "lucide-react";
import { db } from "@/lib/auth/context";
import { formatRelative } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState } from "@/components/ui/misc";

export const metadata = { title: "Conversations" };

const CHANNEL_ICON ={ email: Mail, whatsapp: MessageCircle, linkedin: Briefcase, sms: Smartphone, phone: Phone } as const;
const STATUS: Record<string, { label: string; tone: "primary" | "warning" | "neutral" | "success" }> = {
  open: { label: "Ouverte", tone: "neutral" },
  waiting_us: { label: "À traiter", tone: "primary" },
  waiting_customer: { label: "En attente client", tone: "neutral" },
  closed: { label: "Clôturée", tone: "success" },
};

export default async function ConversationsPage() {
  const rows = await db(async (d, ctx) =>
    (await d.query<{ id: string; channel: keyof typeof CHANNEL_ICON; subject: string | null; status: string; last_message_at: string | null; customer: string | null; customer_id: string | null; contact: string | null; pending: number; unhandled: number; last_body: string | null; identity_confidence: string }>(
      `select c.id, c.channel, c.subject, c.status, c.last_message_at, coalesce(cu.trade_name, cu.legal_name) as customer, c.customer_id, c.identity_confidence,
              nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '') as contact,
              (select count(*)::int from messages m where m.conversation_id = c.id and m.status = 'pending_approval') as pending,
              (select count(*)::int from messages m where m.conversation_id = c.id and m.direction = 'inbound' and not m.handled) as unhandled,
              (select left(m.body, 140) from messages m where m.conversation_id = c.id order by m.created_at desc limit 1) as last_body
       from conversations c left join customers cu on cu.id = c.customer_id left join contacts ct on ct.id = c.contact_id
       where c.organization_id = $1 order by (c.status = 'waiting_us') desc, c.last_message_at desc nulls last limit 100`, [ctx.org.organizationId])).rows,
  );
  return (
    <>
      <PageHeader title="Conversations" description="Tous les échanges des canaux connectés, rattachés aux clients lorsque l'identité est vérifiée." />
      {rows.length === 0 ? (
        <EmptyState title="Aucune conversation" description="Les échanges apparaîtront ici dès qu'un canal sera connecté ou qu'une offre sera envoyée." />
      ) : (
        <Card className="divide-y divide-border">
          {rows.map((c) => {
            const Icon = CHANNEL_ICON[c.channel] ?? Mail;
            return (
              <Link key={c.id} href={`/conversations/${c.id}`} className="flex items-start gap-3 px-5 py-3.5 hover:bg-muted/50">
                <div className="mt-0.5 rounded-md bg-muted p-1.5 text-subtle">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold">{c.customer ?? "Expéditeur non identifié"}</span>
                    {c.contact ? <span className="text-[12.5px] text-subtle">· {c.contact}</span> : null}
                    <Badge tone={STATUS[c.status]?.tone ?? "neutral"}>{STATUS[c.status]?.label}</Badge>
                    {c.pending ? <Badge tone="warning">{c.pending} à valider</Badge> : null}
                    {c.unhandled ? <Badge tone="primary">{c.unhandled} non traité(s)</Badge> : null}
                    {c.identity_confidence !== "verified" ? <Badge tone="outline">Identité {c.identity_confidence === "probable" ? "probable" : "inconnue"}</Badge> : null}
                  </div>
                  <p className="mt-0.5 truncate text-[13px] font-medium">{c.subject ?? "Sans objet"}</p>
                  <p className="truncate text-[12.5px] text-subtle">{c.last_body}</p>
                </div>
                <span className="shrink-0 text-[11.5px] text-faint">{formatRelative(c.last_message_at)}</span>
              </Link>
            );
          })}
        </Card>
      )}
    </>
  );
}
