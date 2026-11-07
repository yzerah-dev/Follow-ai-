# Entraînement de LÉA

- `LEA_COMMERCIAL_ACADEMY.md` — la formation (source de référence).
- `scenarios/` — 105 scénarios (15 catégories × 7 personas), générés par `npx tsx scripts/training/generate-scenarios.ts`.
- `evaluations/` — rapports versionnés (`RAPPORT_SIMULATIONS.md`, `CERTIFICATION.md`, `HISTORIQUE.md`) et résultats JSON.

Commandes :
- `npx tsx scripts/training/run-simulations.ts` — simulations + rapport (simulateur ; `LLM_PROVIDER=anthropic` pour le modèle réel, avec accord de dépense).
- `npx tsx scripts/training/run-exam.ts` — examen final (épreuves outils sur le jeu de charge : `npm run perf:seed` d'abord).
- `npx vitest run tests/unit/academy.test.ts` — régression (chaque scénario ≥ 90/100, aucune erreur critique).

Règle : une erreur trouvée en simulation est corrigée dans le code, relue, puis ajoutée aux scénarios ou aux tests ;
rien ne modifie automatiquement le comportement de LÉA en production.
