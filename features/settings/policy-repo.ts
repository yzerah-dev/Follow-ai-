import type { Db } from "@/lib/database/client";
import { DEFAULT_POLICY, type CommercialPolicy } from "@/features/offers/policy";

export async function loadPolicy(db: Db, orgId: string): Promise<CommercialPolicy> {
  const r = await db.query<{ policy_name: string | null; max_auto_discount_pct: string; require_discount_approval: boolean; require_message_approval: boolean; offer_validity_days: number }>(
    `select policy_name, max_auto_discount_pct, require_discount_approval, require_message_approval, offer_validity_days from organization_settings where organization_id = $1`,
    [orgId],
  );
  const s = r.rows[0];
  if (!s) return DEFAULT_POLICY;
  return {
    name: s.policy_name,
    maxAutoDiscountPct: s.max_auto_discount_pct,
    requireDiscountApproval: s.require_discount_approval,
    requireMessageApproval: s.require_message_approval,
    offerValidityDays: s.offer_validity_days,
  };
}
