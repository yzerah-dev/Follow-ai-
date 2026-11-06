import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { z } from "zod";
import { db } from "@/lib/auth/context";
import { canManage } from "@/lib/auth/roles";
import { formatMoney, formatQty, dec } from "@/lib/money";
import { formatDate, formatRelative } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KeyValue } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { AVAILABILITY } from "@/components/app/labels";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { data, role } = await db(async (d, ctx) => {
    const p = (await d.query<{ id: string; reference: string; ean: string | null; brand: string | null; name: string; description: string | null; category: string | null; units_per_case: number | null; pcb: number | null; sale_price_ht: string | null; vat_rate: string; availability: string; available_from: string | null; min_order_qty: number | null; marketing_points: string[]; weight_kg: string | null; is_new: boolean; launched_at: string | null }>(
      `select * from products where id = $1 and organization_id = $2`, [id, ctx.org.organizationId])).rows[0];
    if (!p) return { data: null, role: ctx.org.role };
    // RLS : renvoie une ligne uniquement pour owner/admin/manager
    const cost = (await d.query<{ purchase_price_ht: string }>(`select purchase_price_ht from product_purchase_costs where product_id = $1`, [id])).rows[0] ?? null;
    const images = (await d.query<{ id: string; kind: string; alt: string | null }>(`select id, kind, alt from product_images where product_id = $1 and approved order by is_primary desc`, [id])).rows;
    const stock = (await d.query<{ qty_on_hand: string; qty_available: string | null; captured_at: string; source: string }>(`select qty_on_hand, qty_available, captured_at, source from inventory_snapshots where product_id = $1 order by captured_at desc limit 1`, [id])).rows[0] ?? null;
    const prices = (await d.query<{ id: string; customer: string | null; customer_id: string | null; unit_price_ht: string; min_qty: number; valid_from: string | null; valid_to: string | null }>(
      `select pp.id, coalesce(c.trade_name, c.legal_name) as customer, pp.customer_id, pp.unit_price_ht, pp.min_qty, pp.valid_from, pp.valid_to
       from product_prices pp left join customers c on c.id = pp.customer_id where pp.product_id = $1 order by pp.customer_id nulls first limit 20`, [id])).rows;
    const buyers = (await d.query<{ customer_id: string; customer: string; qty: string; last: string; orders: number }>(
      `select i.customer_id, coalesce(c.trade_name, c.legal_name) as customer, sum(l.quantity) as qty, max(i.invoice_date) as last, count(distinct i.id)::int as orders
       from invoice_lines l join invoices i on i.id = l.invoice_id join customers c on c.id = i.customer_id
       where l.product_id = $1 and i.status = 'issued' and i.doc_type = 'invoice' group by 1, 2 order by sum(l.line_total_ht) desc limit 10`, [id])).rows;
    return { data: { p, cost, images, stock, prices, buyers }, role: ctx.org.role };
  });
  if (!data) notFound();
  const { p } = data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/produits" className="text-[12.5px] text-faint hover:text-subtle">← Produits</Link>
          <div className="mt-1 flex items-center gap-2.5">
            <h1 className="text-[24px] font-semibold tracking-tight">{p.name}</h1>
            {p.is_new ? <Badge tone="primary">Nouveauté</Badge> : null}
            <Badge tone={AVAILABILITY[p.availability]?.tone ?? "neutral"}>{AVAILABILITY[p.availability]?.label}</Badge>
          </div>
          <p className="mt-1 text-[13px] text-subtle">
            {p.reference} {p.ean ? `· EAN ${p.ean}` : ""} {p.brand ? `· ${p.brand}` : ""}
          </p>
        </div>
        <Button asChild variant="secondary">
          <a href={`/api/products/${p.id}/sheet`}>
            <FileDown /> Fiche produit PDF
          </a>
        </Button>
      </div>
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <div className="space-y-5">
          <Card className="overflow-hidden">
            {data.images[0] ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/product-images/${data.images[0].id}`} alt={data.images[0].alt ?? ""} className="aspect-square w-full object-cover" />
                {data.images[0].kind === "demo_placeholder" ? <p className="px-4 py-2 text-[11.5px] text-warning">Visuel de démonstration (pas une photo réelle du produit)</p> : null}
              </>
            ) : (
              <div className="flex aspect-square items-center justify-center bg-muted text-[13px] text-faint">Photo non disponible</div>
            )}
          </Card>
          <Card>
            <CardContent className="pt-4">
              <KeyValue label="Prix de vente HT">{p.sale_price_ht ? formatMoney(p.sale_price_ht) : null}</KeyValue>
              <KeyValue label="TVA">{dec(p.vat_rate).toFixed(2)} %</KeyValue>
              {canManage(role) ? <KeyValue label="Prix d'achat HT (interne)">{data.cost ? formatMoney(data.cost.purchase_price_ht) : null}</KeyValue> : null}
              <KeyValue label="Colisage">{p.units_per_case ? `${p.units_per_case} u.` : null}</KeyValue>
              <KeyValue label="PCB">{p.pcb}</KeyValue>
              <KeyValue label="Minimum de commande">{p.min_order_qty}</KeyValue>
              <KeyValue label="Poids">{p.weight_kg ? `${dec(p.weight_kg).toFixed(2)} kg` : null}</KeyValue>
              <KeyValue label="Catégorie">{p.category}</KeyValue>
              <KeyValue label="Disponible le">{p.available_from ? formatDate(p.available_from) : null}</KeyValue>
              <div className="my-2 border-t border-border" />
              <KeyValue label="Stock disponible">{data.stock ? `${formatQty(data.stock.qty_available ?? data.stock.qty_on_hand)} (relevé ${formatRelative(data.stock.captured_at)})` : null}</KeyValue>
            </CardContent>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Description & arguments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-[13.5px]">
              <p className="text-subtle">{p.description ?? "Aucune description."}</p>
              {p.marketing_points.length ? (
                <ul className="list-inside list-disc space-y-1">
                  {p.marketing_points.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-faint">Aucun argument marketing renseigné.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tarifs</CardTitle>
            </CardHeader>
            <Table>
              <THead>
                <tr>
                  <TH>Liste</TH>
                  <TH className="text-right">PU HT</TH>
                  <TH className="text-right">Qté min.</TH>
                  <TH>Validité</TH>
                </tr>
              </THead>
              <TBody>
                {data.prices.length === 0 ? (
                  <TR>
                    <TD colSpan={4} className="text-subtle">Aucun tarif spécifique : le prix catalogue s&apos;applique.</TD>
                  </TR>
                ) : null}
                {data.prices.map((pr) => (
                  <TR key={pr.id}>
                    <TD>{pr.customer_id ? <Link href={`/clients/${pr.customer_id}`} className="hover:text-primary">Tarif client — {pr.customer}</Link> : "Liste générale"}</TD>
                    <TD className="tabular text-right">{formatMoney(dec(pr.unit_price_ht).toDecimalPlaces(2))}</TD>
                    <TD className="tabular text-right">{pr.min_qty}</TD>
                    <TD className="text-subtle">{pr.valid_from ? formatDate(pr.valid_from) : "—"} → {pr.valid_to ? formatDate(pr.valid_to) : "sans fin"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Principaux clients</CardTitle>
            </CardHeader>
            <Table>
              <THead>
                <tr>
                  <TH>Client</TH>
                  <TH className="text-right">Commandes</TH>
                  <TH className="text-right">Quantité</TH>
                  <TH>Dernier achat</TH>
                </tr>
              </THead>
              <TBody>
                {data.buyers.map((b) => (
                  <TR key={b.customer_id}>
                    <TD><Link href={`/clients/${b.customer_id}`} className="font-medium hover:text-primary">{b.customer}</Link></TD>
                    <TD className="tabular text-right">{b.orders}</TD>
                    <TD className="tabular text-right">{formatQty(b.qty)}</TD>
                    <TD className="text-subtle">{formatRelative(b.last)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </div>
      </div>
    </div>
  );
}
