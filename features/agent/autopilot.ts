/**
 * Pilote automatique de LÉA — exécuté par le cron (et à la demande depuis l'accueil).
 * Toujours sous l'identité agent de l'organisation (RLS) ; chaque étape est isolée par un savepoint
 * pour qu'un dossier en erreur n'interrompe pas les autres.
 *
 *   1. recalcul des opportunités
 *   2. pour les meilleures opportunités : offre → supports PDF + Excel contrôlés → email → envoi (si autorisé)
 *   3. envoi des messages programmés arrivés à échéance
 *   4. relances des offres sans réponse
 */
import type { Db } from "@/lib/database/client";
import { toIsoDate } from "@/lib/utils";
import { runOpportunityScan } from "@/features/opportunities/service";
import { createOfferFromOpportunity, OfferNotBuildable } from "@/features/offers/service";
import { generateOfferAssets, autoApproveAssets } from "@/features/creative-studio/service";
import { dispatchMessage } from "@/features/conversations/dispatch";
import { loadAutonomy } from "@/features/settings/policy-repo";
import { draftFollowup, draftOfferEmail } from "./lea";

export type AutopilotReport = {
  skipped?: string;
  opportunities?: { created: number; updated: number; expired: number };
  offersCreated: number;
  offersPendingApproval: number;
  emailsSent: number;
  emailsScheduled: number;
  emailsPendingApproval: number;
  followupsSent: number;
  scheduledSent: number;
  skippedCustomers: number;
  errors: string[];
};

const AUTOPILOT_TYPES = ["reorder", "dormant_customer", "campaign"];

async function step<T>(db: Db, name: string, fn: () => Promise<T>, errors: string[]): Promise<T | null> {
  await db.query(`savepoint ${name}`);
  try {
    const r = await fn();
    await db.query(`release savepoint ${name}`);
    return r;
  } catch (e) {
    await db.query(`rollback to savepoint ${name}`);
    errors.push(e instanceof Error ? e.message : String(e));
    return null;
  }
}

export async function runAutopilot(db: Db, orgId: string, now = new Date()): Promise<AutopilotReport> {
  const report: AutopilotReport = { offersCreated: 0, offersPendingApproval: 0, emailsSent: 0, emailsScheduled: 0, emailsPendingApproval: 0, followupsSent: 0, scheduledSent: 0, skippedCustomers: 0, errors: [] };
  const cfg = await loadAutonomy(db, orgId);
  if (cfg.paused) return { ...report, skipped: "LÉA est suspendue." };
  if (cfg.level === "supervised") return { ...report, skipped: "Mode supervisé : LÉA prépare mais n'envoie rien seule." };
  const today = toIsoDate(now);

  // 1. Opportunités
  const scan = await runOpportunityScan(db, orgId, today);
  report.opportunities = { created: scan.created, updated: scan.updated, expired: scan.expired };

  // 2. Offres préparées et envoyées par LÉA (dans la limite quotidienne)
  const doneToday = (await db.query<{ n: number }>(
    `select count(*)::int n from offers where organization_id = $1 and created_by_agent and created_at >= date_trunc('day', $2::timestamptz)`, [orgId, now.toISOString()])).rows[0]!.n;
  const budget = Math.max(0, cfg.dailyOfferLimit - doneToday);
  const candidates = budget
    ? (await db.query<{ id: string; customer_id: string }>(
        `select o.id, o.customer_id from opportunities o
         where o.organization_id = $1 and o.status = 'open' and o.offer_id is null and o.type = any($2::opportunity_type[])
           and not exists (select 1 from offers x where x.customer_id = o.customer_id and x.status in ('pending_approval','approved','sent','negotiation'))
         order by o.priority desc, o.estimated_value_ht desc nulls last limit $3`, [orgId, AUTOPILOT_TYPES, budget * 3])).rows
    : [];
  const seenCustomers = new Set<string>();
  for (const c of candidates) {
    if (report.offersCreated >= budget) break;
    if (seenCustomers.has(c.customer_id)) continue;
    seenCustomers.add(c.customer_id);
    // Destinataire joignable : email ou WhatsApp, avec consentement et sans opposition.
    const reachable = (await db.query(
      `select 1 from customer_contacts cc join contacts ct on ct.id = cc.contact_id
       where cc.customer_id = $1 and cc.can_receive_offers
         and ((ct.email is not null and ct.consent_email
               and not exists (select 1 from suppression_entries s where s.organization_id = $2 and s.channel = 'email' and s.address = lower(ct.email)))
           or (ct.consent_whatsapp and coalesce(ct.mobile, ct.phone) is not null
               and not exists (select 1 from suppression_entries s where s.organization_id = $2 and s.channel = 'whatsapp' and s.address = ct.mobile)))
       limit 1`, [c.customer_id, orgId])).rowCount;
    if (!reachable) {
      report.skippedCustomers++;
      continue;
    }
    // Résultat compté seulement si toute l'étape a réussi (sinon savepoint annulé).
    const outcome = await step(db, "offer", async () => {
      let offer;
      try {
        offer = await createOfferFromOpportunity(db, orgId, null, c.id, today, { reason: "Offre préparée et validée automatiquement par LÉA (politique respectée).", maxTotalHt: cfg.maxOfferHt });
      } catch (e) {
        if (!(e instanceof OfferNotBuildable)) throw e;
        await db.query(`insert into agent_decisions (organization_id, customer_id, decision_type, rationale, payload) values ($1,$2,'offer_not_buildable',$3,$4)`, [orgId, c.customer_id, e.message, { opportunityId: c.id }]);
        return "not_buildable" as const;
      }
      if (!offer.autoApproved) return "pending_approval" as const;
      await generateOfferAssets(db, orgId, null, offer.offerId, ["offer_pdf", "offer_excel"]);
      await autoApproveAssets(db, orgId, offer.offerId);
      const email = await draftOfferEmail(db, orgId, offer.offerId, { userId: null }, { autonomous: true, now });
      return email.dispatch?.status ?? ("email_pending" as const);
    }, report.errors);
    if (!outcome) continue;
    if (outcome === "not_buildable") {
      report.skippedCustomers++;
      continue;
    }
    report.offersCreated++;
    if (outcome === "pending_approval") report.offersPendingApproval++;
    else if (outcome === "sent") report.emailsSent++;
    else if (outcome === "scheduled") report.emailsScheduled++;
    else report.emailsPendingApproval++;
  }

  // 3. Messages programmés arrivés à échéance
  report.scheduledSent = await sendDueMessages(db, orgId, now, report.errors);

  // 4. Relances
  const due = (await db.query<{ id: string }>(
    `select id from followup_tasks where organization_id = $1 and kind = 'followup' and status = 'pending' and due_at <= $2 order by due_at limit 100`, [orgId, now.toISOString()])).rows;
  for (const t of due) {
    const r = await step(db, "followup", () => draftFollowup(db, orgId, t.id, { now }), report.errors);
    if (r?.dispatch?.status === "sent") report.followupsSent++;
  }

  await db.query(
    `insert into agent_runs (organization_id, kind, status, input, output, provider, started_at, finished_at) values ($1,'autopilot','succeeded',$2,$3,'deterministic',$4,now())`,
    [orgId, { level: cfg.level, now: now.toISOString() }, report, now.toISOString()],
  );
  return report;
}

/** Envoie les messages validés (par LÉA ou un humain) dont l'heure d'envoi programmée est passée. */
export async function sendDueMessages(db: Db, orgId: string, now = new Date(), errors: string[] = []): Promise<number> {
  const due = (await db.query<{ id: string }>(
    `select id from messages where organization_id = $1 and status = 'approved' and scheduled_at is not null and scheduled_at <= $2 order by scheduled_at limit 200`, [orgId, now.toISOString()])).rows;
  let sent = 0;
  for (const m of due) {
    const r = await step(db, "due", () => dispatchMessage(db, orgId, m.id, { type: "agent" }, { autonomous: true, now }), errors);
    if (r?.status === "sent") sent++;
  }
  return sent;
}
