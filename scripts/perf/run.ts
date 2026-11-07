/**
 * Banc de performance « grands catalogues » (LOCAL UNIQUEMENT) — mesure temps, mémoire et erreurs, sous RLS (identité agent).
 * Prérequis : npx tsx scripts/perf/seed-large.ts  (20 000 produits, 5 000 clients, ~500 000 lignes de factures)
 * Usage    : npm run perf          → écrit docs/PERFORMANCE.md et sort en erreur si un budget est dépassé.
 */
import os from "node:os";
import { writeFileSync } from "node:fs";

process.env.DATABASE_URL ??= process.env.PERF_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/follow_ai_perf";
process.env.SESSION_SECRET ??= "perf-session-secret-at-least-32-characters";
process.env.STORAGE_LOCAL_DIR ??= "./storage-perf";
process.env.LLM_PROVIDER ??= "mock";

const { withAgent, withPrivileged, withUser } = await import("../../lib/database/client");
const { runOpportunityScan } = await import("../../features/opportunities/service");
const { selectForCustomer } = await import("../../features/selection/pipeline");
const { createOfferFromSelection } = await import("../../features/selection/offer");
const { createOfferDraft } = await import("../../features/offers/service");
const { loadEditorLines, applyLineChanges } = await import("../../features/offers/editor");
const { enqueueAssetsJob, runAssetsJob, jobStatus } = await import("../../features/creative-studio/jobs");
const { loadCustomerCoverage } = await import("../../features/analytics/coverage-repo");

const TODAY = "2026-11-06";
type Row = { name: string; volume: string; ms: number; peakMb: number; heapMb: number; errors: number; budgetMs: number; note?: string };
const rows: Row[] = [];
let peak = 0;
let heapPeak = 0;
const sampler = setInterval(() => { const m = process.memoryUsage(); peak = Math.max(peak, m.rss); heapPeak = Math.max(heapPeak, m.heapUsed); }, 25);

async function measure<T>(name: string, volume: string, budgetMs: number, fn: () => Promise<T>, note?: (r: T) => string): Promise<T | null> {
  global.gc?.();
  peak = process.memoryUsage().rss;
  const heapBase = process.memoryUsage().heapUsed;
  heapPeak = heapBase;
  const t = performance.now();
  let errors = 0;
  let result: T | null = null;
  try { result = await fn(); } catch (e) { errors++; console.error(`✗ ${name}:`, e instanceof Error ? e.message : e); }
  const ms = Math.round(performance.now() - t);
  peak = Math.max(peak, process.memoryUsage().rss);
  heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
  const row = { name, volume, ms, peakMb: Math.round(peak / 1e6), heapMb: Math.max(0, Math.round((heapPeak - heapBase) / 1e6)), errors, budgetMs, note: result !== null && note ? note(result) : undefined };
  rows.push(row);
  console.log(`${ms <= budgetMs && !errors ? "✓" : "✗"} ${name.padEnd(46)} ${String(ms).padStart(7)} ms  ${String(row.heapMb).padStart(5)} Mo tas  ${row.note ?? ""}`);
  return result;
}

const org = await withPrivileged(async (db) => (await db.query<{ id: string }>(`select id from organizations where slug = 'perf'`)).rows[0]?.id);
if (!org) throw new Error("Jeu de charge absent : lancez d'abord scripts/perf/seed-large.ts");
const volumes = await withPrivileged(async (db) => (await db.query<{ p: number; c: number; i: number; l: number }>(
  `select (select count(*) from products where organization_id = $1)::int p, (select count(*) from customers where organization_id = $1)::int c,
          (select count(*) from invoices where organization_id = $1)::int i, (select count(*) from invoice_lines where organization_id = $1)::int l`, [org])).rows[0]!);
const pg = await withPrivileged(async (db) => (await db.query<{ v: string }>(`select current_setting('server_version') as v`)).rows[0]!.v);
console.log(`Volumes : ${volumes.p} produits, ${volumes.c} clients, ${volumes.i} factures, ${volumes.l} lignes — PostgreSQL ${pg}, ${os.cpus().length} vCPU, ${Math.round(os.totalmem() / 1e9)} Go`);
const ag = <T>(fn: Parameters<typeof withAgent<T>>[1]) => withAgent<T>(org, fn);

// 1. Analyse complète de l'organisation (6 missions, tous les clients)
await measure("Analyse des opportunités (organisation entière)", `${volumes.c} clients · ${volumes.l} lignes`, 60_000,
  () => ag((db) => runOpportunityScan(db, org, TODAY)), (r) => `${r.candidates} opportunités`);

// 2. Moteur de sélection : grands comptes (~1 200 lignes d'historique) et magasins
const bigs = await withPrivileged(async (db) => (await db.query<{ id: string }>(`select id from customers where organization_id = $1 and legal_name like 'Grand compte%' order by external_code limit 20`, [org])).rows.map((r) => r.id));
const smalls = await withPrivileged(async (db) => (await db.query<{ id: string }>(`select id from customers where organization_id = $1 and legal_name like 'Magasin%' order by external_code limit 20`, [org])).rows.map((r) => r.id));
for (const [label, list] of [["grands comptes", bigs], ["magasins", smalls]] as const) {
  const times: number[] = [];
  let lines = 0;
  await measure(`Sélection — 20 ${label} (total)`, `20 clients`, 20 * 2_000, async () => {
    for (const c of list) { const t = performance.now(); const s = await ag((db) => selectForCustomer(db, org, c, TODAY, { maxLines: 500 })); times.push(performance.now() - t); lines += s.lines.length; }
    return times;
  }, (t) => { const s = [...t].sort((a, b) => a - b); return `moyenne ${Math.round(s.reduce((a, b) => a + b, 0) / s.length)} ms · p95 ${Math.round(s[Math.floor(s.length * 0.95)] ?? s.at(-1)!)} ms · ${Math.round(lines / s.length)} lignes/client`; });
}
await measure("Offre complète par le moteur (grand compte)", "jusqu'à 500 lignes", 3_000,
  () => ag((db) => createOfferFromSelection(db, org, null, bigs[0]!, TODAY, { maxLines: 500 })), (r) => `${r.draft.lines.length} lignes`);
await measure("Couverture de stock (grand compte)", "400 références", 2_000, () => ag((db) => loadCustomerCoverage(db, org, bigs[0]!, TODAY)), (r) => `${r.rows.length} références`);

// 3. Offres de 200 et 500 lignes, édition, générations
const productPool = await withPrivileged(async (db) => (await db.query<{ id: string }>(
  `select id from products where organization_id = $1 and availability = 'in_stock' and sale_price_ht is not null order by reference limit 500`, [org])).rows.map((r) => r.id));
for (const n of [200, 500]) {
  const offer = await measure(`Création d'une offre de ${n} lignes`, `${n} lignes`, n * 10, () => ag((db) => createOfferDraft(db, org, null, {
    customerId: bigs[1]!, source: "lea", today: TODAY, items: productPool.slice(0, n).map((productId, k) => ({ productId, suggestedQty: String(6 + (k % 4) * 6), meta: { recommendationType: "reorder", confidence: "medium" } })),
    autoApprove: { reason: "perf" },
  })), (r) => `${r.draft.lines.length} lignes · ${r.draft.totalHt} € HT`);
  if (!offer) continue;
  const lines = await measure(`Éditeur — chargement (${n} lignes)`, `${n} lignes`, 1_500, () => ag((db) => loadEditorLines(db, offer.offerId)), (r) => `${r.length} lignes`);
  if (lines) {
    await measure(`Éditeur — modification en masse (${n} lignes)`, `${n} changements`, n * 10, async () => {
      const rev = (await ag(async (db) => (await db.query<{ revision: number }>(`select revision from offers where id = $1`, [offer.offerId])).rows[0]!.revision));
      // Modification faite par un utilisateur (propriétaire de l'organisation), sous sa propre RLS.
      const owner = await withPrivileged(async (db) => (await db.query<{ user_id: string }>(`select user_id from organization_members where organization_id = $1 limit 1`, [org])).rows[0]!.user_id);
      return withUser(owner, (db) => applyLineChanges(db, org, owner, offer.offerId, rev, lines.map((l) => ({ op: "update" as const, productId: l.productId, quantity: String(Number(l.quantity) * 2) }))));
    }, (r) => `${r.applied} modifications · révision ${r.revision}`);
  }
  for (const kinds of n === 200 ? [["offer_excel"], ["offer_pdf"], ["catalog"], ["synthesis_pdf", "priority_pdf", "email_txt"], ["coverage_excel"]] : [["offer_excel"], ["offer_pdf"], ["catalog"]]) {
    await measure(`Génération asynchrone ${kinds.join(" + ")} (${n} lignes)`, `${n} lignes`, n * 100, async () => {
      const jobId = await ag((db) => enqueueAssetsJob(db, org, null, offer.offerId, kinds as never));
      const r = await runAssetsJob(jobId, (fn) => ag(fn));
      if (r.status !== "succeeded") throw new Error(r.error ?? r.status);
      const s = await ag((db) => jobStatus(db, org, jobId));
      const sizes = await ag(async (db) => (await db.query<{ filename: string; byte_size: number }>(`select filename, byte_size from generated_assets where creative_job_id = $1`, [jobId])).rows);
      return { s, sizes };
    }, (r) => r.sizes.map((x) => `${x.filename} ${(x.byte_size / 1e6).toFixed(1)} Mo`).join(", "));
  }
}

// 4. Requêtes d'écran paginées (listes de 5 000 clients et 20 000 produits)
await measure("Liste produits — recherche + page de 50", "20 000 produits", 500, () => ag(async (db) => (await db.query(
  `select id, reference, name from products where organization_id = $1 and (reference ilike $2 || '%' or name ilike '%' || $2 || '%') order by reference limit 50 offset 0`, [org, "Article 19"])).rows), (r) => `${r.length} résultats`);
const { listCustomers, getCustomer } = await import("../../features/customers/queries");
await measure("Écran Clients — page 1 (tri par CA 12 mois)", "5 000 clients", 1_500, () => ag((db) => listCustomers(db, org, { page: 1 })), (r) => `${r.rows.length} / ${r.total} clients`);
await measure("Écran Clients — recherche", "5 000 clients", 1_000, () => ag((db) => listCustomers(db, org, { q: "Grand compte 1", page: 1 })), (r) => `${r.total} résultats`);
const { getHomeData } = await import("../../features/dashboard/home");
const { getDashboard, listOpportunities } = await import("../../features/dashboard/queries");
const { getLeaPerformance } = await import("../../features/dashboard/performance");
await measure("Écran Accueil (indicateurs, évolution, répartition)", `${volumes.l} lignes`, 3_000, () => ag((db) => getHomeData(db, org, TODAY)), () => "ok");
await measure("Écran Actions (tableau de bord)", "organisation", 2_000, () => ag((db) => getDashboard(db, org, TODAY)), () => "ok");
await measure("Écran Opportunités (liste triée)", "13 500 opportunités", 1_000, () => ag((db) => listOpportunities(db, org, {})), (r) => `${r.length} affichées`);
await measure("Écran Rapports (résultats par mission, 90 j)", "organisation", 3_000, () => ag((db) => getLeaPerformance(db, org, 90)), () => "ok");
await measure("Fiche client — grand compte (habitudes, missions)", "~1 200 lignes", 2_000, () => ag((db) => getCustomer(db, org, bigs[0]!, TODAY)), (r) => (r ? "chargée" : "absente"));

clearInterval(sampler);
const failed = rows.filter((r) => r.errors || r.ms > r.budgetMs);
const md = `# Performance — grands catalogues

_Mesures générées par \`npm run perf\` le ${new Date().toISOString().slice(0, 10)} (ne pas modifier à la main)._

Environnement : PostgreSQL ${pg} local, Node ${process.version}, ${os.cpus().length} vCPU, ${Math.round(os.totalmem() / 1e9)} Go de RAM (conteneur de développement).
Toutes les requêtes passent par la RLS (identité agent de l'organisation), comme en production.

Jeu de charge (\`scripts/perf/seed-large.ts\`) : **${volumes.p.toLocaleString("fr-FR")} produits**, **${volumes.c.toLocaleString("fr-FR")} clients**,
**${volumes.i.toLocaleString("fr-FR")} factures**, **${volumes.l.toLocaleString("fr-FR")} lignes de factures** sur 3 ans
(250 grands comptes à ~1 200 lignes, 4 750 magasins), 2 000 variantes, 12 500 tarifs clients, médias produits autorisés.

| Opération | Volume | Temps | Budget | Mémoire de l'opération (tas) | Pic RSS du processus | Erreurs | Détail |
|---|---|---:|---:|---:|---:|---:|---|
${rows.map((r) => `| ${r.name} | ${r.volume} | ${r.ms.toLocaleString("fr-FR")} ms | ${r.budgetMs.toLocaleString("fr-FR")} ms | ${r.heapMb} Mo | ${r.peakMb} Mo | ${r.errors} | ${r.note ?? ""} |`).join("\n")}

Résultat : ${failed.length ? `**${failed.length} budget(s) dépassé(s) ou en erreur** : ${failed.map((f) => f.name).join(", ")}.` : "**tous les budgets sont respectés, aucune erreur.**"}

Limites connues : mesures sur une machine de développement, sans charge concurrente ; « mémoire de l'opération » = pic du tas JavaScript
au-dessus du niveau de départ (après ramasse-miettes), le pic RSS est celui du processus complet (il ne redescend pas entre deux opérations) ;
les médias du jeu de charge sont 8 visuels partagés (dédupliqués dans les fichiers) : avec des photos toutes différentes, la taille des
Excel et PDF croît avec le nombre de photos ; l'analyse de l'organisation entière reste un traitement par lots (cron quotidien), pas une requête interactive.
`;
writeFileSync(new URL("../../docs/PERFORMANCE.md", import.meta.url), md);
console.log(failed.length ? `\n✗ ${failed.length} budget(s) dépassé(s)` : "\n✓ Tous les budgets sont respectés");
process.exit(failed.length ? 1 : 0);
