import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/auth/context";
import { formatMoney, formatQty, dec } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KeyValue, PageHeader } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PAYMENT_STATUS } from "@/components/app/labels";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await db(async (d, ctx) => {
    const inv = (await d.query<{ id: string; invoice_number: string; invoice_date: string; customer_id: string; customer: string; doc_type: string; status: string; currency: string; total_ht: string; total_vat: string; total_ttc: string; payment_status: string; external_ref: string | null; related: string | null; related_id: string | null }>(
      `select i.*, coalesce(c.trade_name, c.legal_name) as customer, r.invoice_number as related, r.id as related_id
       from invoices i join customers c on c.id = i.customer_id left join invoices r on r.id = i.related_invoice_id where i.id = $1 and i.organization_id = $2`, [id, ctx.org.organizationId])).rows[0];
    if (!inv) return null;
    const lines = (await d.query<{ id: string; line_no: number; product_id: string | null; product_reference: string | null; ean: string | null; description: string; quantity: string; unit: string; unit_price_ht: string; discount_pct: string; vat_rate: string; line_total_ht: string; units_per_case: number | null }>(
      `select * from invoice_lines where invoice_id = $1 order by line_no`, [id])).rows;
    return { inv, lines };
  });
  if (!data) notFound();
  const { inv, lines } = data;
  return (
    <>
      <Link href="/factures" className="text-[12.5px] text-faint hover:text-subtle">← Factures</Link>
      <PageHeader title={`${inv.doc_type === "credit_note" ? "Avoir" : "Facture"} ${inv.invoice_number}`} description={<Link href={`/clients/${inv.customer_id}`} className="hover:text-primary">{inv.customer}</Link>}>
        <div className="mt-2 flex gap-2">
          {inv.status === "cancelled" ? <Badge tone="danger">Annulée — exclue des analyses</Badge> : null}
          <Badge tone={PAYMENT_STATUS[inv.payment_status]?.tone ?? "neutral"}>Règlement : {PAYMENT_STATUS[inv.payment_status]?.label}</Badge>
        </div>
      </PageHeader>
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <Card>
          <Table>
            <THead>
              <tr>
                <TH>#</TH>
                <TH>Référence</TH>
                <TH>Désignation</TH>
                <TH className="text-right">Qté</TH>
                <TH className="text-right">PU HT</TH>
                <TH className="text-right">Rem.</TH>
                <TH className="text-right">TVA</TH>
                <TH className="text-right">Total HT</TH>
              </tr>
            </THead>
            <TBody>
              {lines.map((l) => (
                <TR key={l.id}>
                  <TD className="text-faint">{l.line_no}</TD>
                  <TD>
                    {l.product_id ? <Link href={`/produits/${l.product_id}`} className="font-medium hover:text-primary">{l.product_reference}</Link> : <span>{l.product_reference ?? "—"}</span>}
                    {l.ean ? <span className="block text-[11px] text-faint">EAN {l.ean}</span> : null}
                  </TD>
                  <TD>{l.description}</TD>
                  <TD className="tabular text-right">{formatQty(l.quantity)} {l.unit}</TD>
                  <TD className="tabular text-right">{formatMoney(dec(l.unit_price_ht).toDecimalPlaces(2))}</TD>
                  <TD className="tabular text-right text-subtle">{dec(l.discount_pct).gt(0) ? `${dec(l.discount_pct).toFixed(2)} %` : "—"}</TD>
                  <TD className="tabular text-right text-subtle">{dec(l.vat_rate).toFixed(2)} %</TD>
                  <TD className="tabular text-right font-medium">{formatMoney(l.line_total_ht)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <KeyValue label="Date">{formatDate(inv.invoice_date)}</KeyValue>
            <KeyValue label="Devise">{inv.currency}</KeyValue>
            {inv.related_id ? <KeyValue label="Facture d'origine"><Link className="text-primary" href={`/factures/${inv.related_id}`}>{inv.related}</Link></KeyValue> : null}
            <KeyValue label="Référence externe">{inv.external_ref}</KeyValue>
            <div className="my-2 border-t border-border" />
            <KeyValue label="Total HT">{formatMoney(inv.total_ht)}</KeyValue>
            <KeyValue label="TVA">{formatMoney(inv.total_vat)}</KeyValue>
            <KeyValue label="Total TTC">{formatMoney(inv.total_ttc)}</KeyValue>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
