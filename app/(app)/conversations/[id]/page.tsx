import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert, Paperclip } from "lucide-react";
import { z } from "zod";
import { db } from "@/lib/auth/context";
import { canWrite } from "@/lib/auth/roles";
import { env } from "@/lib/env";
import { formatDate, cn } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import { Badge } from "@/components/ui/badge";
import { LeaMark } from "@/components/ui/misc";
import { MessageApproval, SimulateReply, ReplyComposer } from "@/components/app/message-approval";
import { ChannelIcon, CHANNEL_LABEL } from "@/components/app/channel";
import { MESSAGE_STATUS } from "@/components/app/labels";
import { INTENT_LABEL, OBJECTION_LABEL, type Intent, type Objection } from "@/features/agent/schemas";
import { whatsappWindowOpen } from "@/features/conversations/dispatch";

type Analysis = {
  intent?: Intent;
  objection?: Objection | null;
  requestedDiscountPct?: number | null;
  summary?: string;
  injectionFlags?: string[];
  simulatedAi?: boolean;
  personalizationBasis?: string;
  rationale?: string;
  decisionText?: string;
  escalate?: boolean;
  guardNotes?: string[];
  answers?: string[];
  unknown?: string[];
  template?: { name: string } | null;
  autonomy?: { mode: string; reason: string } | null;
  kind?: string;
  attempt?: number;
};

const fmtTime = (d: string) => formatDate(d, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { data, role } = await db(async (d, ctx) => {
    const c = (await d.query<{ id: string; channel: "email" | "whatsapp"; subject: string | null; status: string; customer: string | null; customer_id: string | null; contact: string | null; contact_email: string | null; contact_phone: string | null; offer_id: string | null; offer_number: string | null; identity_confidence: string; next_action: string | null; last_inbound_at: string | null }>(
      `select c.id, c.channel, c.subject, c.status, coalesce(cu.trade_name, cu.legal_name) as customer, c.customer_id, c.identity_confidence, c.next_action, c.last_inbound_at,
              nullif(trim(concat_ws(' ', ct.salutation, ct.first_name, ct.last_name)), '') as contact, ct.email as contact_email, coalesce(ct.mobile, ct.phone) as contact_phone,
              c.offer_id, o.number as offer_number
       from conversations c left join customers cu on cu.id = c.customer_id left join contacts ct on ct.id = c.contact_id left join offers o on o.id = c.offer_id
       where c.id = $1 and c.organization_id = $2`, [id, ctx.org.organizationId])).rows[0];
    if (!c) return { data: null, role: ctx.org.role };
    const messages = (await d.query<{ id: string; direction: "inbound" | "outbound"; from_address: string | null; to_address: string | null; subject: string | null; body: string; status: string; ai_generated: boolean; ai_analysis: Analysis | null; attachments: { filename: string }[]; created_at: string; sent_at: string | null; received_at: string | null; sent_autonomously: boolean; scheduled_at: string | null; author: string | null }>(
      `select m.id, m.direction, m.from_address, m.to_address, m.subject, m.body, m.status, m.ai_generated, m.ai_analysis, m.attachments, m.created_at, m.sent_at, m.received_at,
              m.sent_autonomously, m.scheduled_at, om.display_name as author
       from messages m left join organization_members om on om.organization_id = m.organization_id and om.user_id = m.created_by and not m.ai_generated
       where m.conversation_id = $1 and m.status <> 'draft' order by m.created_at`, [id])).rows;
    const simulatedChannel = !(await d.query(`select 1 from communication_connections where organization_id = $1 and channel = $2 and status = 'connected'`, [ctx.org.organizationId, c.channel])).rowCount;
    // Excel de l'offre en cours : le client le télécharge, adapte les quantités et le renvoie.
    const excelId = c.offer_id
      ? (await d.query<{ id: string }>(`select id from generated_assets where offer_id = $1 and kind = 'offer_excel' order by created_at desc limit 1`, [c.offer_id])).rows[0]?.id ?? null
      : null;
    return { data: { c, messages, simulatedChannel, excelId }, role: ctx.org.role };
  });
  if (!data) notFound();
  const { c, messages } = data;
  const writable = canWrite(role);
  const wa = c.channel === "whatsapp";
  const windowOpen = wa && whatsappWindowOpen(c.last_inbound_at, new Date());
  const windowEnds = c.last_inbound_at ? new Date(new Date(c.last_inbound_at).getTime() + 86_400_000).toISOString() : null;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/conversations" className="text-[12.5px] text-faint hover:text-subtle">← Conversations</Link>
      <div className="mt-1 flex items-start gap-3">
        <ChannelIcon channel={c.channel} size={20} boxed />
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-semibold tracking-tight">
            {c.customer_id ? <Link href={`/clients/${c.customer_id}`} className="hover:text-primary">{c.customer}</Link> : "Expéditeur non identifié"}
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-subtle">
            <span>{CHANNEL_LABEL[c.channel]}</span>
            {c.contact ? <span>· {c.contact} ({wa ? formatPhone(c.contact_phone) : c.contact_email})</span> : null}
            {c.identity_confidence !== "verified" ? <Badge tone="warning">Identité {c.identity_confidence === "probable" ? "probable — à confirmer" : "inconnue"}</Badge> : null}
            {c.offer_id ? <Link href={`/offres/${c.offer_id}`} className="text-primary hover:underline">Offre {c.offer_number}</Link> : null}
            {wa ? (
              windowOpen ? <Badge tone="success">Fenêtre WhatsApp ouverte jusqu&apos;à {fmtTime(windowEnds!)}</Badge> : <Badge tone="outline">Fenêtre 24 h fermée — modèles approuvés uniquement</Badge>
            ) : null}
          </p>
          {!wa && c.subject ? <p className="mt-1 text-[13px] font-medium">Objet : {c.subject}</p> : null}
          {c.next_action ? <p className="mt-1 text-[12.5px] text-subtle">Prochaine action : {c.next_action}</p> : null}
        </div>
      </div>

      <div className={cn("mt-5 space-y-3 rounded-2xl p-4", wa ? "bg-[#EFEAE2]" : "bg-muted/60")} data-testid="thread">
        {messages.length === 0 ? <p className="py-8 text-center text-[13px] text-subtle">Aucun message.</p> : null}
        {messages.map((m) => {
          const a = m.ai_analysis ?? {};
          const mine = m.direction === "outbound";
          const st = MESSAGE_STATUS[m.status];
          const when = m.sent_at ?? m.received_at ?? m.created_at;
          return (
            <div key={m.id} className={cn("flex gap-2", mine ? "justify-end" : "justify-start")} data-testid={`message-${m.direction}`}>
              {!mine ? null : m.ai_generated ? <div className="order-2 mt-1"><LeaMark size={26} /></div> : null}
              <div className={cn("max-w-[85%] space-y-2", mine && "order-1")}>
                <div
                  className={cn(
                    "rounded-2xl px-3.5 py-2.5 shadow-card",
                    mine ? (m.ai_generated ? "rounded-tr-sm bg-[#EEF0FF]" : "rounded-tr-sm bg-[#DCF8C6]") : "rounded-tl-sm bg-surface",
                    wa && mine && "bg-[#D9FDD3]",
                    m.status === "pending_approval" && "ring-2 ring-warning/50",
                  )}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                    <span className="font-semibold">{!mine ? (c.contact ?? m.from_address) : m.ai_generated ? "LÉA" : (m.author ?? "Équipe")}</span>
                    {mine && m.sent_autonomously ? <Badge tone="success">Envoyé seul par LÉA</Badge> : null}
                    {m.status === "approved" && m.scheduled_at ? <Badge tone="info">Programmé {fmtTime(m.scheduled_at)}</Badge> : null}
                    {mine && m.status !== "simulated_sent" && m.status !== "sent" && !(m.status === "approved" && m.scheduled_at) ? <Badge tone={st?.tone ?? "neutral"}>{st?.label}</Badge> : null}
                    {mine && m.status === "simulated_sent" ? <Badge tone="warning">Envoi simulé</Badge> : null}
                    {a.template ? <Badge tone="outline">Modèle « {a.template.name} »</Badge> : null}
                    {a.kind === "followup" ? <Badge tone="outline">Relance n° {a.attempt}</Badge> : null}
                    {mine && a.simulatedAi ? <Badge tone="warning">IA simulée</Badge> : null}
                  </div>
                  {m.status === "pending_approval" ? (
                    <div className="space-y-2">
                      {a.autonomy?.reason || a.decisionText || a.rationale ? (
                        <div className="rounded-md bg-warning-soft px-2.5 py-1.5 text-[12px] text-warning">
                          {a.autonomy?.reason ? <p className="font-semibold">À valider : {a.autonomy.reason}</p> : null}
                          {a.decisionText ? <p>Politique commerciale : {a.decisionText}</p> : null}
                          {a.escalate ? <p className="font-semibold">Dossier transféré au commercial responsable.</p> : null}
                          {a.guardNotes?.length ? <p>Garde-fous : {a.guardNotes.join(" ; ")}</p> : null}
                        </div>
                      ) : null}
                      <MessageApproval messageId={m.id} conversationId={c.id} subject={m.subject ?? ""} body={m.body} writable={writable} simulatedChannel={data.simulatedChannel} />
                    </div>
                  ) : (
                    <>
                      {!wa && m.subject ? <p className="mb-1 text-[12.5px] font-medium">{m.subject}</p> : null}
                      <p className="whitespace-pre-line text-[13.5px] leading-relaxed">{m.body}</p>
                      {m.attachments?.length ? (
                        <p className="mt-1.5 flex items-center gap-1 text-[11.5px] text-subtle">
                          <Paperclip className="size-3" /> {m.attachments.map((x) => x.filename).join(", ")}
                        </p>
                      ) : null}
                    </>
                  )}
                  <p className="mt-1 text-right text-[10.5px] text-faint">{fmtTime(when)}</p>
                </div>
                {mine && m.ai_generated && (a.answers?.length || a.unknown?.length) ? (
                  <p className="px-1 text-right text-[11px] text-faint">
                    Réponse fondée sur les données ({a.answers?.length ?? 0} point(s)){a.unknown?.length ? ` · transmis au commercial : ${a.unknown.join(", ")}` : ""}
                  </p>
                ) : null}
                {!mine && a.intent ? (
                  <div className="rounded-lg border border-border bg-surface/90 px-3 py-2 text-[12px]" data-testid="lea-analysis">
                    <p className="flex flex-wrap items-center gap-1.5 font-medium">
                      <LeaMark size={16} /> LÉA a compris :
                      <Badge tone="primary">{INTENT_LABEL[a.intent]}</Badge>
                      {a.objection ? <Badge tone="warning">{OBJECTION_LABEL[a.objection]}</Badge> : null}
                      {a.requestedDiscountPct !== null && a.requestedDiscountPct !== undefined ? <Badge tone="danger">Remise demandée {a.requestedDiscountPct} %</Badge> : null}
                    </p>
                    <p className="mt-0.5 text-subtle">{a.summary}</p>
                    {a.injectionFlags?.length ? (
                      <p className="mt-1 flex items-center gap-1 text-danger">
                        <ShieldAlert className="size-3.5" /> Contenu suspect détecté : traité comme simple donnée, lecture humaine requise.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {writable ? (
        <div className="mt-4">
          <ReplyComposer
            conversationId={c.id}
            channel={c.channel}
            blockedReason={wa && !windowOpen ? "WhatsApp : plus de 24 h depuis le dernier message du client — seule LÉA peut écrire avec un modèle approuvé." : null}
          />
        </div>
      ) : null}

      {writable && env().DEMO_TOOLS && (wa ? c.contact_phone : c.contact_email) && messages.some((m) => m.direction === "outbound" && ["sent", "simulated_sent"].includes(m.status)) ? (
        <div className="mt-4">
          <SimulateReply conversationId={c.id} excelId={data.excelId} />
        </div>
      ) : null}
    </div>
  );
}
