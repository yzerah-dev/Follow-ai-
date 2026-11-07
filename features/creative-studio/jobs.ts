/**
 * Générations lourdes asynchrones (Excel de centaines de lignes, catalogues PDF, synthèse, email).
 * - File : table creative_jobs (status queued → running → succeeded | failed), une étape par type de document.
 * - Progression : progress / total, étape courante, battement de cœur (heartbeat_at).
 * - Reprise : chaque étape réussie est mémorisée (result.done) ; une relance ne refait que les étapes manquantes.
 * - Chaque étape s'exécute dans SA transaction : la progression est visible pendant la génération.
 */
import type { Db } from "@/lib/database/client";
import { putFile, storagePath } from "@/lib/storage";
import { sha256 } from "@/lib/security/crypto";
import { audit } from "@/lib/security/audit";
import { generateOfferAssets, ASSET_KINDS, type AssetKind } from "./service";
import { composeOfferEmail } from "@/features/agent/lea";

export const JOB_KINDS = [...ASSET_KINDS, "email_txt"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export const MAX_ATTEMPTS = 3;
const STALE_MINUTES = 5;

type Exec = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
type JobRow = { id: string; organization_id: string; offer_id: string; status: string; input: { kinds: JobKind[] }; result: { done?: JobKind[] }; created_by: string | null; attempts: number };

export async function enqueueAssetsJob(db: Db, orgId: string, userId: string | null, offerId: string, kinds: JobKind[]) {
  const unique = [...new Set(kinds)];
  return (await db.query<{ id: string }>(
    `insert into creative_jobs (organization_id, kind, status, offer_id, input, total, created_by, step) values ($1,'offer_assets','queued',$2,$3,$4,$5,'En attente') returning id`,
    [orgId, offerId, { kinds: unique }, unique.length, userId])).rows[0]!.id;
}

/** Exécute (ou reprend) une tâche. Sans effet si une autre exécution la détient déjà (verrou par statut + heartbeat). */
export async function runAssetsJob(jobId: string, exec: Exec): Promise<{ status: string; error?: string }> {
  const job = await exec(async (db) => (await db.query<JobRow>(
    `update creative_jobs set status = 'running', attempts = attempts + 1, started_at = coalesce(started_at, now()), heartbeat_at = now(), error = null
     where id = $1 and (status = 'queued' or (status = 'failed' and attempts < $2) or (status = 'running' and heartbeat_at < now() - make_interval(mins => $3)))
     returning id, organization_id, offer_id, status, input, result, created_by, attempts`, [jobId, MAX_ATTEMPTS, STALE_MINUTES])).rows[0]);
  if (!job) return { status: "skipped" };
  const done = new Set(job.result.done ?? []);
  for (const kind of job.input.kinds) {
    if (done.has(kind)) continue;
    try {
      await exec(async (db) => {
        await db.query(`update creative_jobs set step = $2, heartbeat_at = now() where id = $1`, [jobId, kind]);
        if (kind === "email_txt") await generateEmailText(db, job.organization_id, job.created_by, job.offer_id, jobId);
        else await generateOfferAssets(db, job.organization_id, job.created_by, job.offer_id, [kind as AssetKind], { jobId });
        await db.query(
          `update creative_jobs set progress = progress + 1, heartbeat_at = now(), result = jsonb_set(result, '{done}', coalesce(result->'done', '[]'::jsonb) || to_jsonb($2::text)) where id = $1`,
          [jobId, kind]);
      });
      done.add(kind);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await exec((db) => db.query(`update creative_jobs set status = 'failed', error = $2, step = $3 where id = $1`, [jobId, msg.slice(0, 500), kind]));
      return { status: "failed", error: msg };
    }
  }
  await exec(async (db) => {
    await db.query(`update creative_jobs set status = 'succeeded', step = 'Terminé', finished_at = now(), heartbeat_at = now() where id = $1`, [jobId]);
    await audit(db, job.organization_id, job.created_by ? { type: "user", userId: job.created_by } : { type: "agent" }, "creative.job_succeeded", { type: "offer", id: job.offer_id }, { jobId, kinds: job.input.kinds });
  });
  return { status: "succeeded" };
}

/** Tâches à reprendre (cron) : en attente, en échec avec essais restants, ou bloquées sans battement de cœur. */
export async function pendingJobs(db: Db, limit = 20) {
  return (await db.query<{ id: string; organization_id: string }>(
    `select id, organization_id from creative_jobs
     where kind = 'offer_assets' and (status = 'queued' or (status = 'failed' and attempts < $1) or (status = 'running' and heartbeat_at < now() - make_interval(mins => $2)))
     order by created_at limit $3`, [MAX_ATTEMPTS, STALE_MINUTES, limit])).rows;
}

export async function jobStatus(db: Db, orgId: string, jobId: string) {
  const j = (await db.query<{ id: string; status: string; progress: number; total: number; step: string | null; error: string | null; attempts: number; offer_id: string }>(
    `select id, status, progress, total, step, error, attempts, offer_id from creative_jobs where id = $1 and organization_id = $2`, [jobId, orgId])).rows[0];
  if (!j) return null;
  const assets = (await db.query<{ id: string; filename: string; kind: string }>(
    `select id, filename, kind from generated_assets where creative_job_id = $1 order by created_at`, [jobId])).rows;
  return { ...j, assets };
}

/** Email personnalisé (texte) : rédigé par LÉA à partir d'un résumé de l'offre, à copier ou à envoyer depuis la conversation. */
async function generateEmailText(db: Db, orgId: string, userId: string | null, offerId: string, jobId: string) {
  const { offer, draft } = await composeOfferEmail(db, orgId, offerId, { userId });
  const data = Buffer.from(`Objet : ${draft.subject}\n\n${draft.body}\n`, "utf8");
  const version = Number((await db.query<{ n: number }>(`select count(*)::int as n from generated_assets where offer_id = $1`, [offerId])).rows[0]!.n) + 1;
  const filename = `Email-${offer.number.replace(/[^A-Za-z0-9-]/g, "")}.txt`;
  const path = storagePath(orgId, "assets", offerId, `${version}-${filename}`);
  await putFile(path, data);
  await db.query(
    `insert into generated_assets (organization_id, creative_job_id, offer_id, kind, filename, storage_path, mime_type, byte_size, sha256, is_generative, validation_status, validation_report)
     values ($1,$2,$3,'email_txt',$4,$5,'text/plain; charset=utf-8',$6,$7,false,'pending',$8)`,
    [orgId, jobId, offerId, filename, path, data.length, sha256(data), { ok: true, checks: [{ name: "Garde-fous de rédaction appliqués (remise, personnalisation, vouvoiement)", ok: true }] }]);
}
