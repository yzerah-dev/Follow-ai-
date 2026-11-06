import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Mail, CheckCircle2, PackageCheck } from "lucide-react";
import { z } from "zod";
import { db } from "@/lib/auth/context";
import { canWrite } from "@/lib/auth/roles";
import { formatMoney, formatQty, dec } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KeyValue, LeaMark } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ActionButton } from "@/components/app/action-button";
import { CreativePanel, type AssetView } from "@/components/app/creative-panel";
import { OFFER_STATUS } from "@/components/app/labels";
import { PRICE_SOURCE_LABEL } from "@/features/offers/pricing";
import { acceptOfferAction, decideOfferAction, draftEmailAction, markOfferLostAction } from "@/app/actions/commercial";

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { data, role } = await db(async (d, ctx) => {
    const o = (await d.query<{ id: string; number: string; customer_id: string; customer: string; offer_date: string; valid_until: string | null; status: string; source: string; conditions: string | null; subtotal_ht: string; discount_total_ht: string; total_ht: string; total_vat: string; total_ttc: string; warnings: { code: string; message: string }[]; arguments: string[]; created_by_agent: boolean; owner: string | null; contact: string | null; contact_email: string | null; opportunity_id: string | null; sent_at: string | null; outcome: string | null }>(
      `select o.*, coalesce(c.trade_name, c.legal_name) as customer, m.display_name as owner,
              nullif(trim(concat_ws(' ', ct.salutation, ct.first_name, ct.last_name)), '') as contact, ct.email as contact_email
       from offers o join customers c on c.id = o.customer_id left join contacts ct on ct.id = o.contact_id
       left join organization_members m on m.organization_id = o.organization_id and m.user_id = o.owner_user_id
       where o.id = $1 and o.organization_id = $2`, [id, ctx.org.organizationId])).rows[0];
    if (!o) return { data: null, role: ctx.org.role };
    const lines = (await d.query<{ id: string; line_no: number; product_id: string; reference: string; ean: string | null; description: string; quantity: string; unit_price_ht: string; price_source: keyof typeof PRICE_SOURCE_LABEL; discount_pct: string; vat_rate: string; line_total_ht: string; rationale: string | null; units_per_case: number | null }>(
      `select l.*, p.reference, p.ean, p.units_per_case from offer_lines l join products p on p.id = l.product_id where l.offer_id = $1 order by l.line_no`, [id])).rows;
    const assets = (await d.query<{ id: string; kind: string; filename: string; mime_type: string; validation_status: AssetView["status"]; validation_report: AssetView["report"]; created_at: string }>(
      `select id, kind, filename, mime_type, validation_status, validation_report, created_at from generated_assets where offer_id = $1 order by created_at desc`, [id])).rows;
    const conversation = (await d.query<{ id: string; messages: number }>(`select c.id, (select count(*)::int from messages m where m.conversation_id = c.id) as messages from conversations c where c.offer_id = $1 limit 1`, [id])).rows[0] ?? null;
    const order = (await d.query<{ id: string; number: string; status: string; total_ht: string; created_at: string }>(`select id, number, status, total_ht, created_at from order_requests where offer_id = $1`, [id])).rows[0] ?? null;
    const approval = (await d.query<{ status: string; decided_at: string | null; decided_by_name: string | null }>(
      `select a.status, a.decided_at, m.display_name as decided_by_name from approvals a left join organization_members m on m.organization_id = a.organization_id and m.user_id = a.decided_by
       where a.subject_type = 'offer' and a.subject_id = $1 order by a.created_at desc limit 1`, [id])).rows[0] ?? null;
    return { data: { o, lines, assets, conversation, order, approval }, role: ctx.org.role };
  });
  if (!data) notFound();
  const { o, lines } = data;
  const writable = canWrite(role);
  const st = OFFER_STATUS[o.status];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/offres" className="text-[12.5px] text-faint hover:text-subtle">← Offres</Link>
          <div className="mt-1 flex items-center gap-2.5">
            <h1 className="text-[24px] font-semibold tracking-tight">Offre {o.number}</h1>
            <Badge tone={st?.tone ?? "neutral"}>{st?.label}</Badge>
            {o.created_by_agent ? <Badge tone="primary">Préparée par LÉA</Badge> : null}
          </div>
          <p className="mt-1 text-[13px] text-subtle">
            <Link href={`/clients/${o.customer_id}`} className="font-medium text-foreground hover:text-primary">{o.customer}</Link> · {o.contact ?? "Contact non défini"} · émise le {formatDate(o.offer_date)}, valable jusqu&apos;au {formatDate(o.valid_until)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {writable && o.status === "pending_approval" ? (
            <>
              <ActionButton variant="secondary" action={decideOfferAction.bind(null, o.id, "rejected")}>Renvoyer en brouillon</ActionButton>
              <ActionButton variant="success" action={decideOfferAction.bind(null, o.id, "approved")} pendingLabel="Validation…">
                <CheckCircle2 /> Valider l&apos;offre
              </ActionButton>
            </>
          ) : null}
          {writable && o.status === "approved" && !data.conversation ? (
            <ActionButton variant="lea" action={draftEmailAction.bind(null, o.id)} pendingLabel="LÉA rédige l'email…">
              <Mail /> Rédiger l&apos;email avec LÉA
            </ActionButton>
          ) : null}
          {data.conversation ? (
            <Button asChild variant="secondary">
              <Link href={`/conversations/${data.conversation.id}`}>
                <Mail /> Conversation ({data.conversation.messages})
              </Link>
            </Button>
          ) : null}
          {writable && ["sent", "negotiation"].includes(o.status) ? (
            <>
              <ActionButton variant="danger" action={markOfferLostAction.bind(null, o.id, "Refus client")} confirm="Marquer cette offre comme perdue ?">Perdue</ActionButton>
              <ActionButton variant="success" action={acceptOfferAction.bind(null, o.id)} pendingLabel="Préparation…">
                <PackageCheck /> Client d&apos;accord : préparer la commande
              </ActionButton>
            </>
          ) : null}
        </div>
      </div>

      {data.order ? (
        <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success-soft px-5 py-3.5 text-[13.5px]">
          <PackageCheck className="size-5 text-success" />
          <span>
            Demande de commande <strong>{data.order.number}</strong> préparée ({formatMoney(data.order.total_ht)} HT) — statut : brouillon, à transmettre à l&apos;ERP. Ce n&apos;est ni une facture ni un encaissement.
          </span>
        </div>
      ) : null}

      {o.warnings?.length ? (
        <div className="rounded-lg border border-warning/30 bg-warning-soft px-5 py-3.5">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-warning">
            <AlertTriangle className="size-4" /> Points d&apos;attention relevés par le moteur d&apos;offres
          </p>
          <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[13px] text-warning">
            {o.warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card>
            <Table>
              <THead>
                <tr>
                  <TH>Produit</TH>
                  <TH className="text-right">Quantité</TH>
                  <TH className="text-right">PU HT</TH>
                  <TH className="text-right">Remise</TH>
                  <TH className="text-right">Total HT</TH>
                </tr>
              </THead>
              <TBody>
                {lines.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      <Link href={`/produits/${l.product_id}`} className="font-medium hover:text-primary">{l.description}</Link>
                      <span className="block text-[11.5px] text-faint">
                        {l.reference}
                        {l.ean ? ` · EAN ${l.ean}` : ""} · {PRICE_SOURCE_LABEL[l.price_source]}
                        {l.units_per_case ? ` · colis de ${l.units_per_case}` : ""}
                      </span>
                      {l.rationale ? <span className="mt-0.5 block text-[11.5px] text-subtle">{l.rationale}</span> : null}
                    </TD>
                    <TD className="tabular text-right">{formatQty(l.quantity)}</TD>
                    <TD className="tabular text-right">{formatMoney(dec(l.unit_price_ht).toDecimalPlaces(2))}</TD>
                    <TD className="tabular text-right text-subtle">{dec(l.discount_pct).gt(0) ? `${dec(l.discount_pct).toFixed(2)} %` : "—"}</TD>
                    <TD className="tabular text-right font-medium">{formatMoney(l.line_total_ht)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LeaMark size={20} /> Studio créatif — supports commerciaux
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CreativePanel
                offerId={o.id}
                writable={writable}
                assets={data.assets.map((a) => ({ id: a.id, kind: a.kind, filename: a.filename, mime: a.mime_type, status: a.validation_status, report: a.validation_report ?? {}, createdAt: a.created_at }))}
              />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardContent className="pt-4">
              <KeyValue label="Sous-total HT">{formatMoney(o.subtotal_ht)}</KeyValue>
              {dec(o.discount_total_ht).gt(0) ? <KeyValue label="Remises">− {formatMoney(o.discount_total_ht)}</KeyValue> : null}
              <KeyValue label="Total HT">{formatMoney(o.total_ht)}</KeyValue>
              <KeyValue label="TVA">{formatMoney(o.total_vat)}</KeyValue>
              <div className="mt-2 flex items-center justify-between rounded-md bg-muted px-3 py-2">
                <span className="text-[13px] font-medium">Total TTC</span>
                <span className="tabular text-[17px] font-semibold">{formatMoney(o.total_ttc)}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Suivi</CardTitle>
            </CardHeader>
            <CardContent>
              <KeyValue label="Commercial">{o.owner}</KeyValue>
              <KeyValue label="Destinataire">{o.contact_email}</KeyValue>
              <KeyValue label="Validation">{data.approval ? (data.approval.status === "pending" ? "En attente" : `${data.approval.status === "approved" ? "Validée" : "Refusée"} par ${data.approval.decided_by_name ?? "—"}`) : null}</KeyValue>
              <KeyValue label="Envoyée">{o.sent_at ? formatDate(o.sent_at) : null}</KeyValue>
              <KeyValue label="Résultat">{o.outcome === "won" ? "Gagnée" : o.outcome === "lost" ? "Perdue" : null}</KeyValue>
            </CardContent>
          </Card>
          {o.arguments?.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Pourquoi cette offre</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-[13px] text-subtle">
                {o.arguments.map((a, i) => (
                  <p key={i}>{a}</p>
                ))}
              </CardContent>
            </Card>
          ) : null}
          {o.conditions ? (
            <Card>
              <CardHeader>
                <CardTitle>Conditions</CardTitle>
              </CardHeader>
              <CardContent className="text-[13px] text-subtle">{o.conditions}</CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
