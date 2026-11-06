import Link from "next/link";
import { db } from "@/lib/auth/context";
import { formatMoney, formatQty } from "@/lib/money";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { SearchForm, Pagination, pageParam, strParam } from "@/components/app/list-controls";
import { AVAILABILITY } from "@/components/app/labels";

export const metadata = { title: "Produits" };
const SIZE = 30;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = strParam(sp.q);
  const category = strParam(sp.categorie);
  const page = pageParam(sp.page);
  const data = await db(async (d, ctx) => {
    const params: unknown[] = [ctx.org.organizationId];
    let where = "p.organization_id = $1";
    if (q) {
      params.push(`%${q.replace(/[%_\\]/g, "")}%`);
      where += ` and (p.name ilike $${params.length} or p.reference ilike $${params.length} or p.ean ilike $${params.length} or p.brand ilike $${params.length})`;
    }
    if (category) {
      params.push(category);
      where += ` and p.category = $${params.length}`;
    }
    const categories = (await d.query<{ category: string }>(`select distinct category from products where organization_id = $1 and category is not null order by 1`, [ctx.org.organizationId])).rows.map((r) => r.category);
    const n = (await d.query<{ n: number }>(`select count(*)::int n from products p where ${where}`, params)).rows[0]!.n;
    params.push(SIZE, (page - 1) * SIZE);
    const rows = (await d.query<{ id: string; reference: string; ean: string | null; brand: string | null; name: string; category: string | null; sale_price_ht: string | null; units_per_case: number | null; availability: string; is_new: boolean; qty_available: string | null; image_id: string | null }>(
      `select p.id, p.reference, p.ean, p.brand, p.name, p.category, p.sale_price_ht, p.units_per_case, p.availability, p.is_new,
              (select s.qty_available from inventory_snapshots s where s.product_id = p.id order by s.captured_at desc limit 1) as qty_available,
              (select i.id from product_images i where i.product_id = p.id and i.approved order by i.is_primary desc limit 1) as image_id
       from products p where ${where} order by p.is_new desc, p.reference limit $${params.length - 1} offset $${params.length}`, params)).rows;
    return { rows, n, categories };
  });

  return (
    <>
      <PageHeader title="Produits" description="Catalogue, tarifs et disponibilités connues. Une information absente reste inconnue." />
      <SearchForm q={q} placeholder="Nom, référence, EAN, marque…">
        <select name="categorie" defaultValue={category ?? ""} className="h-9 rounded-md border border-border bg-surface px-2.5 text-sm shadow-card">
          <option value="">Toutes les catégories</option>
          {data.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </SearchForm>
      {data.rows.length === 0 ? (
        <EmptyState title="Aucun produit" description="Importez votre catalogue depuis Paramètres → Imports." />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <TH className="w-12" />
                <TH>Produit</TH>
                <TH>Catégorie</TH>
                <TH className="text-right">Prix HT</TH>
                <TH className="text-right">Colisage</TH>
                <TH className="text-right">Stock dispo.</TH>
                <TH>Disponibilité</TH>
              </tr>
            </THead>
            <TBody>
              {data.rows.map((p) => (
                <TR key={p.id}>
                  <TD>
                    {p.image_id ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/product-images/${p.image_id}`} alt="" className="h-9 w-9 rounded-md border border-border object-cover" />
                    ) : (
                      <div className="h-9 w-9 rounded-md border border-dashed border-border bg-muted" title="Photo non disponible" />
                    )}
                  </TD>
                  <TD>
                    <Link href={`/produits/${p.id}`} className="font-medium hover:text-primary">
                      {p.name}
                    </Link>
                    {p.is_new ? <Badge tone="primary" className="ml-2">Nouveauté</Badge> : null}
                    <span className="block text-[11.5px] text-faint">
                      {p.reference}
                      {p.ean ? ` · EAN ${p.ean}` : ""}
                      {p.brand ? ` · ${p.brand}` : ""}
                    </span>
                  </TD>
                  <TD className="text-subtle">{p.category}</TD>
                  <TD className="tabular text-right font-medium">{p.sale_price_ht ? formatMoney(p.sale_price_ht) : <span className="text-faint">Inconnu</span>}</TD>
                  <TD className="tabular text-right text-subtle">{p.units_per_case ?? "—"}</TD>
                  <TD className="tabular text-right text-subtle">{p.qty_available !== null ? formatQty(p.qty_available) : "—"}</TD>
                  <TD>
                    <Badge tone={AVAILABILITY[p.availability]?.tone ?? "neutral"}>{AVAILABILITY[p.availability]?.label}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      <Pagination page={page} pages={Math.max(1, Math.ceil(data.n / SIZE))} total={data.n} base="/produits" params={{ q, categorie: category }} />
    </>
  );
}
