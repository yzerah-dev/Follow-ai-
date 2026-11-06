# Avancement — Follow.AI

_Mise à jour : 2026-11-06 (session initiale)._

## Phases
| Phase | État |
|---|---|
| 0 — Initialisation | ✅ Next.js 16, TS strict, Tailwind 4, Vitest, Playwright, ESLint, .env.example, structure, docs |
| 1 — Socle SaaS | ✅ Auth locale, organisations, rôles, RLS forcée, layout/sidebar, accueil, paramètres, tests d'isolation |
| 2 — Données commerciales | ✅ Clients (fiche 360°), contacts partagés, factures + lignes + avoirs, produits, tarifs, stocks, offres, imports, recherche |
| 3 — Cerveau LÉA | ✅ Mémoire, analytique, opportunités (7 types), scoring, offres automatiques, journal des décisions, coûts — IA réelle non testée (pas de clé) |
| 4 — Communications | ✅ Conversations unifiées, brouillons IA, approbations, envoi **simulé**, réponses simulées, objections, relances, escalades, webhook entrant — connecteurs réels à configurer |
| 5 — Studio créatif | ✅ Offre PDF, Excel illustré, fiches, catalogue, affiche, validation, versionnement — génération d'images désactivée |
| 6 — Pilote | 🟡 Démo complète et scénario E2E OK ; restent : Supabase Storage, Supabase Auth, onboarding, déploiement (soumis à approbation) |

## Fonctionnalités opérationnelles (testées)
- Connexion / déconnexion, changement d'organisation, rôles (propriétaire, admin, manager, commercial, lecture seule).
- Cockpit : opportunités du jour avec justification, confiance et potentiel **estimé** ; validations ; réponses ; tâches ; résultats du mois (réels).
- Fiche client : CA net 12 mois, fréquence, panier, tendance, histogramme mensuel, produits habituels et prochain achat, opportunités,
  factures, contacts (consentement, partage), offres, conversations, mémoire de LÉA, prochaine action recommandée.
- Factures (facturé ≠ réglé), produits (tarifs, stock, prix d'achat réservé aux managers), offres (cycle complet), demande de commande.
- LÉA : préparation d'offre depuis une opportunité ou une fiche client ; email personnalisé ; analyse des réponses (10 objections,
  accord, rendez-vous, désinscription, absence) ; réponse respectant la politique (JONAS : 1 %, escalade au-delà) ; assistant latéral.
- Studio : génération, contrôles automatiques, aperçu, téléchargement, validation ; pièces jointes validées ajoutées à l'envoi.
- Imports CSV/XLSX : prévisualisation, mapping auto, validation, rapport, traitement asynchrone (`after()`), réimport sans doublon.
- Cron LÉA idempotent, webhook email signé, journal d'audit, liste d'opposition.

## Fonctionnalités simulées (clairement signalées)
- IA : `MockProvider` (badge « IA simulée »). Claude prêt (`LLM_PROVIDER=anthropic`) mais **non exécuté** faute de clé.
- Email : connexion « mode simulation » (badge « Envoi simulé » ; statut de connexion « Non connectée »).
- Réponses clients : outil de démonstration (`DEMO_TOOLS=true`).
- Données : 2 organisations fictives (`is_demo`, bandeau), 100 clients, 200 produits, ~1 700 factures / ~9 300 lignes par organisation,
  visuels produits de démonstration (dégradés étiquetés).

## Tests exécutés (2026-11-06)
| Suite | Résultat |
|---|---|
| `npm run typecheck` | ✅ 0 erreur |
| `npm run lint` | ✅ 0 erreur, 0 avertissement |
| `npm run test` | ✅ 48/48 |
| `npm run test:integration` (PostgreSQL 16) | ✅ 20/20 (scénario complet, 16 RLS, 3 imports) |
| `npm run build` | ✅ |
| `npm run e2e` (Playwright, Chromium) | ✅ 3/3 |

## Problèmes connus
- Rate limit en mémoire (par instance).
- Driver de stockage local uniquement : non persistant sur Vercel → implémenter Supabase Storage avant production.
- `AUTH_MODE=supabase` non implémenté (MFA, magic link, invitations).
- Une page « introuvable » rendue en streaming peut renvoyer HTTP 200 (contenu correct, aucune donnée exposée).
- Moteur d'opportunités : nombreuses opportunités « nouveauté / complémentaire » sur la démo (seuils à calibrer sur données réelles).
- Traitement d'import ligne par ligne (adapté à quelques dizaines de milliers de lignes ; à optimiser en lots pour l'ERP).

## Prochaines étapes
1. Driver Supabase Storage + adaptateur Supabase Auth ; écran d'onboarding (création d'organisation, invitations).
2. Fournir une clé `ANTHROPIC_API_KEY` de test pour valider le fournisseur Claude (évaluations sur réponses réelles anonymisées).
3. Connecteur Gmail / Microsoft 365 (OAuth, lecture des réponses, envoi après validation).
4. Édition manuelle des lignes d'offre ; rendez-vous (proposition de créneaux) ; portail B2B.
5. Export RGPD self-service ; rate limit Redis ; CSP stricte ; Inngest dès qu'une version compatible zod 4 est disponible.

## Intervention humaine nécessaire
| Besoin | Pourquoi | Comment | Ce qui continue sans |
|---|---|---|---|
| Clé API Anthropic | Activer le raisonnement IA réel | `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` dans l'environnement serveur | Tout, en IA simulée |
| Projet Supabase | Production multi-tenant | Créer le projet, appliquer les migrations (DEPLOYMENT.md) | Développement local complet |
| OAuth Gmail / M365 | Envoi et lecture réels | App Google Cloud / Entra ID, scopes listés dans INTEGRATIONS.md | Envoi simulé |
| WhatsApp / SMS / téléphonie | Canaux additionnels | Comptes fournisseurs officiels | Email |
| Données réelles JONAS | Calibrer LÉA | Exports CSV/XLSX clients, produits, tarifs, factures (IMPORT_FORMATS.md) | Démo fictive |
