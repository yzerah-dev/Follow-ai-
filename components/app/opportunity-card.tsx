import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatMoney, dec } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/app/action-button";
import { OPPORTUNITY_LABEL } from "@/components/app/labels";
import { createOfferFromOpportunityAction, dismissOpportunityAction } from "@/app/actions/commercial";
import { MISSION_LABEL, type Mission } from "@/features/opportunities/missions";
import type { DashboardOpportunity } from "@/features/dashboard/queries";

/** Carte d'opportunité détaillée (justification, facteurs de priorité, actions). */
export function OpportunityCard({ o, writable }: { o: DashboardOpportunity; writable: boolean }) {
  return (
      <div className="rounded-lg border border-border px-4 py-3.5 transition-colors hover:border-border-strong" data-testid="opportunity">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/clients/${o.customerId}`} className="text-[14px] font-semibold hover:text-primary">
                {o.customerName}
              </Link>
              {o.mission ? <Badge tone="outline">{MISSION_LABEL[o.mission as Mission] ?? o.mission}</Badge> : null}
              <Badge tone="primary">{OPPORTUNITY_LABEL[o.type] ?? o.type}</Badge>
              {o.status === "in_progress" ? <Badge tone="info">En cours</Badge> : null}
            </div>
            <p className="mt-1 text-[13.5px] font-medium">« {o.title} »</p>
            <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-subtle">{o.justification}</p>
          </div>
          <div className="text-right">
            <p className="tabular text-[15px] font-semibold">{o.estimatedValueHt ? formatMoney(o.estimatedValueHt, "EUR", { compact: true }) : "À confirmer"}</p>
            <p className="text-[11px] text-faint">{o.estimatedValueHt ? "potentiel estimé HT" : "potentiel non chiffré"}</p>
            {o.scoring ? (
              <div className="mt-1.5 space-y-0.5" aria-label="Facteurs de priorité">
                {([["Potentiel", o.estimatedValueHt ? o.scoring.potential : null], ["Urgence", o.scoring.urgency], ["Probabilité", o.scoring.probability]] as const).map(([label, v]) => (
                  <div key={label} className="flex items-center justify-end gap-1.5 text-[10.5px] text-faint">
                    <span>{label}</span>
                    <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.round((v ?? 0) * 100)}%` }} />
                    </span>
                    <span className="w-7 text-right tabular">{v === null ? "—" : `${Math.round(v * 100)}`}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-faint">Confiance {Math.round(dec(o.confidence).toNumber() * 100)} %</p>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/clients/${o.customerId}`}>Voir le client</Link>
          </Button>
          {o.offerId ? (
            <Button asChild variant="soft" size="sm">
              <Link href={`/offres/${o.offerId}`}>
                Voir l&apos;offre <ArrowRight />
              </Link>
            </Button>
          ) : writable && ["reorder", "dormant_customer", "new_product", "cross_sell", "back_in_stock", "campaign"].includes(o.type) ? (
            <ActionButton size="sm" action={createOfferFromOpportunityAction.bind(null, o.id)} pendingLabel="LÉA prépare l'offre…">
              Préparer l&apos;offre <ArrowRight />
            </ActionButton>
          ) : null}
          {writable && !o.offerId ? (
            <ActionButton size="sm" variant="ghost" action={dismissOpportunityAction.bind(null, o.id)}>
              Ignorer
            </ActionButton>
          ) : null}
          <span className="ml-auto text-[12px] text-faint">{o.recommendedAction}</span>
        </div>
      </div>
  );
}
