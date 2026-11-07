import { Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { CONFIDENCE_LABEL, RISK_LABEL, fmtRate, type CoverageRow } from "@/features/analytics/coverage";
import { formatDate } from "@/lib/utils";

const RISK_TONE = { high: "danger", medium: "warning", low: "success", unknown: "neutral" } as const;

/** Couverture de stock estimée ou déclarée, par référence. Une estimation n'est jamais présentée comme un stock vérifié. */
export function CoverageSection({ customerId, rows }: { customerId: string; rows: CoverageRow[] }) {
  return (
    <Card data-testid="coverage">
      <CardHeader>
        <div>
          <CardTitle>Couverture de stock</CardTitle>
          <p className="mt-0.5 text-[12px] text-faint">Estimée à partir des achats du client, sauf stock ou sorties caisse déclarés. « Inconnu » ≠ 0.</p>
        </div>
        <a href={`/api/customers/${customerId}/coverage`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-muted">
          <Download className="size-4" /> Excel illustré
        </a>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0">
        {rows.length === 0 ? <p className="px-5 py-4 text-[13px] text-subtle">Aucun achat sur 12 mois.</p> : (
          <Table>
            <THead>
              <TR>
                <TH>Référence</TH><TH>Dernier achat</TH><TH className="text-right">Ventes/jour</TH><TH className="text-right">Stock</TH>
                <TH className="text-right">Couverture</TH><TH>Risque</TH><TH className="text-right">Qté conseillée</TH><TH>Confiance</TH>
              </TR>
            </THead>
            <TBody>
              {rows.slice(0, 10).map((r) => (
                <TR key={r.productId} title={r.reason}>
                  <TD><span className="font-medium">{r.name}</span><span className="block text-[11.5px] text-faint">{r.reference}{r.slowMover ? " · rotation lente" : ""}</span></TD>
                  <TD>{r.lastPurchase ? formatDate(r.lastPurchase) : "Inconnu"}</TD>
                  <TD className="tabular text-right">{fmtRate(r.dailyRate)}{r.rateSource === "estimated" ? <span className="text-faint"> (est.)</span> : null}</TD>
                  <TD className="tabular text-right">{r.stockOnHand === null ? "Inconnu" : r.stockSource === "declared" ? r.stockOnHand : <span className="text-subtle">~{r.stockOnHand} (est.)</span>}</TD>
                  <TD className="tabular text-right">{r.coverageDays === null ? "Inconnu" : `${r.coverageDays} j`}</TD>
                  <TD><Badge tone={RISK_TONE[r.risk]}>{RISK_LABEL[r.risk]}</Badge></TD>
                  <TD className="tabular text-right">{r.recommendedQty === null ? "Inconnu" : Number(r.recommendedQty)}</TD>
                  <TD className="text-[12px] text-subtle">{CONFIDENCE_LABEL[r.confidence]}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
