# Plan de test

| Niveau | Commande | Contenu |
|---|---|---|
| Types | `npm run typecheck` | TypeScript strict (`noUncheckedIndexedAccess`) |
| Lint | `npm run lint` | eslint-config-next + typescript |
| Unitaires | `npm run test` | 56 tests : règles d'autonomie, plage d'envoi, décimal, analytique, prix, offres, politique JONAS, opportunités, analyse des réponses, rédaction, garde-fous, injection, chiffrement, webhooks, rate limit, stockage, imports |
| Intégration | `npm run test:integration` | PostgreSQL réel (base `follow_ai_test`, recréée) : scénario supervisé (services), mode autonome de bout en bout (9 cas), 18 tests RLS, imports CSV/XLSX + réimport |
| Build | `npm run build` | build de production Next.js |
| E2E | `npm run build && npm run e2e` | Playwright (base `follow_ai_e2e`, port 3100) : scénario principal supervisé, lecture seule, isolation inter-entreprises, mode autonome + interrupteur |

## Scénario principal (automatisé deux fois : services + interface)
1. Connexion · 2. Tableau de bord · 3. Réassort probable identifié (Maison Martin & Fils, 4 références) ·
4. Analyse des factures · 5. Sélection des produits · 6. Offre préparée · 7. PDF · 8. Excel illustré ·
9. Email personnalisé (vouvoiement) · 10. Validation · 11. Envoi simulé · 12. Réponse fictive (« trop cher, 5 % ») ·
13. Objection comprise · 14. Réponse proposée sans dépasser 1 %, escalade au commercial · 15. Approbation ·
16. Accord du client → demande de commande · 17. Le tableau de bord affiche le résultat.

## Prérequis
PostgreSQL local accessible avec `postgres:postgres@localhost:5432` (modifiable : `TEST_DATABASE_URL`, `E2E_DATABASE_URL`).
