import Link from "next/link";
import { db } from "@/lib/auth/context";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { SearchForm, strParam } from "@/components/app/list-controls";
import { OFFER_STATUS } from "@/components/app/labels";

export const metadata = { title: "Offres" };

export default async function OffersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = strParam(sp.q);
  const statusRaw = strParam(sp.statut);
  const status = statusRaw && statusRaw in OFFER_STATUS ? statusRaw : undefined;
  const rows = await db(async (d, ctx) => {
    const params: unknown[] = [ctx.org.organizationId];
    let where = "o.organization_id = $1";
    if (q) {
      params.push(`%${q.replace(/[%_\\]/g, "")}%`);
      where += ` and (o.number ilike $${params.length} or c.legal_name ilike $${params.length} or c.trade_name ilike $${params.length})`;
    }
    if (status) {
      params.push(status);
      where += ` and o.status = $${params.length}::offer_status`;
    }
    return (await d.query<{ id: string; number: string; offer_date: string; valid_until: string | null; status: string; total_ht: string; customer: string; customer_id: string; source: string; created_by_agent: boolean; lines: number; assets: number }>(
      `select o.id, o.number, o.offer_date, o.valid_until, o.status, o.total_ht, coalesce(c.trade_name, c.legal_name) as customer, o.customer_id, o.source, o.created_by_agent,
              (select count(*)::int from offer_lines l where l.offer_id = o.id) as lines,
              (select count(*)::int from generated_assets a where a.offer_id = o.id) as assets
       from offers o join customers c on c.id = o.customer_id where ${where} order by o.created_at desc limit 100`, params)).rows;
  });
  return (
    <>
      <PageHeader title="Offres" description="Préparées par LÉA ou par vous, toujours validées par un humain avant envoi." />
      <SearchForm q={q} placeholder="Numéro ou client…">
        <select name="statut" defaultValue={status ?? ""} className="h-9 rounded-md border border-border bg-surface px-2.5 text-sm shadow-card">
          <option value="">Tous les statuts</option>
          {Object.entries(OFFER_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </SearchForm>
      {rows.length === 0 ? (
        <EmptyState title="Aucune offre" description="Depuis l'accueil, LÉA prépare une offre en un clic à partir d'une opportunité détectée." />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <TH>Numéro</TH>
                <TH>Client</TH>
                <TH>Date</TH>
                <TH>Validité</TH>
                <TH>Statut</TH>
                <TH>Origine</TH>
                <TH className="text-right">Lignes</TH>
                <TH className="text-right">Total HT</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((o) => (
                <TR key={o.id}>
                  <TD>
                    <Link href={`/offres/${o.id}`} className="font-medium hover:text-primary">
                      {o.number}
                    </Link>
                    {o.assets ? <span className="block text-[11px] text-faint">{o.assets} document(s)</span> : null}
                  </TD>
                  <TD>
                    <Link href={`/clients/${o.customer_id}`} className="hover:text-primary">
                      {o.customer}
                    </Link>
                  </TD>
                  <TD className="text-subtle">{formatDate(o.offer_date)}</TD>
                  <TD className="text-subtle">{formatDate(o.valid_until)}</TD>
                  <TD>
                    <Badge tone={OFFER_STATUS[o.status]?.tone ?? "neutral"}>{OFFER_STATUS[o.status]?.label}</Badge>
                  </TD>
                  <TD className="text-subtle">{o.created_by_agent ? "LÉA" : "Manuelle"}</TD>
                  <TD className="tabular text-right text-subtle">{o.lines}</TD>
                  <TD className="tabular text-right font-medium">{formatMoney(o.total_ht)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
