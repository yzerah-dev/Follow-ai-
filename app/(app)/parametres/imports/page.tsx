import Link from "next/link";
import { db } from "@/lib/auth/context";
import { canManage } from "@/lib/auth/roles";
import { formatRelative } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ENTITY_LABEL, type EntityKind } from "@/features/imports/definitions";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Imports" };

const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" }> = {
  uploaded: { label: "À associer", tone: "warning" },
  mapped: { label: "Associé", tone: "info" },
  processing: { label: "En cours", tone: "info" },
  completed: { label: "Terminé", tone: "success" },
  failed: { label: "Échec", tone: "danger" },
};

export default async function ImportsPage() {
  const { rows, role } = await db(async (d, ctx) => ({
    role: ctx.org.role,
    rows: (await d.query<{ id: string; entity: EntityKind; filename: string; status: string; total_rows: number; ok_rows: number; duplicate_rows: number; error_rows: number; created_at: string }>(
      `select id, entity, filename, status, total_rows, ok_rows, duplicate_rows, error_rows, created_at from imports where organization_id = $1 order by created_at desc limit 50`, [ctx.org.organizationId])).rows,
  }));
  return (
    <>
      <Link href="/parametres" className="text-[12.5px] text-faint hover:text-subtle">← Paramètres</Link>
      <PageHeader title="Imports" description="CSV ou XLSX. Prévisualisation, association des colonnes, validation, rapport d'erreurs. Réimporter un fichier ne crée pas de doublon." />
      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Nouvel import</CardTitle>
          </CardHeader>
          <CardContent>
            {canManage(role) ? <UploadForm /> : <p className="text-[13px] text-subtle">Réservé aux managers et administrateurs.</p>}
            <p className="mt-4 text-[12px] text-faint">
              Ordre conseillé : clients → contacts → produits → tarifs → stocks → factures. Formats détaillés dans docs/IMPORT_FORMATS.md.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Historique</CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <tr>
                <TH>Fichier</TH>
                <TH>Type</TH>
                <TH>Statut</TH>
                <TH className="text-right">Lignes</TH>
                <TH className="text-right">OK</TH>
                <TH className="text-right">Doublons</TH>
                <TH className="text-right">Erreurs</TH>
                <TH>Date</TH>
              </tr>
            </THead>
            <TBody>
              {rows.length === 0 ? (
                <TR>
                  <TD colSpan={8} className="text-subtle">Aucun import pour l&apos;instant.</TD>
                </TR>
              ) : null}
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD><Link href={`/parametres/imports/${r.id}`} className="font-medium hover:text-primary">{r.filename}</Link></TD>
                  <TD className="text-subtle">{ENTITY_LABEL[r.entity]}</TD>
                  <TD><Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label}</Badge></TD>
                  <TD className="tabular text-right">{r.total_rows}</TD>
                  <TD className="tabular text-right text-success">{r.ok_rows}</TD>
                  <TD className="tabular text-right text-subtle">{r.duplicate_rows}</TD>
                  <TD className="tabular text-right text-danger">{r.error_rows}</TD>
                  <TD className="text-subtle">{formatRelative(r.created_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
