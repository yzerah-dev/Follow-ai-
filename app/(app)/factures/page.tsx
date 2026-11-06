import Link from "next/link";
import { z } from "zod";
import { db } from "@/lib/auth/context";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState, Stat } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { SearchForm, Pagination, pageParam, strParam } from "@/components/app/list-controls";
import { PAYMENT_STATUS } from "@/components/app/labels";

export const metadata = { title: "Factures" };
const SIZE = 30;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = strParam(sp.q);
  const client = strParam(sp.client);
  const customerId = client && z.uuid().safeParse(client).success ? client : undefined;
  const page = pageParam(sp.page);
  const data = await db(async (d, ctx) => {
    const params: unknown[] = [ctx.org.organizationId];
    let where = "i.organization_id = $1";
    if (q) {
      params.push(`%${q.replace(/[%_\\]/g, "")}%`);
      where += ` and (i.invoice_number ilike $${params.length} or c.legal_name ilike $${params.length} or c.trade_name ilike $${params.length})`;
    }
    if (customerId) {
      params.push(customerId);
      where += ` and i.customer_id = $${params.length}`;
    }
    const totals = (await d.query<{ n: number; invoiced: string | null; credits: string | null; unpaid: string | null }>(
      `select count(*)::int n,
              sum(i.total_ht) filter (where i.doc_type = 'invoice' and i.status = 'issued' and i.invoice_date > current_date - 365) as invoiced,
              sum(i.total_ht) filter (where i.doc_type = 'credit_note' and i.status = 'issued' and i.invoice_date > current_date - 365) as credits,
              sum(i.total_ttc) filter (where i.doc_type = 'invoice' and i.status = 'issued' and i.payment_status in ('unpaid','overdue')) as unpaid
       from invoices i join customers c on c.id = i.customer_id where ${where}`, params)).rows[0]!;
    params.push(SIZE, (page - 1) * SIZE);
    const rows = (await d.query<{ id: string; invoice_number: string; invoice_date: string; customer_id: string; customer: string; doc_type: string; status: string; total_ht: string; total_ttc: string; payment_status: string; lines: number }>(
      `select i.id, i.invoice_number, i.invoice_date, i.customer_id, coalesce(c.trade_name, c.legal_name) as customer, i.doc_type, i.status, i.total_ht, i.total_ttc, i.payment_status,
              (select count(*)::int from invoice_lines l where l.invoice_id = i.id) as lines
       from invoices i join customers c on c.id = i.customer_id where ${where} order by i.invoice_date desc, i.invoice_number desc limit $${params.length - 1} offset $${params.length}`, params)).rows;
    return { rows, totals };
  });

  return (
    <>
      <PageHeader title="Factures" description="Facturation importée. Facturé ≠ encaissé : le statut de règlement est affiché séparément." />
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Facturé HT (12 mois)" value={formatMoney(data.totals.invoiced ?? "0", "EUR", { compact: true })} />
        <Stat label="Avoirs HT (12 mois)" value={formatMoney(data.totals.credits ?? "0", "EUR", { compact: true })} hint="Déduits de l'analyse commerciale" />
        <Stat label="Non réglé TTC" value={formatMoney(data.totals.unpaid ?? "0", "EUR", { compact: true })} hint="D'après le statut importé" tone="warning" />
      </div>
      <SearchForm q={q} placeholder="Numéro de facture ou client…">
        {customerId ? <input type="hidden" name="client" value={customerId} /> : null}
      </SearchForm>
      {data.rows.length === 0 ? (
        <EmptyState title="Aucune facture" description="Importez vos factures et leurs lignes depuis Paramètres → Imports." />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <TH>Numéro</TH>
                <TH>Date</TH>
                <TH>Client</TH>
                <TH>Type</TH>
                <TH className="text-right">Lignes</TH>
                <TH className="text-right">Total HT</TH>
                <TH className="text-right">Total TTC</TH>
                <TH>Règlement</TH>
              </tr>
            </THead>
            <TBody>
              {data.rows.map((i) => (
                <TR key={i.id} className={i.status === "cancelled" ? "opacity-50" : ""}>
                  <TD>
                    <Link href={`/factures/${i.id}`} className="font-medium hover:text-primary">
                      {i.invoice_number}
                    </Link>
                  </TD>
                  <TD className="text-subtle">{formatDate(i.invoice_date)}</TD>
                  <TD>
                    <Link href={`/clients/${i.customer_id}`} className="hover:text-primary">
                      {i.customer}
                    </Link>
                  </TD>
                  <TD>{i.status === "cancelled" ? <Badge>Annulée</Badge> : i.doc_type === "credit_note" ? <Badge tone="warning">Avoir</Badge> : <span className="text-subtle">Facture</span>}</TD>
                  <TD className="tabular text-right text-subtle">{i.lines}</TD>
                  <TD className="tabular text-right font-medium">{formatMoney(i.total_ht)}</TD>
                  <TD className="tabular text-right text-subtle">{formatMoney(i.total_ttc)}</TD>
                  <TD>
                    <Badge tone={PAYMENT_STATUS[i.payment_status]?.tone ?? "neutral"}>{PAYMENT_STATUS[i.payment_status]?.label}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      <Pagination page={page} pages={Math.max(1, Math.ceil(data.totals.n / SIZE))} total={data.totals.n} base="/factures" params={{ q, client: customerId }} />
    </>
  );
}
