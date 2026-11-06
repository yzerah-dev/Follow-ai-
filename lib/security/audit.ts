import type { Db } from "@/lib/database/client";

export type AuditActor = { type: "user"; userId: string } | { type: "agent" } | { type: "system" };

export async function audit(
  db: Db,
  organizationId: string,
  actor: AuditActor,
  action: string,
  entity?: { type: string; id?: string | null },
  metadata: Record<string, unknown> = {},
) {
  await db.query(
    `insert into audit_logs (organization_id, actor_type, actor_user_id, action, entity_type, entity_id, metadata)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [organizationId, actor.type, actor.type === "user" ? actor.userId : null, action, entity?.type ?? null, entity?.id ?? null, metadata],
  );
}
