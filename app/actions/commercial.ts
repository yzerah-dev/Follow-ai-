"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext, type AppContext } from "@/lib/auth/context";
import { canWrite, canManage, isAdmin, ForbiddenError, type MemberRole } from "@/lib/auth/roles";
import { withUser, withAgent, type Db } from "@/lib/database/client";
import { rateLimit } from "@/lib/security/rate-limit";
import { audit } from "@/lib/security/audit";
import { env } from "@/lib/env";
import { toIsoDate } from "@/lib/utils";
import { createOfferFromSelection } from "@/features/selection/offer";
import { applyLineChanges, searchProductsForOffer, StaleRevisionError } from "@/features/offers/editor";
import { enqueueAssetsJob, runAssetsJob, JOB_KINDS } from "@/features/creative-studio/jobs";
import { splitCustomerTarget, saveCustomerMonths, saveSalesTarget } from "@/features/targets/repo";
import { createOfferFromOpportunity, createOfferDraft, OfferNotBuildable, suggestItemsForCustomer, decideOffer, acceptOfferAndPrepareOrder, markOfferLost } from "@/features/offers/service";
import { decideAsset } from "@/features/creative-studio/service";
import { draftOfferEmail } from "@/features/agent/lea";
import { decideMessage, sendManualMessage, simulateCustomerReply, simulateCustomerExcelReply } from "@/features/conversations/service";
import { isExcelFile } from "@/features/agent/excel-return";
import { MAX_CLIENT_EXCEL_BYTES } from "@/features/offers/client-excel";
import { runOpportunityScan } from "@/features/opportunities/service";
import { runAutopilot } from "@/features/agent/autopilot";
import { parseVoice, EXAMPLE_SITUATIONS } from "@/features/agent/voice";

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

export async function createOfferForCustomerAction(customerId: string, opts?: { maxLines?: number; budgetHt?: string | null }) {
  let offerId = "";
  const r = await run(canWrite, async (db, ctx) => {
    const id = uuid.parse(customerId);
    const o = z.object({ maxLines: z.number().int().min(1).max(1000).optional(), budgetHt: z.string().regex(/^\d+([.,]\d{1,2})?$/).nullable().optional() }).parse(opts ?? {});
    // Moteur de sélection grands catalogues : réassorts, permanents, retours en stock, compléments, nouveautés.
    try {
      offerId = (await createOfferFromSelection(db, ctx.org.organizationId, { userId: ctx.userId }, id, toIsoDate(new Date()), { maxLines: o.maxLines ?? 200, budgetHt: o.budgetHt?.replace(",", ".") ?? null })).offerId;
    } catch (e) {
      if (!(e instanceof OfferNotBuildable)) throw e;
      const items = await suggestItemsForCustomer(db, id, null);
      if (!items.length) throw new Error("Aucun historique d'achat : ajoutez des produits manuellement.");
      offerId = (await createOfferDraft(db, ctx.org.organizationId, { userId: ctx.userId }, { customerId: id, items, source: "lea", arguments: ["Sélection basée sur les références habituelles du client."] })).offerId;
    }
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

/**
 * « Créer mes supports » : la génération part en tâche de fond (progression, reprise sur erreur).
 * La réponse est immédiate ; le panneau suit l'avancement via /api/jobs/[id].
 */
export async function generateAssetsAction(offerId: string, kinds: string[]): Promise<(ActionResult & { jobId?: string })> {
  const parsedKinds = z.array(z.enum(JOB_KINDS)).min(1).max(12).safeParse(kinds);
  if (!parsedKinds.success) return { ok: false, error: "Types de documents invalides." };
  let jobId = "";
  const ctx = await requireContext();
  const r = await run(canWrite, async (db) => {
    jobId = await enqueueAssetsJob(db, ctx.org.organizationId, ctx.userId, uuid.parse(offerId), parsedKinds.data);
    return `Génération lancée (${parsedKinds.data.length} document(s)).`;
  }, { key: "creative", limit: 10 });
  if (!r.ok) return r;
  after(async () => {
    await runAssetsJob(jobId, (fn) => withUser(ctx.userId, fn)).catch((e) => console.error("creative job", jobId, e));
  });
  return { ...r, jobId };
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

/** Démonstration : le client renvoie l'Excel avec ses quantités. */
export async function simulateExcelReplyAction(conversationId: string, form: FormData): Promise<ActionResult> {
  if (!env().DEMO_TOOLS) return { ok: false, error: "Outils de démonstration désactivés." };
  const file = form.get("file");
  if (!(file instanceof File) || !isExcelFile(file.name, file.type)) return { ok: false, error: "Choisissez un fichier Excel (.xlsx)." };
  if (file.size > MAX_CLIENT_EXCEL_BYTES) return { ok: false, error: "Fichier trop volumineux (3 Mo maximum)." };
  const body = z.string().max(4000).parse(form.get("body") ?? "");
  const buffer = Buffer.from(await file.arrayBuffer());
  const r = await run(canWrite, async (db, ctx) => {
    const res = await simulateCustomerExcelReply(db, ctx.org.organizationId, ctx.userId, uuid.parse(conversationId), { filename: file.name, buffer }, body);
    return `Excel reçu — ${res.summary}`;
  }, { key: "simulate", limit: 20 });
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
  meetingIntervalDays: z.coerce.number().int().min(30).max(1000),
  contactCooldownDays: z.coerce.number().int().min(0).max(90),
  refusalCooldownDays: z.coerce.number().int().min(0).max(365),
  targetAlertPct: z.coerce.number().min(0).max(100),
});

export async function updateSettingsAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await run(isAdmin, async (db, ctx) => {
    const s = settingsSchema.parse(Object.fromEntries(form));
    await db.query(
      `update organization_settings set max_auto_discount_pct = $2, dormant_after_days = $3, reorder_lookahead_days = $4, offer_validity_days = $5,
         brand = brand || jsonb_build_object('primaryColor', $6::text, 'companyName', $7::text),
         meeting_interval_days = $8, contact_cooldown_days = $9, refusal_cooldown_days = $10, target_alert_pct = $11 where organization_id = $1`,
      [ctx.org.organizationId, s.maxAutoDiscountPct, s.dormantAfterDays, s.reorderLookaheadDays, s.offerValidityDays, s.primaryColor, s.companyName,
        s.meetingIntervalDays, s.contactCooldownDays, s.refusalCooldownDays, s.targetAlertPct],
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


const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const autonomySchema = z.object({
  autonomyLevel: z.enum(["supervised", "semi_autonomous", "autonomous"]),
  discountWithoutApproval: z.enum(["on"]).optional(),
  autonomousMaxOfferHt: z.string().trim().max(20).optional(),
  dailySendLimit: z.coerce.number().int().min(0).max(10000),
  dailyOfferLimit: z.coerce.number().int().min(0).max(1000),
  windowStart: z.string().regex(timeRe),
  windowEnd: z.string().regex(timeRe),
  followupAfterDays: z.coerce.number().int().min(1).max(60),
  maxFollowups: z.coerce.number().int().min(0).max(10),
});

export async function updateAutonomyAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await run(isAdmin, async (db, ctx) => {
    const s = autonomySchema.parse(Object.fromEntries([...form.entries()].filter(([k]) => k !== "days")));
    const days = z.array(z.coerce.number().int().min(1).max(7)).parse(form.getAll("days"));
    if (s.windowEnd <= s.windowStart) throw new Error("La fin de la plage d'envoi doit être après le début.");
    const max = s.autonomousMaxOfferHt ? z.string().regex(/^\d+([.,]\d{1,2})?$/, "Plafond invalide").parse(s.autonomousMaxOfferHt).replace(",", ".") : null;
    await db.query(
      `update organization_settings set autonomy_level = $2, require_discount_approval = $3, autonomous_max_offer_ht = $4, daily_send_limit = $5,
         daily_offer_limit = $6, send_window = $7, followup_after_days = $8, max_followups = $9 where organization_id = $1`,
      [ctx.org.organizationId, s.autonomyLevel, !s.discountWithoutApproval, max, s.dailySendLimit, s.dailyOfferLimit,
        { days: [...new Set(days)].sort(), start: s.windowStart, end: s.windowEnd }, s.followupAfterDays, s.maxFollowups],
    );
    await audit(db, ctx.org.organizationId, { type: "user", userId: ctx.userId }, "settings.autonomy_updated", undefined, { ...s, days });
    return "Autonomie de LÉA enregistrée.";
  });
  revalidatePath("/parametres");
  revalidatePath("/");
  return r;
}

export async function setAutonomyPausedAction(paused: boolean) {
  const r = await run(canManage, async (db, ctx) => {
    // Un manager peut suspendre LÉA (sécurité) ; la mise à jour passe par une fonction dédiée car les paramètres sont réservés aux admins.
    await db.query(`select app.set_autonomy_paused($1, $2)`, [ctx.org.organizationId, z.boolean().parse(paused)]);
    await audit(db, ctx.org.organizationId, { type: "user", userId: ctx.userId }, paused ? "lea.paused" : "lea.resumed");
    return paused ? "LÉA est suspendue : plus aucun envoi automatique." : "LÉA a repris le travail.";
  });
  revalidatePath("/");
  revalidatePath("/parametres");
  return r;
}

export async function runAutopilotAction() {
  const ctx = await requireContext();
  if (!canManage(ctx.org.role)) return { ok: false, error: "Réservé aux managers et administrateurs." } as ActionResult;
  if (!rateLimit(`autopilot:${ctx.userId}`, 3, 60_000).ok) return { ok: false, error: "Patientez une minute avant de relancer LÉA." } as ActionResult;
  try {
    // LÉA travaille sous SON identité (agent, RLS de l'organisation), pas celle de l'utilisateur.
    const rep = await withAgent(ctx.org.organizationId, (db) => runAutopilot(db, ctx.org.organizationId));
    await withUser(ctx.userId, (db) => audit(db, ctx.org.organizationId, { type: "user", userId: ctx.userId }, "lea.autopilot_triggered", undefined, { offers: rep.offersCreated, sent: rep.emailsSent }));
    revalidatePath("/");
    if (rep.skipped) return { ok: false, error: rep.skipped } as ActionResult;
    return {
      ok: true,
      message: `LÉA a préparé ${rep.offersCreated} offre(s) : ${rep.emailsSent} email(s) envoyé(s), ${rep.emailsScheduled} programmé(s), ${rep.offersPendingApproval + rep.emailsPendingApproval} en attente de validation, ${rep.followupsSent} relance(s).${rep.errors.length ? ` ${rep.errors.length} dossier(s) bloqué(s) par les contrôles.` : ""}`,
    } as ActionResult;
  } catch (e) {
    console.error(e);
    return { ok: false, error: "LÉA n'a pas pu terminer son travail." } as ActionResult;
  }
}

export async function sendManualReplyAction(conversationId: string, body: string, subject?: string) {
  const r = await run(canWrite, async (db, ctx) => {
    const res = await sendManualMessage(db, ctx.org.organizationId, ctx.userId, uuid.parse(conversationId), {
      body: z.string().min(1).max(8000).parse(body),
      subject: subject ? z.string().max(160).parse(subject) : null,
    });
    return res.status === "sent" ? (res.simulated ? "Message envoyé (simulation)." : "Message envoyé.") : "Message programmé.";
  }, { key: "manual", limit: 30 });
  revalidatePath(`/conversations/${conversationId}`);
  revalidatePath("/conversations");
  return r;
}

const targetSchema = z.object({
  customerId: z.uuid(),
  periodType: z.enum(["year", "month"]),
  targetHt: z.string().trim().regex(/^\d{1,9}([.,]\d{1,2})?$/, "Montant invalide"),
});

/** Mission 6 : objectif de CA d'un client pour l'année ou le mois en cours (fixé par un humain). */
export async function setCustomerTargetAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = targetSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: "Objectif invalide : indiquez un montant HT." };
  const r = await run(canWrite, async (db, ctx) => {
    const { customerId, periodType } = parsed.data;
    const amount = parsed.data.targetHt.replace(",", ".");
    const today = toIsoDate(new Date());
    const periodStart = periodType === "year" ? `${today.slice(0, 4)}-01-01` : `${today.slice(0, 7)}-01`;
    await db.query(
      `insert into customer_targets (organization_id, customer_id, period_type, period_start, target_ht, created_by) values ($1,$2,$3,$4,$5,$6)
       on conflict (organization_id, customer_id, period_type, period_start) do update set target_ht = excluded.target_ht`,
      [ctx.org.organizationId, customerId, periodType, periodStart, amount, ctx.userId],
    );
    await audit(db, ctx.org.organizationId, { type: "user", userId: ctx.userId }, "customer.target_set", { type: "customer", id: customerId }, { periodType, periodStart, amount });
    // Recalcul immédiat : le plan d'accélération apparaît si le client est en retard.
    await runOpportunityScan(db, ctx.org.organizationId, today, ctx.userId);
    return "Objectif enregistré.";
  });
  revalidatePath(`/clients/${parsed.data.customerId}`);
  return r;
}

/** Respect des préférences : le client ne souhaite plus être sollicité (ou de nouveau). */
export async function setDoNotSolicitAction(customerId: string, value: boolean) {
  const r = await run(canWrite, async (db, ctx) => {
    await db.query(`update customers set do_not_solicit = $3 where id = $1 and organization_id = $2`, [uuid.parse(customerId), ctx.org.organizationId, z.boolean().parse(value)]);
    await audit(db, ctx.org.organizationId, { type: "user", userId: ctx.userId }, value ? "customer.do_not_solicit" : "customer.solicit_allowed", { type: "customer", id: customerId });
    await runOpportunityScan(db, ctx.org.organizationId, toIsoDate(new Date()), ctx.userId);
    return value ? "LÉA ne sollicitera plus ce client." : "Sollicitations réactivées.";
  });
  revalidatePath(`/clients/${customerId}`);
  return r;
}

const voiceFormSchema = z.object({
  tone: z.enum(["warm", "dynamic", "formal", "expert"]),
  length: z.enum(["short", "medium"]),
  whatsappEmojis: z.string().optional(),
  assistantTitle: z.string().trim().min(2).max(80),
  styleNotes: z.string().trim().max(2000).default(""),
  defaultChannel: z.enum(["email", "whatsapp"]),
  followup1: z.enum(["same", "email", "whatsapp"]),
  followup2: z.enum(["same", "email", "whatsapp"]),
});

/** Voix de LÉA et canaux : forme des messages uniquement (jamais les prix, remises ou faits). */
export async function updateVoiceAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await run(isAdmin, async (db, ctx) => {
    const s = voiceFormSchema.parse(Object.fromEntries(form.entries()));
    if (/\d+\s?%|\d+[.,]?\d*\s?€/.test(s.styleNotes)) throw new Error("Les consignes de style ne doivent pas contenir de chiffres (prix, remises, marges) : LÉA les tire des données.");
    // Les messages modèles se gèrent à part : on les conserve.
    const current = parseVoice((await db.query<{ brand_voice: unknown }>(`select brand_voice from organization_settings where organization_id = $1`, [ctx.org.organizationId])).rows[0]?.brand_voice);
    const voice = { tone: s.tone, length: s.length, whatsappEmojis: s.whatsappEmojis === "on", assistantTitle: s.assistantTitle, styleNotes: s.styleNotes, examples: current.examples };
    // Relances : un canal explicite par rang ; « même canal » en fin de liste est simplement omis.
    const plan = [s.followup1, s.followup2];
    while (plan.length && plan[plan.length - 1] === "same") plan.pop();
    if (plan.includes("same")) throw new Error("Choisissez un canal pour la 1re relance si la 2e en a un.");
    await db.query(`update organization_settings set brand_voice = $2, default_channel = $3, followup_channels = $4 where organization_id = $1`,
      [ctx.org.organizationId, voice, s.defaultChannel, plan]);
    await audit(db, ctx.org.organizationId, { type: "user", userId: ctx.userId }, "settings.voice_updated", undefined, { ...voice, defaultChannel: s.defaultChannel, followupChannels: plan });
    return "Voix de LÉA enregistrée.";
  });
  revalidatePath("/parametres");
  return r;
}

const exampleFormSchema = z.object({ situation: z.enum(EXAMPLE_SITUATIONS), channel: z.enum(["whatsapp", "email"]), text: z.string().trim().min(20, "Message trop court.").max(1500) });

/** « Former LÉA » : ajoute un message modèle (ton et structure uniquement ; les chiffres viennent toujours des données). */
export async function addVoiceExampleAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const r = await run(isAdmin, async (db, ctx) => {
    const s = exampleFormSchema.parse(Object.fromEntries(form.entries()));
    const row = (await db.query<{ brand_voice: unknown }>(`select brand_voice from organization_settings where organization_id = $1`, [ctx.org.organizationId])).rows[0];
    const v = parseVoice(row?.brand_voice);
    if (v.examples.length >= 30) throw new Error("30 messages modèles maximum : supprimez-en un d'abord.");
    const example = { id: crypto.randomUUID(), ...s };
    await db.query(`update organization_settings set brand_voice = $2 where organization_id = $1`, [ctx.org.organizationId, { ...v, examples: [...v.examples, example] }]);
    await audit(db, ctx.org.organizationId, { type: "user", userId: ctx.userId }, "settings.voice_example_added", undefined, { situation: s.situation, channel: s.channel });
    return "Message modèle ajouté : LÉA s'en inspire pour son ton.";
  });
  revalidatePath("/parametres");
  return r;
}

export async function removeVoiceExampleAction(id: string): Promise<ActionResult> {
  const r = await run(isAdmin, async (db, ctx) => {
    const row = (await db.query<{ brand_voice: unknown }>(`select brand_voice from organization_settings where organization_id = $1`, [ctx.org.organizationId])).rows[0];
    const v = parseVoice(row?.brand_voice);
    await db.query(`update organization_settings set brand_voice = $2 where organization_id = $1`, [ctx.org.organizationId, { ...v, examples: v.examples.filter((e) => e.id !== id) }]);
    await audit(db, ctx.org.organizationId, { type: "user", userId: ctx.userId }, "settings.voice_example_removed", undefined, { id });
    return "Message modèle supprimé.";
  });
  revalidatePath("/parametres");
  return r;
}

/**
 * Déclaration par l'entreprise du consentement de ses clients existants (e-mail et WhatsApp), tracée dans l'audit.
 * L'entreprise reste responsable de cette déclaration ; tout client peut se désinscrire (« STOP ») à tout moment.
 */
export async function declareExistingConsentAction() {
  return run(isAdmin, async (db, ctx) => {
    const r = await db.query<{ email: number; wa: number }>(
      `with upd as (
         update contacts set consent_email = consent_email or email is not null,
                             consent_whatsapp = consent_whatsapp or coalesce(mobile, phone) is not null,
                             consent_source = coalesce(consent_source, 'declared_by_organization'), consent_at = coalesce(consent_at, now())
         where organization_id = $1 and (not consent_email and email is not null or not consent_whatsapp and coalesce(mobile, phone) is not null)
         returning (email is not null) as e, (coalesce(mobile, phone) is not null) as w)
       select count(*) filter (where e)::int as email, count(*) filter (where w)::int as wa from upd`, [ctx.org.organizationId]);
    const n = r.rows[0]!;
    await audit(db, ctx.org.organizationId, { type: "user", userId: ctx.userId }, "consent.declared_existing_customers", undefined, n);
    return `Consentement déclaré : ${n.email} contact(s) e-mail, ${n.wa} contact(s) WhatsApp mis à jour. Les listes d'opposition restent appliquées.`;
  });
}

const lineChangeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("update"), productId: z.uuid(), quantity: z.string().max(16).optional(), discountPct: z.string().max(8).optional() }),
  z.object({ op: z.literal("remove"), productId: z.uuid() }),
  z.object({ op: z.literal("add"), productId: z.uuid(), quantity: z.string().max(16).optional() }),
]);

export type SaveLinesResult =
  | { ok: true; revision: number; totals: { subtotalHt: string; totalHt: string; totalVat: string; totalTtc: string; lines: number }; rejected: { productId: string; reason: string }[]; statusReset: boolean }
  | { ok: false; error: string; stale?: boolean };

/** Sauvegarde automatique de l'éditeur d'offre : prix, colisage et remises recalculés côté serveur. */
export async function saveOfferLinesAction(offerId: string, revision: number, changes: unknown[]): Promise<SaveLinesResult> {
  const ctx = await requireContext();
  if (!canWrite(ctx.org.role)) return { ok: false, error: "Action non autorisée." };
  if (!rateLimit(`offer-lines:${ctx.userId}`, 120, 60_000).ok) return { ok: false, error: "Trop de sauvegardes en peu de temps, réessayez dans un instant." };
  const parsed = z.object({ offerId: z.uuid(), revision: z.number().int().min(1), changes: z.array(lineChangeSchema).min(1).max(2000) }).safeParse({ offerId, revision, changes });
  if (!parsed.success) return { ok: false, error: "Modifications invalides." };
  try {
    const r = await withUser(ctx.userId, (db) => applyLineChanges(db, ctx.org.organizationId, ctx.userId, parsed.data.offerId, parsed.data.revision, parsed.data.changes));
    if (r.applied) revalidatePath(`/offres/${offerId}`);
    return { ok: true, revision: r.revision, totals: r.totals, rejected: r.rejected, statusReset: r.statusReset };
  } catch (e) {
    if (e instanceof StaleRevisionError) return { ok: false, error: e.message, stale: true };
    if (e instanceof Error && !/^(relation|column|syntax)/.test(e.message)) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Une erreur est survenue." };
  }
}

export async function searchOfferProductsAction(offerId: string, q: string) {
  const ctx = await requireContext();
  if (!z.uuid().safeParse(offerId).success) return [];
  return withUser(ctx.userId, (db) => searchProductsForOffer(db, ctx.org.organizationId, offerId, String(q).slice(0, 60)));
}

/** Reprise manuelle d'une génération en échec : seules les étapes manquantes sont refaites. */
export async function resumeJobAction(jobId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!canWrite(ctx.org.role) || !z.uuid().safeParse(jobId).success) return { ok: false, error: "Action non autorisée." };
  const exists = await withUser(ctx.userId, async (db) => (await db.query(`select 1 from creative_jobs where id = $1 and organization_id = $2 and status = 'failed'`, [jobId, ctx.org.organizationId])).rowCount);
  if (!exists) return { ok: false, error: "Aucune génération en échec à reprendre." };
  await withUser(ctx.userId, (db) => db.query(`update creative_jobs set attempts = least(attempts, 2) where id = $1`, [jobId]));
  after(async () => { await runAssetsJob(jobId, (fn) => withUser(ctx.userId, fn)).catch((e) => console.error("creative job", jobId, e)); });
  return { ok: true, message: "Reprise lancée." };
}

/** Objectifs mensuels du client répartis selon la saisonnalité N-1 (les mois saisis à la main sont conservés). */
export async function splitCustomerTargetAction(customerId: string): Promise<ActionResult> {
  const r = await run(canWrite, async (db, ctx) => {
    const res = await splitCustomerTarget(db, ctx.org.organizationId, ctx.userId, uuid.parse(customerId), Number(toIsoDate(new Date()).slice(0, 4)));
    return res.source === "seasonality" ? "Objectifs mensuels répartis selon la saisonnalité N-1." : "Pas d'historique N-1 : objectif réparti à parts égales.";
  });
  revalidatePath(`/clients/${customerId}`);
  return r;
}

export async function saveCustomerMonthsAction(customerId: string, months: (string | null)[]): Promise<ActionResult> {
  const parsed = z.array(z.string().max(16).nullable()).length(12).safeParse(months);
  if (!parsed.success) return { ok: false, error: "Objectifs mensuels invalides." };
  const r = await run(canWrite, async (db, ctx) => {
    await saveCustomerMonths(db, ctx.org.organizationId, ctx.userId, uuid.parse(customerId), Number(toIsoDate(new Date()).slice(0, 4)), parsed.data);
    return "Objectifs mensuels enregistrés.";
  });
  revalidatePath(`/clients/${customerId}`);
  return r;
}

/** Objectif annuel de l'entreprise ou d'un portefeuille commercial (gestion uniquement). */
export async function saveSalesTargetAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = z.object({ scope: z.enum(["company", "portfolio"]), ownerUserId: z.string().optional(), targetHt: z.string().regex(/^\d+([.,]\d{1,2})?$/) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: "Objectif invalide : indiquez un montant HT." };
  const r = await run(canManage, async (db, ctx) => {
    const owner = parsed.data.scope === "portfolio" ? uuid.parse(parsed.data.ownerUserId) : null;
    await saveSalesTarget(db, ctx.org.organizationId, ctx.userId, { scope: parsed.data.scope, ownerUserId: owner, year: Number(toIsoDate(new Date()).slice(0, 4)), targetHt: parsed.data.targetHt.replace(",", ".") });
    return "Objectif enregistré.";
  });
  revalidatePath("/parametres");
  revalidatePath("/");
  return r;
}
