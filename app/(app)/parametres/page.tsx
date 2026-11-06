import Link from "next/link";
import { Upload } from "lucide-react";
import { db } from "@/lib/auth/context";
import { isAdmin, ROLE_LABEL, type MemberRole } from "@/lib/auth/roles";
import { getLlm } from "@/lib/ai";
import { formatRelative } from "@/lib/utils";
import { dec } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KeyValue, PageHeader } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Paramètres" };

export default async function SettingsPage() {
  const { data, ctx } = await db(async (d, ctx) => {
    const s = (await d.query<{ max_auto_discount_pct: string; require_discount_approval: boolean; dormant_after_days: number; reorder_lookahead_days: number; offer_validity_days: number; policy_name: string | null; brand: { primaryColor?: string; companyName?: string } }>(
      `select * from organization_settings where organization_id = $1`, [ctx.org.organizationId])).rows[0]!;
    const members = (await d.query<{ id: string; display_name: string | null; role: MemberRole; status: string }>(`select id, display_name, role, status from organization_members where organization_id = $1 order by role`, [ctx.org.organizationId])).rows;
    const usage = (await d.query<{ runs: number; tokens_in: number; tokens_out: number; cost: string }>(
      `select count(*)::int runs, coalesce(sum(tokens_in),0)::int tokens_in, coalesce(sum(tokens_out),0)::int tokens_out, coalesce(sum(cost_usd),0) cost from agent_runs where organization_id = $1 and created_at > now() - interval '30 days'`, [ctx.org.organizationId])).rows[0]!;
    const templates = (await d.query<{ id: string; kind: string; name: string; version: number; is_active: boolean }>(`select id, kind, name, version, is_active from creative_templates where organization_id = $1 order by kind, version desc`, [ctx.org.organizationId])).rows;
    const audit = isAdmin(ctx.org.role) || ctx.org.role === "manager"
      ? (await d.query<{ id: number; action: string; actor_type: string; created_at: string; actor: string | null }>(
          `select a.id, a.action, a.actor_type, a.created_at, m.display_name as actor from audit_logs a left join organization_members m on m.organization_id = a.organization_id and m.user_id = a.actor_user_id
           where a.organization_id = $1 order by a.id desc limit 15`, [ctx.org.organizationId])).rows
      : [];
    const suppressions = (await d.query<{ n: number }>(`select count(*)::int n from suppression_entries where organization_id = $1`, [ctx.org.organizationId])).rows[0]!.n;
    return { data: { s, members, usage, templates, audit, suppressions }, ctx };
  });
  const admin = isAdmin(ctx.org.role);
  const llm = getLlm();
  return (
    <>
      <PageHeader
        title="Paramètres"
        description={ctx.org.name}
        actions={
          <Button asChild variant="secondary">
            <Link href="/parametres/imports">
              <Upload /> Imports de données
            </Link>
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Politique commerciale & marque</CardTitle>
            {data.s.policy_name ? <Badge tone="primary">{data.s.policy_name}</Badge> : null}
          </CardHeader>
          <CardContent>
            <SettingsForm
              readOnly={!admin}
              initial={{
                maxAutoDiscountPct: dec(data.s.max_auto_discount_pct).toString(),
                dormantAfterDays: data.s.dormant_after_days,
                reorderLookaheadDays: data.s.reorder_lookahead_days,
                offerValidityDays: data.s.offer_validity_days,
                primaryColor: data.s.brand.primaryColor ?? "#4F46E5",
                companyName: data.s.brand.companyName ?? ctx.org.name,
              }}
            />
            <p className="mt-3 text-[12px] text-faint">
              Au-delà du plafond, LÉA transfère la négociation au commercial. En V1, toute remise communiquée nécessite une validation humaine{data.s.require_discount_approval ? " (activée)" : ""}.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>LÉA — moteur IA</CardTitle>
              {llm.simulated ? <Badge tone="warning">IA simulée</Badge> : <Badge tone="success">Claude actif</Badge>}
            </CardHeader>
            <CardContent>
              <KeyValue label="Fournisseur">{llm.simulated ? "Simulation déterministe (aucun appel externe)" : `Anthropic · ${llm.model}`}</KeyValue>
              <KeyValue label="Exécutions (30 j)">{data.usage.runs}</KeyValue>
              <KeyValue label="Jetons entrée / sortie">{`${data.usage.tokens_in.toLocaleString("fr-FR")} / ${data.usage.tokens_out.toLocaleString("fr-FR")}`}</KeyValue>
              <KeyValue label="Coût estimé (30 j)">{`${dec(data.usage.cost).toFixed(4)} USD`}</KeyValue>
              {llm.simulated ? <p className="mt-2 text-[12px] text-faint">Pour activer Claude : LLM_PROVIDER=anthropic et ANTHROPIC_API_KEY dans l&apos;environnement serveur.</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Membres</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {data.members.map((m) => (
                <div key={m.id} className="flex items-center justify-between py-1 text-[13px]">
                  <span>{m.display_name ?? "—"}</span>
                  <Badge tone={m.role === "owner" ? "primary" : "neutral"}>{ROLE_LABEL[m.role]}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Templates créatifs (versionnés)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {data.templates.map((t) => (
                <div key={t.id} className="flex items-center justify-between py-0.5 text-[13px]">
                  <span>{t.name}</span>
                  <span className="text-faint">v{t.version}{t.is_active ? " · actif" : ""}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Conformité</CardTitle>
            </CardHeader>
            <CardContent className="text-[13px]">
              <KeyValue label="Adresses en liste d'opposition">{data.suppressions}</KeyValue>
              <p className="mt-2 text-[12px] text-faint">Les désinscriptions détectées par LÉA sont ajoutées automatiquement. Export et suppression des données : voir docs/SECURITY.md.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {data.audit.length ? (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Journal d&apos;audit (derniers événements)</CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <tr>
                <TH>Action</TH>
                <TH>Acteur</TH>
                <TH>Date</TH>
              </tr>
            </THead>
            <TBody>
              {data.audit.map((a) => (
                <TR key={a.id}>
                  <TD className="font-mono text-[12px]">{a.action}</TD>
                  <TD className="text-subtle">{a.actor_type === "agent" ? "LÉA" : a.actor ?? a.actor_type}</TD>
                  <TD className="text-subtle">{formatRelative(a.created_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}
    </>
  );
}
