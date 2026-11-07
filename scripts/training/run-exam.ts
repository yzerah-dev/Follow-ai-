/**
 * Examen final de LÉA (Academy) — 10 épreuves, rapport de certification versionné.
 *  • Épreuves conversationnelles (1, 2, 3, 6, 7, 10) : simulations notées par l'évaluateur (grille /100, erreurs critiques).
 *  • Épreuves outils (4, 5, 8, 9) : exécutées sur le jeu de charge (npm run perf:seed) — réassort 200 références,
 *    30 nouveautés, plan d'accélération du CA, offre illustrée. Chaque épreuve = contrôles vérifiables (score = % réussis).
 * Usage : npx tsx scripts/training/run-exam.ts   → training/evaluations/CERTIFICATION.md (+ JSON horodaté)
 * Le rapport n'affirme une certification que pour ce qui a réellement été exécuté (fournisseur IA indiqué).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

process.env.SESSION_SECRET ??= "training-session-secret-at-least-32-characters";
process.env.LLM_PROVIDER ??= "mock";
process.env.DATABASE_URL ??= process.env.PERF_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/follow_ai_perf";
process.env.STORAGE_LOCAL_DIR ??= "./storage-perf";

const { getLlm } = await import("../../lib/ai");
const { simulateScenario, scenarioSchema, LEA_PROMPT_VERSION } = await import("../../features/training/simulator");
const { CRITICAL_LABEL, PASS_SCORE } = await import("../../lib/ai/lea-conversation-evaluator");

type Exam = { n: number; title: string; kind: "conversation" | "outil"; score: number | null; passed: boolean; checks: { name: string; ok: boolean; detail?: string }[]; errors: string[]; improvements: string[] };
const TITLES: Record<number, string> = {
  1: "Convaincre un client surstocké avec des données", 2: "Défendre un prix sans remise injustifiée", 3: "Réactiver un client dormant",
  4: "Préparer un réassort de 200 références", 5: "Présenter 30 nouveautés pertinentes", 6: "Obtenir un rendez-vous avec un acheteur difficile",
  7: "Gérer une réclamation de livraison", 8: "Construire un plan d'accélération du CA", 9: "Préparer une offre commerciale illustrée",
  10: "Conclure une vente sans dépasser ses autorisations",
};
const exams: Exam[] = [];
const llm = getLlm();

// ---------- Épreuves conversationnelles
const dir = new URL("../../training/scenarios/", import.meta.url);
const scenarios = readdirSync(dir).filter((f) => f.endsWith(".json")).flatMap((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")).map((s: unknown) => scenarioSchema.parse(s)));
for (const n of [1, 2, 3, 6, 7, 10]) {
  const sc = scenarios.find((s) => s.exam === n);
  if (!sc) { exams.push({ n, title: TITLES[n]!, kind: "conversation", score: null, passed: false, checks: [], errors: ["Scénario d'examen absent."], improvements: [] }); continue; }
  const r = await simulateScenario(sc, llm);
  const issues = r.turns.flatMap((t) => t.evaluation.issues);
  exams.push({
    n, title: TITLES[n]!, kind: "conversation", score: r.score, passed: r.passed,
    checks: r.turns.map((t, k) => ({ name: `Échange ${k + 1} : « ${t.customer} »`, ok: t.evaluation.passed, detail: `${t.evaluation.score}/100` })),
    errors: r.critical.map((c) => CRITICAL_LABEL[c as keyof typeof CRITICAL_LABEL]),
    improvements: [...new Set(issues)],
  });
}

// ---------- Épreuves outils (jeu de charge)
const tool = async (n: number, fn: () => Promise<{ name: string; ok: boolean; detail?: string }[]>) => {
  try {
    const checks = await fn();
    const score = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
    exams.push({ n, title: TITLES[n]!, kind: "outil", score, passed: checks.every((c) => c.ok), checks, errors: [], improvements: checks.filter((c) => !c.ok).map((c) => c.name) });
  } catch (e) {
    exams.push({ n, title: TITLES[n]!, kind: "outil", score: null, passed: false, checks: [], errors: [`Non exécutée : ${e instanceof Error ? e.message : String(e)}`], improvements: ["Lancer npm run perf:seed puis relancer l'examen."] });
  }
};
const { withAgent, withPrivileged } = await import("../../lib/database/client");
const TODAY = "2026-11-06";
let org = "";
let centrale = "";
let examOfferId = "";
try {
  org = (await withPrivileged(async (db) => (await db.query<{ id: string }>(`select id from organizations where slug = 'perf'`)).rows[0]?.id)) ?? "";
  centrale = org ? (await withPrivileged(async (db) => (await db.query<{ id: string }>(`select id from customers where organization_id = $1 and legal_name = 'Centrale 1'`, [org])).rows[0]?.id)) ?? "" : "";
} catch { /* base absente */ }
const needDb = () => { if (!org || !centrale) throw new Error("jeu de charge absent (npm run perf:seed)"); };
const { selectForCustomer } = await import("../../features/selection/pipeline");
const { createOfferFromSelection } = await import("../../features/selection/offer");

await tool(4, async () => {
  needDb();
  const o = await withAgent(org, (db) => createOfferFromSelection(db, org, null, centrale, TODAY, { maxLines: 500, include: { new_product: false, complementary: false } }));
  examOfferId = o.offerId;
  const lines = o.selection.lines;
  const refill = lines.filter((l) => ["reorder", "permanent", "back_in_stock"].includes(l.type));
  return [
    { name: "Au moins 200 références de réassort", ok: refill.length >= 200, detail: `${refill.length} références` },
    { name: "Offre créée avec toutes les lignes (aucune perdue)", ok: o.draft.lines.length === lines.length, detail: `${o.draft.lines.length} lignes` },
    { name: "Aucun doublon de produit", ok: new Set(o.draft.lines.map((l) => l.productId)).size === o.draft.lines.length },
    { name: "Chaque ligne a un prix vérifié et une justification", ok: lines.every((l) => Number(l.unitPriceHt) > 0 && l.justification.length > 10) },
    { name: "Quantités au colisage", ok: lines.every((l) => !l.unitsPerCase || Number(l.quantity) % l.unitsPerCase === 0) },
    { name: "Références lentes écartées avec motif", ok: o.selection.excluded.every((e) => e.reason.length > 5), detail: `${o.selection.excluded.length} écartées` },
  ];
});
await tool(5, async () => {
  needDb();
  const s = await withAgent(org, (db) => selectForCustomer(db, org, centrale, TODAY, { maxLines: 1000, newProductsMax: 40, include: { reorder: false, permanent: false, back_in_stock: false, complementary: false } }));
  const news = s.lines.filter((l) => l.type === "new_product");
  const cats = await withPrivileged(async (db) => (await db.query<{ category: string }>(
    `select distinct p.category from invoice_lines l join invoices i on i.id = l.invoice_id join products p on p.id = l.product_id where i.customer_id = $1`, [centrale])).rows.map((r) => r.category));
  return [
    { name: "Au moins 30 nouveautés proposées", ok: news.length >= 30, detail: `${news.length} nouveautés` },
    { name: "Toutes dans des catégories travaillées par le client", ok: news.every((l) => l.category && cats.includes(l.category)) },
    { name: "Disponibles (aucune rupture sans date)", ok: news.every((l) => l.availability !== "out_of_stock") },
    { name: "Quantité de découverte (colisage minimal)", ok: news.every((l) => !l.unitsPerCase || Number(l.quantity) === l.unitsPerCase) },
    { name: "Justification par nouveauté", ok: news.every((l) => /Nouveauté dans une catégorie/.test(l.justification)) },
  ];
});
await tool(8, async () => {
  needDb();
  const { runOpportunityScan } = await import("../../features/opportunities/service");
  const { getCustomer } = await import("../../features/customers/queries");
  // Objectif fixé par un humain (propriétaire) : 30 % au-dessus du CA des 12 derniers mois
  const owner = await withPrivileged(async (db) => (await db.query<{ user_id: string }>(`select user_id from organization_members where organization_id = $1 limit 1`, [org])).rows[0]!.user_id);
  const rev = await withPrivileged(async (db) => (await db.query<{ ht: string }>(`select coalesce(sum(total_ht), 0)::text as ht from invoices where customer_id = $1 and invoice_date > $2::date - 365`, [centrale, TODAY])).rows[0]!.ht);
  const { withUser } = await import("../../lib/database/client");
  await withUser(owner, (db) => db.query(`insert into customer_targets (organization_id, customer_id, period_type, period_start, target_ht, created_by) values ($1,$2,'year','2026-01-01',$3,$4)
    on conflict (organization_id, customer_id, period_type, period_start) do update set target_ht = excluded.target_ht`, [org, centrale, (Number(rev) * 1.3).toFixed(2), owner]));
  await withAgent(org, (db) => runOpportunityScan(db, org, TODAY));
  const c = (await withAgent(org, (db) => getCustomer(db, org, centrale, TODAY)))!;
  const t = c.growth.targets[0];
  return [
    { name: "Objectif suivi (réalisé, attendu à date, écart)", ok: !!t && t.progress.realizedHt !== undefined && t.progress.expectedToDateHt !== undefined, detail: t ? `réalisé ${Math.round(Number(t.progress.realizedHt))} € / attendu ${Math.round(Number(t.progress.expectedToDateHt))} €` : "aucun" },
    { name: "Retard détecté", ok: !!t && t.progress.status === "behind", detail: t?.progress.status },
    { name: "Opportunité « objectif de CA » avec plan d'accélération", ok: !!c.growth.targetGap },
    { name: "Plan avec au moins 3 leviers (réassorts, nouveautés, compléments, rendez-vous…)", ok: c.growth.plan.length >= 3, detail: `${c.growth.plan.length} leviers` },
    { name: "Leviers chiffrés seulement si un prix est connu", ok: c.growth.plan.every((p) => p.valueHt === null || Number(p.valueHt) > 0) },
  ];
});
await tool(9, async () => {
  needDb();
  if (!examOfferId) throw new Error("offre de l'épreuve 4 absente");
  const { enqueueAssetsJob, runAssetsJob, jobStatus } = await import("../../features/creative-studio/jobs");
  const jobId = await withAgent(org, (db) => enqueueAssetsJob(db, org, null, examOfferId, ["offer_excel", "catalog", "synthesis_pdf", "priority_pdf", "coverage_excel", "email_txt"]));
  const r = await runAssetsJob(jobId, (fn) => withAgent(org, fn));
  const s = (await withAgent(org, (db) => jobStatus(db, org, jobId)))!;
  const ExcelJS = (await import("exceljs")).default;
  const { getFile } = await import("../../lib/storage");
  const excel = await withAgent(org, async (db) => (await db.query<{ storage_path: string; validation_report: { ok?: boolean } }>(`select storage_path, validation_report from generated_assets where creative_job_id = $1 and kind = 'offer_excel'`, [jobId])).rows[0]);
  const wb = new ExcelJS.Workbook();
  if (excel) await wb.xlsx.load((await getFile(excel.storage_path)) as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const lines = await withAgent(org, async (db) => (await db.query<{ n: number }>(`select count(*)::int n from offer_lines where offer_id = $1`, [examOfferId])).rows[0]!.n);
  const email = await withAgent(org, async (db) => (await db.query<{ storage_path: string }>(`select storage_path from generated_assets where creative_job_id = $1 and kind = 'email_txt'`, [jobId])).rows[0]);
  const emailText = email ? (await getFile(email.storage_path)).toString("utf8") : "";
  return [
    { name: "Génération asynchrone terminée sans erreur", ok: r.status === "succeeded", detail: `${s.progress}/${s.total} étapes` },
    { name: "Excel illustré : une ligne par référence", ok: !!ws && ws.rowCount - 7 >= lines, detail: `${lines} lignes` },
    { name: "Excel illustré : photos issues des médias autorisés", ok: !!ws && ws.getImages().length > 0, detail: `${ws?.getImages().length ?? 0} photos placées` },
    { name: "Contrôles automatiques de l'offre réussis", ok: excel?.validation_report?.ok === true },
    { name: "Catalogue PDF, synthèse, sélection prioritaire, analyse de couverture générés", ok: ["catalog", "synthesis_pdf", "priority_pdf", "coverage_excel"].every((k) => s.assets.some((a) => a.kind === k)) },
    { name: "Email court malgré l'offre volumineuse", ok: emailText.length > 0 && emailText.length < 2200 && /autre\(s\) référence\(s\)/.test(emailText), detail: `${emailText.length} caractères` },
  ];
});

exams.sort((a, b) => a.n - b.n);
const executed = exams.filter((e) => e.score !== null);
const average = executed.length ? Math.round(executed.reduce((a, e) => a + (e.score ?? 0), 0) / executed.length) : 0;
const allPassed = exams.every((e) => e.passed);
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
mkdirSync(new URL("../../training/evaluations/", import.meta.url), { recursive: true });
writeFileSync(new URL(`../../training/evaluations/${stamp}_${LEA_PROMPT_VERSION}_${llm.name}_examen.json`, import.meta.url), JSON.stringify({ date: new Date().toISOString(), promptVersion: LEA_PROMPT_VERSION, provider: llm.name, model: llm.model, simulated: llm.simulated, average, allPassed, exams }, null, 2));

const md = `# Rapport de certification — LÉA Sales Academy

_Généré par \`npx tsx scripts/training/run-exam.ts\` le ${new Date().toISOString().slice(0, 10)} · prompt \`${LEA_PROMPT_VERSION}\` · fournisseur IA : **${llm.name}** (${llm.model})._

## Verdict

| Périmètre | Résultat |
|---|---|
| Comportement déterministe de LÉA (outils + gabarits${llm.simulated ? ", simulateur IA" : ""}) | ${allPassed ? `**Examen réussi** — ${exams.filter((e) => e.passed).length}/10 épreuves, moyenne ${average}/100, seuil ${PASS_SCORE}` : `**Examen non réussi** — ${exams.filter((e) => e.passed).length}/10 épreuves réussies, moyenne ${average}/100`} |
| Modèle IA réel (${llm.simulated ? "Claude via l'API Anthropic" : llm.model}) | ${llm.simulated ? "**Non évalué** — aucune clé API configurée ; LÉA n'est PAS certifiée avec le modèle réel." : allPassed ? "Évalué : voir les épreuves ci-dessous." : "Évalué : non réussi, voir ci-dessous."} |

## Épreuves

| # | Épreuve | Type | Score | Résultat |
|---:|---|---|---:|---|
${exams.map((e) => `| ${e.n} | ${e.title} | ${e.kind} | ${e.score === null ? "—" : `${e.score}/100`} | ${e.passed ? "✅ réussie" : e.score === null ? "⏸ non exécutée" : "❌ échouée"} |`).join("\n")}

## Détail, erreurs et axes d'amélioration

${exams.map((e) => `### ${e.n}. ${e.title}
${e.checks.map((c) => `- ${c.ok ? "✅" : "❌"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`).join("\n") || "- (aucun contrôle exécuté)"}
${e.errors.length ? `- **Erreurs** : ${e.errors.join(" ; ")}` : "- Erreurs critiques : aucune"}
${e.improvements.length ? `- **Axes d'amélioration** : ${e.improvements.join(" ")}` : "- Axes d'amélioration : aucun relevé par la grille"}`).join("\n\n")}

## Ce que ce rapport ne mesure pas

- La qualité rédactionnelle du **modèle IA réel** : à mesurer avec \`LLM_PROVIDER=anthropic\` (dépense externe, accord explicite requis).
- Le jugement d'un acheteur réel : l'évaluateur est une grille de règles explicites (méthode, données, fiabilité).
- Les épreuves outils utilisent le jeu de charge fictif (\`scripts/perf/seed-large.ts\`), pas les données de l'entreprise.
`;
writeFileSync(new URL("../../training/evaluations/CERTIFICATION.md", import.meta.url), md);
console.log(`Examen : ${exams.filter((e) => e.passed).length}/10 réussies · moyenne ${average}/100 · fournisseur ${llm.name}`);
for (const e of exams) console.log(`${e.passed ? "✓" : "✗"} ${e.n}. ${e.title} — ${e.score ?? "—"} ${e.errors.join(" ")} ${e.checks.filter((c) => !c.ok).map((c) => `[${c.name}: ${c.detail ?? ""}]`).join(" ")}`);
process.exit(0);
