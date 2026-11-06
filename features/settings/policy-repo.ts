import type { Db } from "@/lib/database/client";
import { DEFAULT_POLICY, type CommercialPolicy } from "@/features/offers/policy";
import type { AutonomySettings, SendWindow } from "@/features/agent/autonomy";

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

export type AutonomyConfig = AutonomySettings & { dailyOfferLimit: number; followupAfterDays: number; maxFollowups: number };

export async function loadAutonomy(db: Db, orgId: string): Promise<AutonomyConfig> {
  const s = (await db.query<{ autonomy_level: AutonomySettings["level"]; autonomy_paused: boolean; autonomous_max_offer_ht: string | null; require_discount_approval: boolean; daily_send_limit: number; daily_offer_limit: number; send_window: SendWindow; timezone: string; followup_after_days: number; max_followups: number }>(
    `select autonomy_level, autonomy_paused, autonomous_max_offer_ht, require_discount_approval, daily_send_limit, daily_offer_limit, send_window, timezone, followup_after_days, max_followups
     from organization_settings where organization_id = $1`, [orgId])).rows[0];
  if (!s) return { level: "supervised", paused: false, maxOfferHt: null, requireDiscountApproval: true, dailySendLimit: 0, sendWindow: { days: [], start: "08:30", end: "18:30" }, timezone: "Europe/Paris", dailyOfferLimit: 0, followupAfterDays: 5, maxFollowups: 0 };
  return {
    level: s.autonomy_level,
    paused: s.autonomy_paused,
    maxOfferHt: s.autonomous_max_offer_ht,
    requireDiscountApproval: s.require_discount_approval,
    dailySendLimit: s.daily_send_limit,
    sendWindow: s.send_window,
    timezone: s.timezone,
    dailyOfferLimit: s.daily_offer_limit,
    followupAfterDays: s.followup_after_days,
    maxFollowups: s.max_followups,
  };
}
