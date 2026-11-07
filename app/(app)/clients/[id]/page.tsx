import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail, Phone, Globe, MapPin } from "lucide-react";
import { z } from "zod";
import { db } from "@/lib/auth/context";
import { getCustomer } from "@/features/customers/queries";
import { formatMoney, formatQty, dec } from "@/lib/money";
import { formatDate, formatRelative, toIsoDate } from "@/lib/utils";
import { canWrite } from "@/lib/auth/roles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KeyValue, LeaMark, Stat } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ActionButton } from "@/components/app/action-button";
import { AVAILABILITY, CUSTOMER_STATUS, OFFER_STATUS, OPPORTUNITY_LABEL, PAYMENT_STATUS } from "@/components/app/labels";
import { createOfferFromOpportunityAction } from "@/app/actions/commercial";
import { OfferBuilderForm } from "@/components/app/offer-builder-form";
import { GrowthSection } from "./growth-section";
import { CoverageSection } from "./coverage-section";
import { ObjectivesSection } from "./objectives-section";
import { loadCustomerObjectives } from "@/features/targets/repo";
import { loadCustomerCoverage } from "@/features/analytics/coverage-repo";

const CERTAINTY: Record<string, { label: string; tone: "success" | "info" | "warning" }> = {
  verified_fact: { label: "Fait vérifié", tone: "success" },
  declared: { label: "Déclaré", tone: "info" },
  hypothesis: { label: "Hypothèse", tone: "warning" },
};

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { data, ctx, coverage, objectives } = await db(async (d, ctx) => {
    const data = await getCustomer(d, ctx.org.organizationId, id, toIsoDate(new Date()));
    return {
      data, ctx,
      coverage: data ? (await loadCustomerCoverage(d, ctx.org.organizationId, id, toIsoDate(new Date()))).rows : [],
      objectives: data ? await loadCustomerObjectives(d, ctx.org.organizationId, id, toIsoDate(new Date())) : null,
    };
  });
  if (!data) notFound();
  const { customer: c, summary: s } = data;
  const writable = canWrite(ctx.org.role);
  const maxMonth = Math.max(1, ...s.monthly.map((m) => Math.abs(Number(m.ht))));
  const next = data.opportunities[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/clients" className="text-[12.5px] text-faint hover:text-subtle">
            ← Clients
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h1 className="text-[24px] font-semibold tracking-tight">{c.trade_name ?? c.legal_name}</h1>
            <Badge tone={CUSTOMER_STATUS[c.status]?.tone ?? "neutral"}>{CUSTOMER_STATUS[c.status]?.label ?? c.status}</Badge>
            {c.segment ? <Badge tone="outline">{c.segment}</Badge> : null}
          </div>
          <p className="mt-1 text-[13px] text-subtle">
            {c.legal_name} · Code {c.external_code ?? "—"} · Commercial : {c.owner ?? "non attribué"}
          </p>
        </div>
        {writable ? (
          <OfferBuilderForm customerId={c.id} />
        ) : null}
      </div>

      {next ? (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-primary/20 bg-primary-soft/60 px-5 py-4">
          <LeaMark size={34} />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-primary">Prochaine action recommandée par LÉA</p>
            <p className="mt-0.5 text-[14px] font-medium">{next.recommended_action}</p>
            <p className="mt-0.5 text-[12.5px] text-subtle">{next.justification}</p>
          </div>
          {next.offer_id ? (
            <Button asChild variant="secondary">
              <Link href={`/offres/${next.offer_id}`}>Voir l&apos;offre</Link>
            </Button>
          ) : writable && ["reorder", "dormant_customer", "new_product", "cross_sell", "back_in_stock", "campaign"].includes(next.type) ? (
            <ActionButton action={createOfferFromOpportunityAction.bind(null, next.id)} pendingLabel="Préparation…">
              Préparer l&apos;offre
            </ActionButton>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="CA 12 mois HT" value={formatMoney(s.revenue12m, "EUR", { compact: true })} hint={dec(s.revenuePrev12m).gt(0) ? `12 mois précédents : ${formatMoney(s.revenuePrev12m, "EUR", { compact: true })}` : "Net des avoirs, hors annulations"} />
        <Stat label="Dernier achat" value={s.lastPurchase ? formatRelative(s.lastPurchase) : "—"} hint={s.lastPurchase ? formatDate(s.lastPurchase) : "Aucune facture"} />
        <Stat label="Fréquence d'achat" value={s.meanIntervalDays ? `${s.meanIntervalDays} j` : "—"} hint={`${s.invoiceCount} facture(s)`} />
        <Stat label="Panier moyen HT" value={s.avgBasket ? formatMoney(s.avgBasket, "EUR", { compact: true }) : "—"} hint={s.trendPct !== null ? `Tendance 90 j : ${s.trendPct > 0 ? "+" : ""}${s.trendPct.toLocaleString("fr-FR")} %` : undefined} />
      </div>

      {objectives ? <div className="mb-5"><ObjectivesSection customerId={c.id} rows={objectives.rows} summary={objectives.summary} writable={writable} hasAnnual={data.growth.targets.some((t) => t.progress.periodType === "year")} /></div> : null}
      <div className="mb-5"><CoverageSection customerId={c.id} rows={coverage} /></div>
      <GrowthSection customerId={c.id} growth={data.growth} writable={writable} revenue12m={s.revenue12m} doNotSolicit={c.do_not_solicit} pausedUntil={c.solicit_paused_until} />

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Chiffre d&apos;affaires mensuel (HT, net des avoirs)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex h-32 items-end gap-1.5" role="img" aria-label="Chiffre d'affaires des 12 derniers mois">
                {s.monthly.map((m) => (
                  <div key={m.month} className="group flex h-full flex-1 flex-col items-center gap-1">
                    <div className="relative w-full flex-1">
                      <div
                        className="absolute bottom-0 w-full rounded-t-[3px] bg-primary/80 transition-colors group-hover:bg-primary"
                        style={{ height: `${(Math.max(0, Number(m.ht)) / maxMonth) * 100}%` }}
                        title={`${m.month} : ${formatMoney(m.ht)}`}
                      />
                    </div>
                    <span className="text-[10px] text-faint">{new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" }).format(new Date(`${m.month}-01T00:00:00Z`))}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Historique des produits achetés</CardTitle>
              <span className="text-[12px] text-faint">Calculés depuis les lignes de factures</span>
            </CardHeader>
            <Table>
              <THead>
                <tr>
                  <TH>Produit</TH>
                  <TH className="text-right">Commandes</TH>
                  <TH className="text-right">Qté moy.</TH>
                  <TH>Cycle</TH>
                  <TH>Prochain achat estimé</TH>
                  <TH>Dispo.</TH>
                </tr>
              </THead>
              <TBody>
                {data.habits.map((h) => (
                  <TR key={h.productId}>
                    <TD>
                      <Link href={`/produits/${h.productId}`} className="font-medium hover:text-primary">
                        {h.product?.name ?? "Produit"}
                      </Link>
                      <span className="block text-[11.5px] text-faint">{h.product?.reference}</span>
                    </TD>
                    <TD className="tabular text-right">{h.orders}</TD>
                    <TD className="tabular text-right">{formatQty(dec(h.avgQtyPerOrder).toDecimalPlaces(0))}</TD>
                    <TD className="text-subtle">{h.meanIntervalDays ? `${h.meanIntervalDays} j` : "—"}</TD>
                    <TD>
                      {h.nextExpected ? (
                        <span className={h.daysUntilNext !== null && h.daysUntilNext <= 7 ? "font-medium text-warning" : "text-subtle"}>{formatRelative(h.nextExpected)}</span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </TD>
                    <TD>{h.product ? <Badge tone={AVAILABILITY[h.product.availability]?.tone ?? "neutral"}>{AVAILABILITY[h.product.availability]?.label}</Badge> : null}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Opportunités identifiées</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.opportunities.length === 0 ? <p className="text-[13px] text-subtle">Aucune opportunité ouverte.</p> : null}
              {data.opportunities.map((o) => (
                <div key={o.id} className="rounded-md border border-border px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge tone="primary">{OPPORTUNITY_LABEL[o.type]}</Badge>
                      <span className="text-[13.5px] font-medium">{o.title}</span>
                    </div>
                    <span className="tabular text-[13px] font-semibold">{o.estimated_value_ht ? `${formatMoney(o.estimated_value_ht, "EUR", { compact: true })} estimés` : "—"}</span>
                  </div>
                  <p className="mt-1 text-[12.5px] text-subtle">{o.justification}</p>
                  <p className="mt-1 text-[11.5px] text-faint">
                    Confiance {Math.round(Number(o.confidence) * 100)} % · Sources : {(o.data_sources ?? []).join(", ")}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Factures</CardTitle>
              <Link href={`/factures?client=${c.id}`} className="text-[12.5px] text-primary hover:underline">
                Toutes les factures ({data.invoiceCount})
              </Link>
            </CardHeader>
            <Table>
              <THead>
                <tr>
                  <TH>Numéro</TH>
                  <TH>Date</TH>
                  <TH>Type</TH>
                  <TH className="text-right">Total HT</TH>
                  <TH>Règlement</TH>
                </tr>
              </THead>
              <TBody>
                {data.invoices.map((i) => (
                  <TR key={i.id} className={i.status === "cancelled" ? "opacity-50" : ""}>
                    <TD>
                      <Link href={`/factures/${i.id}`} className="font-medium hover:text-primary">
                        {i.invoice_number}
                      </Link>
                    </TD>
                    <TD className="text-subtle">{formatDate(i.invoice_date)}</TD>
                    <TD>{i.doc_type === "credit_note" ? <Badge tone="warning">Avoir</Badge> : i.status === "cancelled" ? <Badge>Annulée</Badge> : <span className="text-subtle">Facture</span>}</TD>
                    <TD className="tabular text-right">{i.doc_type === "credit_note" ? "− " : ""}{formatMoney(i.total_ht)}</TD>
                    <TD>
                      <Badge tone={PAYMENT_STATUS[i.payment_status]?.tone ?? "neutral"}>{PAYMENT_STATUS[i.payment_status]?.label}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Coordonnées & conditions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-[13px]">
              {c.address_line1 ? (
                <p className="flex items-start gap-2 text-subtle">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" />
                  {c.address_line1}, {c.postal_code} {c.city} ({c.country})
                </p>
              ) : null}
              {c.phone ? <p className="flex items-center gap-2 text-subtle"><Phone className="size-3.5" />{c.phone}</p> : null}
              {c.email ? <p className="flex items-center gap-2 text-subtle"><Mail className="size-3.5" />{c.email}</p> : null}
              {c.website ? <p className="flex items-center gap-2 text-subtle"><Globe className="size-3.5" />{c.website}</p> : null}
              <div className="mt-2 border-t border-border pt-2">
                <KeyValue label="Paiement">{c.payment_terms}</KeyValue>
                <KeyValue label="Minimum de commande">{c.min_order_amount ? formatMoney(c.min_order_amount) : null}</KeyValue>
                <KeyValue label="Franco">{c.franco_amount ? formatMoney(c.franco_amount) : null}</KeyValue>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contacts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.contacts.length === 0 ? <p className="text-[13px] text-subtle">Aucun contact.</p> : null}
              {data.contacts.map((ct) => (
                <div key={ct.id} className="text-[13px]">
                  <p className="font-medium">
                    {[ct.salutation, ct.first_name, ct.last_name].filter(Boolean).join(" ")} {ct.is_primary ? <Badge tone="primary">Principal</Badge> : null}
                  </p>
                  <p className="text-subtle">{ct.job_function}</p>
                  <p className="break-all text-subtle">{ct.email}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge tone={ct.consent_email ? "success" : "neutral"}>{ct.consent_email ? "Consentement email" : "Sans consentement email"}</Badge>
                    {ct.shared_with > 0 ? <Badge tone="info">Partagé avec {ct.shared_with} autre(s) société(s)</Badge> : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Offres</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {data.offers.length === 0 ? <p className="text-[13px] text-subtle">Aucune offre.</p> : null}
              {data.offers.map((o) => (
                <Link key={o.id} href={`/offres/${o.id}`} className="flex items-center justify-between gap-2 rounded-md py-1 text-[13px] hover:text-primary">
                  <span className="font-medium">{o.number}</span>
                  <Badge tone={OFFER_STATUS[o.status]?.tone ?? "neutral"}>{OFFER_STATUS[o.status]?.label}</Badge>
                  <span className="tabular">{formatMoney(o.total_ht, "EUR", { compact: true })}</span>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Conversations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {data.conversations.length === 0 ? <p className="text-[13px] text-subtle">Aucun échange.</p> : null}
              {data.conversations.map((cv) => (
                <Link key={cv.id} href={`/conversations/${cv.id}`} className="block rounded-md py-1 text-[13px] hover:text-primary">
                  <span className="font-medium">{cv.subject ?? "Sans objet"}</span>
                  <span className="block text-[11.5px] text-faint">
                    {cv.channel} · {cv.messages} message(s) · {formatRelative(cv.last_message_at)}
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LeaMark size={18} /> Mémoire de LÉA
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {data.memory.length === 0 ? <p className="text-[13px] text-subtle">Rien de mémorisé pour l&apos;instant.</p> : null}
              {data.memory.map((m) => {
                const stale = m.valid_until && new Date(m.valid_until) < new Date();
                return (
                  <div key={m.id} className="text-[13px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={CERTAINTY[m.certainty]?.tone ?? "neutral"}>{CERTAINTY[m.certainty]?.label}</Badge>
                      {stale ? <Badge>Périmé</Badge> : null}
                      <span className="text-[11px] text-faint">{formatRelative(m.created_at)} · {m.source}</span>
                    </div>
                    <p className="mt-0.5 text-subtle">{m.content}</p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
