import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { z } from "zod";
import { db } from "@/lib/auth/context";
import { canWrite } from "@/lib/auth/roles";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LeaMark } from "@/components/ui/misc";
import { MessageApproval, SimulateReply } from "@/components/app/message-approval";
import { MESSAGE_STATUS } from "@/components/app/labels";
import { INTENT_LABEL, OBJECTION_LABEL, type Intent, type Objection } from "@/features/agent/schemas";

type Analysis = {
  intent?: Intent;
  objection?: Objection | null;
  requestedDiscountPct?: number | null;
  requestedQuantity?: string | null;
  targetPrice?: string | null;
  summary?: string;
  nextAction?: string;
  injectionFlags?: string[];
  simulatedAi?: boolean;
  personalizationBasis?: string;
  rationale?: string;
  decisionText?: string;
  escalate?: boolean;
  discountPct?: number | null;
  guardNotes?: string[];
};

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { data, role } = await db(async (d, ctx) => {
    const c = (await d.query<{ id: string; channel: string; subject: string | null; status: string; customer: string | null; customer_id: string | null; contact: string | null; contact_email: string | null; offer_id: string | null; offer_number: string | null; identity_confidence: string; next_action: string | null }>(
      `select c.id, c.channel, c.subject, c.status, coalesce(cu.trade_name, cu.legal_name) as customer, c.customer_id, c.identity_confidence, c.next_action,
              nullif(trim(concat_ws(' ', ct.salutation, ct.first_name, ct.last_name)), '') as contact, ct.email as contact_email, c.offer_id, o.number as offer_number
       from conversations c left join customers cu on cu.id = c.customer_id left join contacts ct on ct.id = c.contact_id left join offers o on o.id = c.offer_id
       where c.id = $1 and c.organization_id = $2`, [id, ctx.org.organizationId])).rows[0];
    if (!c) return { data: null, role: ctx.org.role };
    const messages = (await d.query<{ id: string; direction: "inbound" | "outbound"; from_address: string | null; to_address: string | null; subject: string | null; body: string; status: string; ai_generated: boolean; ai_analysis: Analysis | null; attachments: { filename: string }[]; created_at: string; sent_at: string | null; received_at: string | null; sent_autonomously: boolean; scheduled_at: string | null }>(
      `select id, direction, from_address, to_address, subject, body, status, ai_generated, ai_analysis, attachments, created_at, sent_at, received_at, sent_autonomously, scheduled_at from messages where conversation_id = $1 order by created_at`, [id])).rows;
    const simulatedChannel = !(await d.query(`select 1 from communication_connections where organization_id = $1 and channel = 'email' and status = 'connected'`, [ctx.org.organizationId])).rowCount;
    return { data: { c, messages, simulatedChannel }, role: ctx.org.role };
  });
  if (!data) notFound();
  const { c, messages } = data;
  const writable = canWrite(role);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/conversations" className="text-[12.5px] text-faint hover:text-subtle">← Conversations</Link>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight">{c.subject ?? "Sans objet"}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-subtle">
          {c.customer_id ? <Link href={`/clients/${c.customer_id}`} className="font-medium text-foreground hover:text-primary">{c.customer}</Link> : <span>Expéditeur non identifié</span>}
          {c.contact ? <span>· {c.contact} ({c.contact_email})</span> : null}
          <Badge tone="outline">{c.channel}</Badge>
          {c.identity_confidence !== "verified" ? <Badge tone="warning">Identité {c.identity_confidence === "probable" ? "probable — à confirmer" : "inconnue"}</Badge> : null}
          {c.offer_id ? <Link href={`/offres/${c.offer_id}`} className="text-primary hover:underline">Offre {c.offer_number}</Link> : null}
        </p>
        {c.next_action ? <p className="mt-2 text-[13px]"><span className="font-medium">Prochaine action :</span> {c.next_action}</p> : null}
      </div>

      <div className="space-y-4">
        {messages.map((m) => {
          const a = m.ai_analysis ?? {};
          const st = MESSAGE_STATUS[m.status];
          return (
            <Card key={m.id} className={m.direction === "inbound" ? "border-primary/20" : ""} data-testid={`message-${m.direction}`}>
              <CardContent className="space-y-3 pt-4">
                <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  {m.direction === "outbound" && m.ai_generated ? <LeaMark size={20} /> : null}
                  <span className="font-semibold">{m.direction === "inbound" ? m.from_address : m.ai_generated ? (m.status === "pending_approval" || m.status === "draft" ? "LÉA (brouillon)" : "LÉA") : "Vous"}</span>
                  <span className="text-faint">→ {m.direction === "inbound" ? "nous" : m.to_address ?? "destinataire manquant"}</span>
                  <Badge tone={st?.tone ?? "neutral"}>{st?.label}</Badge>
                  {m.sent_autonomously ? <Badge tone="success">Envoyé seul par LÉA</Badge> : null}
                  {m.status === "approved" && m.scheduled_at ? <Badge tone="info">Programmé le {formatDate(m.scheduled_at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</Badge> : null}
                  {a.simulatedAi ? <Badge tone="warning">IA simulée</Badge> : null}
                  <span className="ml-auto text-faint">{formatDate(m.sent_at ?? m.received_at ?? m.created_at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                {m.status === "pending_approval" ? (
                  <>
                    {a.rationale || a.decisionText || a.personalizationBasis ? (
                      <div className="rounded-md bg-primary-soft/60 px-3 py-2 text-[12.5px] text-primary">
                        {a.personalizationBasis ? <p>Personnalisation : {a.personalizationBasis === "purchase_history" ? "basée sur l'historique d'achat" : "générique (historique insuffisant)"}</p> : null}
                        {a.rationale ? <p>{a.rationale}</p> : null}
                        {a.decisionText ? <p>Politique commerciale : {a.decisionText}</p> : null}
                        {a.escalate ? <p className="font-semibold">Dossier transféré au commercial responsable.</p> : null}
                        {a.guardNotes?.length ? <p>Garde-fous appliqués : {a.guardNotes.join(" ; ")}</p> : null}
                      </div>
                    ) : null}
                    <MessageApproval messageId={m.id} conversationId={c.id} subject={m.subject ?? ""} body={m.body} writable={writable} simulatedChannel={data.simulatedChannel} />
                  </>
                ) : (
                  <>
                    {m.subject ? <p className="text-[13px] font-medium">{m.subject}</p> : null}
                    <p className="whitespace-pre-line text-[13.5px] leading-relaxed">{m.body}</p>
                    {m.attachments?.length ? <p className="text-[12px] text-faint">Pièces jointes : {m.attachments.map((x) => x.filename).join(", ")}</p> : null}
                  </>
                )}
                {m.direction === "inbound" && a.intent ? (
                  <div className="rounded-md border border-border bg-muted/60 px-3 py-2.5 text-[12.5px]" data-testid="lea-analysis">
                    <p className="flex flex-wrap items-center gap-1.5 font-medium">
                      <LeaMark size={16} /> Analyse de LÉA :
                      <Badge tone="primary">{INTENT_LABEL[a.intent]}</Badge>
                      {a.objection ? <Badge tone="warning">{OBJECTION_LABEL[a.objection]}</Badge> : null}
                      {a.requestedDiscountPct !== null && a.requestedDiscountPct !== undefined ? <Badge tone="danger">Remise demandée {a.requestedDiscountPct} %</Badge> : null}
                    </p>
                    <p className="mt-1 text-subtle">{a.summary}</p>
                    {a.injectionFlags?.length ? (
                      <p className="mt-1 flex items-center gap-1 text-danger">
                        <ShieldAlert className="size-3.5" /> Contenu suspect détecté (tentative d&apos;instruction) : traité comme simple donnée.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {writable && env().DEMO_TOOLS && c.contact_email && messages.some((m) => m.direction === "outbound" && ["sent", "simulated_sent"].includes(m.status)) ? <SimulateReply conversationId={c.id} /> : null}
    </div>
  );
}
