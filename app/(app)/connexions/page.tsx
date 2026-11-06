import { Mail, MessageCircle, Briefcase, Smartphone, Phone } from "lucide-react";
import { db } from "@/lib/auth/context";
import { isAdmin } from "@/lib/auth/roles";
import { ADAPTERS } from "@/lib/integrations/registry";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { ActionButton } from "@/components/app/action-button";
import { CONNECTION_STATUS } from "@/components/app/labels";
import { toggleSimulationAction } from "@/app/actions/commercial";

export const metadata = { title: "Connexions" };

const CHANNELS = [
  { key: "email", label: "Email", icon: Mail, priority: "Priorité V1" },
  { key: "whatsapp", label: "WhatsApp Business", icon: MessageCircle },
  { key: "linkedin", label: "LinkedIn", icon: Briefcase },
  { key: "sms", label: "SMS", icon: Smartphone },
  { key: "phone", label: "Téléphone", icon: Phone },
] as const;

export default async function ConnectionsPage() {
  const { rows, role } = await db(async (d, ctx) => ({
    role: ctx.org.role,
    rows: (await d.query<{ id: string; channel: string; provider: string; status: string; simulation_enabled: boolean; display_name: string | null; last_error: string | null }>(
      `select id, channel, provider, status, simulation_enabled, display_name, last_error from communication_connections where organization_id = $1 order by channel, provider`, [ctx.org.organizationId])).rows,
  }));
  return (
    <>
      <PageHeader title="Connexions" description="État réel de chaque canal. Une connexion simulée n'est jamais présentée comme active." />
      <div className="space-y-5">
        {CHANNELS.map((ch) => {
          const conns = rows.filter((r) => r.channel === ch.key);
          return (
            <Card key={ch.key}>
              <CardContent className="pt-5">
                <div className="mb-3 flex items-center gap-2.5">
                  <div className="rounded-md bg-muted p-2 text-subtle">
                    <ch.icon className="size-4" />
                  </div>
                  <h2 className="text-[15px] font-semibold">{ch.label}</h2>
                  {"priority" in ch ? <Badge tone="primary">{ch.priority}</Badge> : null}
                </div>
                <div className="divide-y divide-border rounded-md border border-border">
                  {conns.map((c) => {
                    const adapter = ADAPTERS[`${c.channel}:${c.provider}`];
                    const st = CONNECTION_STATUS[c.status];
                    return (
                      <div key={c.id} className="flex flex-wrap items-start gap-4 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[13.5px] font-medium">{c.display_name ?? c.provider}</span>
                            <Badge tone={st?.tone ?? "neutral"}>{st?.label}</Badge>
                            {c.simulation_enabled ? <Badge tone="warning">Mode simulation actif — aucun envoi réel</Badge> : null}
                          </div>
                          {adapter ? (
                            <div className="mt-1.5 grid gap-1 text-[12.5px] sm:grid-cols-2">
                              <p className="text-subtle">
                                <span className="font-medium text-foreground">Fonctions : </span>
                                {adapter.capabilities.join(" · ")}
                              </p>
                              <p className="text-subtle">
                                <span className="font-medium text-foreground">Limites / prérequis : </span>
                                {adapter.limitations.join(" ")}
                              </p>
                            </div>
                          ) : null}
                          {c.last_error ? <p className="mt-1 text-[12px] text-danger">{c.last_error}</p> : null}
                        </div>
                        {isAdmin(role) && c.provider === "simulated" ? (
                          <ActionButton size="sm" variant="secondary" action={toggleSimulationAction.bind(null, c.id, !c.simulation_enabled)}>
                            {c.simulation_enabled ? "Désactiver la simulation" : "Activer la simulation"}
                          </ActionButton>
                        ) : c.status !== "connected" ? (
                          <span className="text-[12px] text-faint">Configuration requise (voir docs/INTEGRATIONS.md)</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
