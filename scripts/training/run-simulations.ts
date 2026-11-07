/**
 * Exécute les simulations d'entraînement de LÉA et écrit les évaluations versionnées.
 *   npx tsx scripts/training/run-simulations.ts                 → simulateur déterministe (LLM_PROVIDER=mock)
 *   LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=… npx tsx …         → modèle réel (dépense externe : avec accord explicite)
 * Sorties : training/evaluations/<date>_<version>_<fournisseur>.json et training/evaluations/RAPPORT_SIMULATIONS.md
 * Les résultats ne modifient JAMAIS le comportement en production : toute correction passe par une revue de code.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

process.env.SESSION_SECRET ??= "training-session-secret-at-least-32-characters";
process.env.LLM_PROVIDER ??= "mock";
const { getLlm } = await import("../../lib/ai");
const { simulateScenario, scenarioSchema, LEA_PROMPT_VERSION } = await import("../../features/training/simulator");
const { CRITICAL_LABEL, PASS_SCORE } = await import("../../lib/ai/lea-conversation-evaluator");

const dir = new URL("../../training/scenarios/", import.meta.url);
const scenarios = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().flatMap((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")).map((s: unknown) => scenarioSchema.parse(s)));
const llm = getLlm();
const results: Awaited<ReturnType<typeof simulateScenario>>[] = [];
const t0 = Date.now();
for (const s of scenarios) results.push(await simulateScenario(s, llm));
const ms = Date.now() - t0;

const avg = Math.round((results.reduce((a, r) => a + r.score, 0) / results.length) * 10) / 10;
const passed = results.filter((r) => r.passed).length;
const crit = results.flatMap((r) => r.critical);
const byCat = new Map<string, { n: number; score: number; passed: number }>();
for (const r of results) { const v = byCat.get(r.category) ?? { n: 0, score: 0, passed: 0 }; byCat.set(r.category, { n: v.n + 1, score: v.score + r.score, passed: v.passed + (r.passed ? 1 : 0) }); }
const crit5 = ["warmth", "understanding", "argumentation", "objections", "closing", "reliability"] as const;
const crit5Avg = Object.fromEntries(crit5.map((k) => [k, Math.round((results.flatMap((r) => r.turns.map((t) => t.evaluation.breakdown[k])).reduce((a, b) => a + b, 0) / results.flatMap((r) => r.turns).length) * 10) / 10]));

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
mkdirSync(new URL("../../training/evaluations/", import.meta.url), { recursive: true });
const summary = { date: new Date().toISOString(), promptVersion: LEA_PROMPT_VERSION, provider: llm.name, model: llm.model, simulated: llm.simulated, scenarios: results.length, turns: results.reduce((a, r) => a + r.turns.length, 0), averageScore: avg, passed, critical: crit.length, durationMs: ms, byCriterion: crit5Avg };
writeFileSync(new URL(`../../training/evaluations/${stamp}_${LEA_PROMPT_VERSION}_${llm.name}.json`, import.meta.url), JSON.stringify({ summary, results }, null, 2));

const failing = results.filter((r) => !r.passed);
const md = `# Rapport de simulations — LÉA Sales Academy

_Généré par \`npx tsx scripts/training/run-simulations.ts\` le ${summary.date.slice(0, 10)} · prompt \`${LEA_PROMPT_VERSION}\` · fournisseur **${llm.name}** (${llm.model})${llm.simulated ? " — **simulateur déterministe, pas le modèle IA réel**" : ""}._

| Indicateur | Valeur |
|---|---|
| Scénarios / échanges évalués | ${results.length} / ${summary.turns} |
| Score moyen | **${avg} / 100** (objectif ${PASS_SCORE}) |
| Scénarios réussis | ${passed} / ${results.length} |
| Erreurs critiques | ${crit.length} |
| Durée | ${(ms / 1000).toFixed(1)} s |

Moyenne par critère : chaleur ${crit5Avg.warmth}/15 · compréhension ${crit5Avg.understanding}/15 · argumentation ${crit5Avg.argumentation}/20 · objections ${crit5Avg.objections}/20 · conclusion ${crit5Avg.closing}/15 · fiabilité ${crit5Avg.reliability}/15.

## Par catégorie

| Catégorie | Scénarios | Score moyen | Réussis |
|---|---:|---:|---:|
${[...byCat.entries()].map(([k, v]) => `| ${k} | ${v.n} | ${Math.round(v.score / v.n)} | ${v.passed}/${v.n} |`).join("\n")}

## Scénarios sous l'objectif (erreurs expliquées et réponse de référence)

${failing.length ? failing.map((r) => `### ${r.id} — ${r.score}/100${r.critical.length ? ` — ÉCHEC CRITIQUE : ${r.critical.map((c) => CRITICAL_LABEL[c as keyof typeof CRITICAL_LABEL]).join(", ")}` : ""}
${r.turns.filter((t) => !t.evaluation.passed).map((t) => `- **Client** : ${t.customer}\n  - **LÉA** (${t.evaluation.score}/100) : ${t.reply.replace(/\n+/g, " ")}\n  - **Erreurs** : ${t.evaluation.issues.join(" ")}\n  - **Réponse de référence** : ${t.reference ?? "—"}`).join("\n")}`).join("\n\n") : "Aucun : tous les scénarios atteignent l'objectif sans erreur critique."}

## Méthode et limites

- Évaluateur déterministe (\`lib/ai/lea-conversation-evaluator.ts\`) : grille 15/15/20/20/15/15, erreurs critiques éliminatoires.
  Il mesure le respect de la méthode et la fiabilité des chiffres ; il ne remplace pas l'avis d'un commercial expérimenté.
- ${llm.simulated ? "Fournisseur simulé : les réponses proviennent des gabarits déterministes de LÉA. **La qualité avec le modèle IA réel n'est pas mesurée par ce rapport** (aucune clé API configurée)." : "Modèle réel : les scores dépendent de la version du modèle et du prompt ; comparer les rapports à prompt identique."}
- Chaque échec ajoute un cas au test de régression (\`tests/unit/academy.test.ts\`) après correction validée en revue de code ; rien ne modifie la production automatiquement.
`;
writeFileSync(new URL("../../training/evaluations/RAPPORT_SIMULATIONS.md", import.meta.url), md);
console.log(`${results.length} scénarios · score moyen ${avg}/100 · réussis ${passed}/${results.length} · erreurs critiques ${crit.length} · ${(ms / 1000).toFixed(1)} s`);
for (const r of failing.slice(0, 40)) console.log(`✗ ${r.id} ${r.score} ${r.critical.join(",")} | ${r.turns.filter((t) => !t.evaluation.passed).map((t) => `[${t.analysis.intent}/${t.analysis.objection}] ${t.evaluation.issues.join(" ")}`).join(" || ")}`);
