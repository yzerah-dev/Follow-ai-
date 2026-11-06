"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext, type AppContext } from "@/lib/auth/context";
import { canWrite, isAdmin, ForbiddenError, type MemberRole } from "@/lib/auth/roles";
import { withUser, type Db } from "@/lib/database/client";
import { rateLimit } from "@/lib/security/rate-limit";
import { audit } from "@/lib/security/audit";
import { env } from "@/lib/env";
import { toIsoDate } from "@/lib/utils";
import { createOfferFromOpportunity, createOfferDraft, suggestItemsForCustomer, decideOffer, acceptOfferAndPrepareOrder, markOfferLost } from "@/features/offers/service";
import { generateOfferAssets, decideAsset, ASSET_KINDS } from "@/features/creative-studio/service";
import { draftOfferEmail } from "@/features/agent/lea";
import { decideMessage, simulateCustomerReply } from "@/features/conversations/service";
import { runOpportunityScan } from "@/features/opportunities/service";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const uuid = z.uuid();

async function run(check: (r: MemberRole) => boolean, fn: (db: Db, ctx: AppContext) => Promise<string | void>, rate?: { key: string; limit: number }): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    if (!check(ctx.org.role)) throw new ForbiddenError();
    if (rate && !rateLimit(`${rate.key}:${ctx.userId}`, rate.limit, 60_000).ok) return { ok: false, error: "Trop d'actions en peu de temps, réessayez dans une minute." };
    const message = await withUser(ctx.userId, (db) => fn(db, ctx));
    return { ok: true, message: message ?? undefined };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: e.message };
    if (e instanceof z.ZodError) return { ok: false, error: "Données invalides." };
    if (e instanceof Error && !/^(relation|column|syntax)/.test(e.message)) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Une erreur est survenue." };
  }
}

export async function createOfferFromOpportunityAction(opportunityId: string) {
  let offerId = "";
  const r = await run(canWrite, async (db, ctx) => {
    const res = await createOfferFromOpportunity(db, ctx.org.organizationId, { userId: ctx.userId }, uuid.parse(opportunityId));
    offerId = res.offerId;
  }, { key: "offer", limit: 20 });
  if (!r.ok) return r;
  revalidatePath("/");
  redirect(`/offres/${offerId}`);
}

export async function createOfferForCustomerAction(customerId: string) {
  let offerId = "";
  const r = await run(canWrite, async (db, ctx) => {
    const id = uuid.parse(customerId);
    const items = await suggestItemsForCustomer(db, id, null);
    if (!items.length) throw new Error("Aucun historique d'achat : ajoutez des produits manuellement.");
    offerId = (await createOfferDraft(db, ctx.org.organizationId, { userId: ctx.userId }, { customerId: id, items, source: "lea", arguments: ["Sélection basée sur les références habituelles du client."] })).offerId;
  }, { key: "offer", limit: 20 });
  if (!r.ok) return r;
  redirect(`/offres/${offerId}`);
}

export async function decideOfferAction(offerId: string, decision: "approved" | "rejected") {
  const r = await run(canWrite, (db, ctx) => decideOffer(db, ctx.org.organizationId, ctx.userId, uuid.parse(offerId), z.enum(["approved", "rejected"]).parse(decision)));
  revalidatePath(`/offres/${offerId}`);
  revalidatePath("/");
  return r;
}

export async function generateAssetsAction(offerId: string, kinds: string[]) {
  const parsedKinds = z.array(z.enum(ASSET_KINDS)).min(1).max(6).parse(kinds);
  const r = await run(canWrite, async (db, ctx) => {
    const res = await generateOfferAssets(db, ctx.org.organizationId, ctx.userId, uuid.parse(offerId), parsedKinds);
    const created = res.filter((x) => x.status === "created").length;
    const notConfigured = res.filter((x) => x.status === "not_configured");
    return `${created} document(s) généré(s).${notConfigured.length ? ` ${notConfigured.map((n) => n.reason).join(" ")}` : ""}`;
  }, { key: "creative", limit: 10 });
  revalidatePath(`/offres/${offerId}`);
  return r;
}

export async function decideAssetAction(assetId: string, offerId: string, decision: "approved" | "rejected") {
  const r = await run(canWrite, (db, ctx) => decideAsset(db, ctx.org.organizationId, ctx.userId, uuid.parse(assetId), z.enum(["approved", "rejected"]).parse(decision)));
  revalidatePath(`/offres/${offerId}`);
  return r;
}

export async function draftEmailAction(offerId: string) {
  let conversationId = "";
  const r = await run(canWrite, async (db, ctx) => {
    conversationId = (await draftOfferEmail(db, ctx.org.organizationId, uuid.parse(offerId), { userId: ctx.userId })).conversationId;
  }, { key: "draft", limit: 20 });
  if (!r.ok) return r;
  redirect(`/conversations/${conversationId}`);
}

const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  subject: z.string().max(160).optional(),
  body: z.string().max(8000).optional(),
});

export async function decideMessageAction(messageId: string, conversationId: string, input: z.input<typeof decisionSchema>) {
  const d = decisionSchema.parse(input);
  const r = await run(canWrite, async (db, ctx) => {
    const res = await decideMessage(db, ctx.org.organizationId, ctx.userId, uuid.parse(messageId), { decision: d.decision, editedBody: d.body, editedSubject: d.subject });
    if (!res.sent) return "Brouillon refusé.";
    return res.simulated ? "Message validé — envoi SIMULÉ (aucun email réel)." : "Message envoyé.";
  }, { key: "send", limit: 30 });
  revalidatePath(`/conversations/${conversationId}`);
  revalidatePath("/");
  return r;
}

export async function simulateReplyAction(conversationId: string, body: string) {
  if (!env().DEMO_TOOLS) return { ok: false, error: "Outils de démonstration désactivés." } as ActionResult;
  const text = z.string().trim().min(2).max(4000).parse(body);
  const r = await run(canWrite, async (db, ctx) => {
    const res = await simulateCustomerReply(db, ctx.org.organizationId, ctx.userId, uuid.parse(conversationId), text);
    return `Réponse simulée reçue — LÉA a détecté : ${res.analysis.summary}`;
  }, { key: "simulate", limit: 20 });
  revalidatePath(`/conversations/${conversationId}`);
  revalidatePath("/");
  return r;
}

export async function acceptOfferAction(offerId: string) {
  const r = await run(canWrite, async (db, ctx) => {
    const o = await acceptOfferAndPrepareOrder(db, ctx.org.organizationId, ctx.userId, uuid.parse(offerId));
    return `Demande de commande ${o.number} préparée.`;
  });
  revalidatePath(`/offres/${offerId}`);
  revalidatePath("/");
  return r;
}

export async function markOfferLostAction(offerId: string, reason: string) {
  const r = await run(canWrite, (db, ctx) => markOfferLost(db, ctx.org.organizationId, ctx.userId, uuid.parse(offerId), z.string().max(300).parse(reason)));
  revalidatePath(`/offres/${offerId}`);
  return r;
}

export async function dismissOpportunityAction(opportunityId: string) {
  const r = await run(canWrite, async (db, ctx) => {
    await db.query(`update opportunities set status = 'dismissed' where id = $1 and organization_id = $2`, [uuid.parse(opportunityId), ctx.org.organizationId]);
    await audit(db, ctx.org.organizationId, { type: "user", userId: ctx.userId }, "opportunity.dismissed", { type: "opportunity", id: opportunityId });
  });
  revalidatePath("/");
  return r;
}

export async function runScanAction() {
  const r = await run(canWrite, async (db, ctx) => {
    const s = await runOpportunityScan(db, ctx.org.organizationId, toIsoDate(new Date()), ctx.userId);
    return `Analyse terminée : ${s.created} nouvelle(s), ${s.updated} mise(s) à jour, ${s.expired} expirée(s).`;
  }, { key: "scan", limit: 5 });
  revalidatePath("/");
  return r;
}

const settingsSchema = z.object({
  maxAutoDiscountPct: z.coerce.number().min(0).max(100),
  dormantAfterDays: z.coerce.number().int().min(15).max(1000),
  reorderLookaheadDays: z.coerce.number().int().min(1).max(120),
  offerValidityDays: z.coerce.number().int().min(1).max(365),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  companyName: z.string().trim().min(1).max(120),
});

export async function updateSettingsAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await run(isAdmin, async (db, ctx) => {
    const s = settingsSchema.parse(Object.fromEntries(form));
    await db.query(
      `update organization_settings set max_auto_discount_pct = $2, dormant_after_days = $3, reorder_lookahead_days = $4, offer_validity_days = $5,
         brand = brand || jsonb_build_object('primaryColor', $6::text, 'companyName', $7::text) where organization_id = $1`,
      [ctx.org.organizationId, s.maxAutoDiscountPct, s.dormantAfterDays, s.reorderLookaheadDays, s.offerValidityDays, s.primaryColor, s.companyName],
    );
    await audit(db, ctx.org.organizationId, { type: "user", userId: ctx.userId }, "settings.updated", undefined, s);
    return "Paramètres enregistrés.";
  });
  revalidatePath("/parametres");
  return r;
}

export async function toggleSimulationAction(connectionId: string, enabled: boolean) {
  const r = await run(isAdmin, async (db, ctx) => {
    await db.query(`update communication_connections set simulation_enabled = $3 where id = $1 and organization_id = $2 and provider = 'simulated'`, [uuid.parse(connectionId), ctx.org.organizationId, enabled]);
    await audit(db, ctx.org.organizationId, { type: "user", userId: ctx.userId }, "connection.simulation_toggled", { type: "connection", id: connectionId }, { enabled });
  });
  revalidatePath("/connexions");
  return r;
}

export async function addSuppressionAction(address: string) {
  const r = await run(canWrite, async (db, ctx) => {
    const a = z.email().parse(address.trim().toLowerCase());
    await db.query(`insert into suppression_entries (organization_id, channel, address, reason) values ($1,'email',$2,'manual') on conflict do nothing`, [ctx.org.organizationId, a]);
    await audit(db, ctx.org.organizationId, { type: "user", userId: ctx.userId }, "suppression.added", undefined, { channel: "email" });
  });
  revalidatePath("/parametres");
  return r;
}

