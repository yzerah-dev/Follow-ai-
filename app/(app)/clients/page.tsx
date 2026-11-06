import Link from "next/link";
import { db } from "@/lib/auth/context";
import { listCustomers } from "@/features/customers/queries";
import { formatMoney } from "@/lib/money";
import { formatRelative } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { SearchForm, Pagination, pageParam, strParam } from "@/components/app/list-controls";
import { CUSTOMER_STATUS } from "@/components/app/labels";

export const metadata = { title: "Clients" };

const STATUSES = ["active", "dormant", "prospect", "lost", "blocked"];

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = strParam(sp.q);
  const statusRaw = strParam(sp.statut);
  const status = statusRaw && STATUSES.includes(statusRaw) ? statusRaw : undefined;
  const page = pageParam(sp.page);
  const data = await db((d, ctx) => listCustomers(d, ctx.org.organizationId, { q, status, page }));

  return (
    <>
      <PageHeader title="Clients" description="Votre portefeuille, trié par chiffre d'affaires des 12 derniers mois." />
      <SearchForm q={q} placeholder="Rechercher un client, un code, une ville…">
        <select name="statut" defaultValue={status ?? ""} className="h-9 rounded-md border border-border bg-surface px-2.5 text-sm shadow-card">
          <option value="">Tous les statuts</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {CUSTOMER_STATUS[s]!.label}
            </option>
          ))}
        </select>
      </SearchForm>
      {data.rows.length === 0 ? (
        <EmptyState title="Aucun client" description={q ? "Aucun résultat pour cette recherche." : "Importez votre fichier clients depuis Paramètres → Imports."} />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <TH>Client</TH>
                <TH>Ville</TH>
                <TH>Segment</TH>
                <TH>Statut</TH>
                <TH className="text-right">CA 12 mois HT</TH>
                <TH>Dernier achat</TH>
                <TH>Opportunités</TH>
                <TH>Commercial</TH>
              </tr>
            </THead>
            <TBody>
              {data.rows.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <Link href={`/clients/${c.id}`} className="font-medium hover:text-primary">
                      {c.name}
                    </Link>
                    <span className="block text-[11.5px] text-faint">{c.external_code}</span>
                  </TD>
                  <TD className="text-subtle">{c.city}</TD>
                  <TD className="text-subtle">{c.segment}</TD>
                  <TD>
                    <Badge tone={CUSTOMER_STATUS[c.status]?.tone ?? "neutral"}>{CUSTOMER_STATUS[c.status]?.label ?? c.status}</Badge>
                  </TD>
                  <TD className="tabular text-right font-medium">{formatMoney(c.revenue_12m ?? "0")}</TD>
                  <TD className="text-subtle">{formatRelative(c.last_purchase)}</TD>
                  <TD>{c.open_opps ? <Badge tone="primary">{c.open_opps}</Badge> : <span className="text-faint">—</span>}</TD>
                  <TD className="text-subtle">{c.owner ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      <Pagination page={data.page} pages={data.pages} total={data.total} base="/clients" params={{ q, statut: status }} />
    </>
  );
}
