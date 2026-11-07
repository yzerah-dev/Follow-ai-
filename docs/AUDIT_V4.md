# Audit V4 — « Cerveau commercial & performance » (2026-11-08)

## 1. Modules déjà opérationnels (testés)

| Domaine | État | Où |
|---|---|---|
| 6 missions quotidiennes (réactivation, permanents, compléments/retours, nouveautés, rendez-vous, objectifs) | ✅ | `features/opportunities/engine.ts`, `features/agent/autopilot.ts`, cron `/api/cron/daily-plan` |
| Objectifs client annuel/mensuel saisis par un humain, réalisé, attendu à date (saisonnalité N-1), écart, prévision | ✅ | `features/customers/targets.ts`, fiche client |
| Réassorts : permanents, cycles, quantités, couverture estimée avec hypothèses et confiance | ✅ | `features/analytics/coverage.ts`, `features/selection/pipeline.ts` |
| Grands catalogues : sélection SQL, offres 200-1 000 lignes, éditeur, tâches asynchrones, perf mesurées (591 500 lignes) | ✅ | `features/selection/`, `features/offers/editor.ts`, `docs/PERFORMANCE.md` |
| Objections par la donnée + Sales Academy (prompt versionné, 105 scénarios, examen) | ✅ | `features/agent/playbook.ts`, `lib/ai/lea-*.ts`, `training/` |
| Multicanal : email + WhatsApp (simulés), historique, relances multicanales, consentements, opposition | ✅ | `features/conversations/` |
| Studio : PDF, Excel illustré, catalogue, synthèse, sélection prioritaire, analyse de couverture | ✅ | `features/creative-studio/` |
| Isolation multi-entreprises (RLS optimisée), audit, garde-fous | ✅ | migrations, `tests/integration/rls.test.ts` |

## 2. Manques identifiés

1. Objectifs **entreprise et portefeuille** (commercial) : absents (seulement par client).
2. Objectifs mensuels **répartis automatiquement** selon la saisonnalité N-1 : calcul interne seulement, pas de tableau mensuel ni de répartition enregistrable.
3. Client en retard : un plan est remis au commercial, mais **pas d'analyse des causes, ni d'offre de développement, ni de rendez-vous** automatiques.
4. Client dormant : seuil `max(120 j, 2,5 × fréquence)` → un client hebdomadaire inactif depuis 60 jours n'est **pas détecté** ;
   la relance utilise les 50 produits habituels, sans nouveautés ni compléments ni catalogue, ni calendrier de suivi.
5. Nouveautés : nombre non adapté à la taille du client ; **même ordre pour tous les clients** d'une catégorie.
6. Pas de **compte rendu quotidien** historisé (« Voici ce que LÉA a préparé aujourd'hui… ») ni de décisions à valider regroupées.
7. Studio non accessible depuis la **fiche client** (catalogue personnalisé).
8. Marque « Follow.AI » à renommer en **LÉA.AI**.
9. SMS, téléphone IA, LinkedIn : **non implémentés** (connecteurs à choisir et contracter) — hors périmètre de cette itération.

## 3. Point de vigilance — validation humaine V1

Le prompt V4 demande la validation humaine des envois externes en V1. Le client a explicitement décidé le 2026-11-08
de supprimer cette exigence pour JONAS (autonome, remise ≤ 1 %). Décision conservée : l'autonomie reste réglable par
organisation, les nouvelles organisations sont **supervisées par défaut** (toute sortie validée par un humain).
Aucun envoi réel n'a lieu tant qu'aucun connecteur réel n'est activé.

## 4. Plan court (parcours complet plutôt que fonctionnalités inachevées)

1. Moteur d'objectifs : entreprise / portefeuille / client, tableau mensuel (réalisé, cumul, attendu, écart, % d'atteinte, N-1,
   prévision), répartition automatique par saisonnalité N-1 enregistrable, saisie manuelle conservée.
2. Retard d'objectif : analyse des causes, offre de développement (moteur de sélection), rendez-vous, suivi.
3. Dormants : détection relative à la fréquence propre au client ; dossier complet (réassort, nouveautés, compléments, catalogue,
   rendez-vous, calendrier de suivi).
4. Nouveautés : nombre proportionné à la taille du client (5 / 20 / 50 / 100), classement personnalisé (catégories, marques).
5. Compte rendu quotidien idempotent + accueil « Voici ce que LÉA a préparé aujourd'hui… » avec décisions à valider.
6. Catalogue personnalisé depuis la fiche client ; renommage LÉA.AI.
7. Tests (unitaires, intégration, isolation, charge), CLAUDE.md, PROGRESS.md.
