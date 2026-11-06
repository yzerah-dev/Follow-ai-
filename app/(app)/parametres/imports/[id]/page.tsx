import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/auth/context";
import { canManage } from "@/lib/auth/roles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Stat } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ENTITIES, ENTITY_LABEL, type EntityKind } from "@/features/imports/definitions";
import { MappingForm, AutoRefresh } from "./mapping-form";

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { data, role } = await db(async (d, ctx) => {
    const imp = (await d.query<{ id: string; entity: EntityKind; filename: string; status: string; mapping: { headers: string[]; fields: Record<string, string | null>; previousImportId: string | null }; total_rows: number; ok_rows: number; duplicate_rows: number; error_rows: number; error: string | null }>(
      `select id, entity, filename, status, mapping, total_rows, ok_rows, duplicate_rows, error_rows, error from imports where id = $1 and organization_id = $2`, [id, ctx.org.organizationId])).rows[0];
    if (!imp) return { data: null, role: ctx.org.role };
    const preview = (await d.query<{ row_no: number; raw: Record<string, string> }>(`select row_no, raw from import_rows where import_id = $1 order by row_no limit 8`, [id])).rows;
    const errors = (await d.query<{ row_no: number; status: string; errors: string[] }>(`select row_no, status, errors from import_rows where import_id = $1 and (status = 'error' or jsonb_array_length(errors) > 0) order by row_no limit 200`, [id])).rows;
    return { data: { imp, preview, errors }, role: ctx.org.role };
  });
  if (!data) notFound();
  const { imp } = data;
  const fields = ENTITIES[imp.entity].map((f) => ({ key: f.key, label: f.label, required: !!f.required }));
  return (
    <>
      <Link href="/parametres/imports" className="text-[12.5px] text-faint hover:text-subtle">← Imports</Link>
      <PageHeader title={imp.filename} description={`${ENTITY_LABEL[imp.entity]} · ${imp.total_rows} ligne(s)`}>
        <div className="mt-2 flex gap-2">
          <Badge tone={imp.status === "completed" ? "success" : imp.status === "failed" ? "danger" : "warning"}>{imp.status}</Badge>
          {imp.mapping.previousImportId ? <Badge tone="info">Fichier déjà importé : aucune donnée ne sera dupliquée</Badge> : null}
        </div>
      </PageHeader>
      {imp.status === "processing" ? <AutoRefresh /> : null}
      {imp.error ? <p className="mb-4 rounded-md bg-danger-soft px-4 py-2 text-[13px] text-danger">{imp.error}</p> : null}

      {imp.status === "completed" ? (
        <div className="mb-5 grid grid-cols-3 gap-3">
          <Stat label="Lignes importées / mises à jour" value={imp.ok_rows} tone="success" />
          <Stat label="Doublons ignorés" value={imp.duplicate_rows} />
          <Stat label="Erreurs" value={imp.error_rows} tone={imp.error_rows ? "warning" : "default"} />
        </div>
      ) : null}

      {imp.status === "uploaded" && canManage(role) ? (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle>Association des colonnes</CardTitle>
          </CardHeader>
          <CardContent>
            <MappingForm importId={imp.id} headers={imp.mapping.headers} initial={imp.mapping.fields} fields={fields} />
          </CardContent>
        </Card>
      ) : null}

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Prévisualisation</CardTitle>
        </CardHeader>
        <Table>
          <THead>
            <tr>
              <TH>Ligne</TH>
              {imp.mapping.headers.map((h) => (
                <TH key={h}>{h}</TH>
              ))}
            </tr>
          </THead>
          <TBody>
            {data.preview.map((r) => (
              <TR key={r.row_no}>
                <TD className="text-faint">{r.row_no}</TD>
                {imp.mapping.headers.map((h) => (
                  <TD key={h} className="whitespace-nowrap text-[12.5px]">{r.raw[h]}</TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      {data.errors.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Rapport d&apos;erreurs et avertissements</CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <tr>
                <TH>Ligne</TH>
                <TH>Statut</TH>
                <TH>Détail</TH>
              </tr>
            </THead>
            <TBody>
              {data.errors.map((e) => (
                <TR key={e.row_no}>
                  <TD>{e.row_no}</TD>
                  <TD><Badge tone={e.status === "error" ? "danger" : "warning"}>{e.status}</Badge></TD>
                  <TD className="text-[12.5px]">{e.errors.join(" · ")}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}
    </>
  );
}
