# Performance — grands catalogues

_Mesures générées par `npm run perf` le 2026-11-07 (ne pas modifier à la main)._

Environnement : PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) local, Node v22.23.4, 4 vCPU, 17 Go de RAM (conteneur de développement).
Toutes les requêtes passent par la RLS (identité agent de l'organisation), comme en production.

Jeu de charge (`scripts/perf/seed-large.ts`) : **20 000 produits**, **5 000 clients**,
**109 750 factures**, **591 500 lignes de factures** sur 3 ans
(250 grands comptes à ~1 200 lignes, 4 750 magasins), 2 000 variantes, 12 500 tarifs clients, médias produits autorisés.

| Opération | Volume | Temps | Budget | Mémoire de l'opération (tas) | Pic RSS du processus | Erreurs | Détail |
|---|---|---:|---:|---:|---:|---:|---|
| Analyse des opportunités (organisation entière) | 5000 clients · 591500 lignes | 19 915 ms | 60 000 ms | 1017 Mo | 1216 Mo | 0 | 17729 opportunités |
| Sélection — 20 grands comptes (total) | 20 clients | 1 985 ms | 40 000 ms | 24 Mo | 1009 Mo | 0 | moyenne 99 ms · p95 142 ms · 211 lignes/client |
| Sélection — 20 magasins (total) | 20 clients | 681 ms | 40 000 ms | 13 Mo | 1011 Mo | 0 | moyenne 34 ms · p95 49 ms · 66 lignes/client |
| Offre complète par le moteur (grand compte) | jusqu'à 500 lignes | 142 ms | 3 000 ms | 13 Mo | 998 Mo | 0 | 213 lignes |
| Couverture de stock (grand compte) | 400 références | 38 ms | 2 000 ms | 2 Mo | 998 Mo | 0 | 210 références |
| Création d'une offre de 200 lignes | 200 lignes | 36 ms | 2 000 ms | 3 Mo | 998 Mo | 0 | 200 lignes · 65783.28 € HT |
| Éditeur — chargement (200 lignes) | 200 lignes | 5 ms | 1 500 ms | 0 Mo | 998 Mo | 0 | 200 lignes |
| Éditeur — modification en masse (200 lignes) | 200 changements | 43 ms | 2 000 ms | 4 Mo | 998 Mo | 0 | 200 modifications · révision 2 |
| Génération asynchrone offer_excel (200 lignes) | 200 lignes | 186 ms | 20 000 ms | 17 Mo | 1003 Mo | 0 | Offre-OF-2026-00002.xlsx 0.0 Mo |
| Génération asynchrone offer_pdf (200 lignes) | 200 lignes | 327 ms | 20 000 ms | 17 Mo | 1000 Mo | 0 | Offre-OF-2026-00002.pdf 0.1 Mo |
| Génération asynchrone catalog (200 lignes) | 200 lignes | 258 ms | 20 000 ms | 8 Mo | 1001 Mo | 0 | Catalogue-OF-2026-00002.pdf 0.1 Mo |
| Génération asynchrone synthesis_pdf + priority_pdf + email_txt (200 lignes) | 200 lignes | 335 ms | 20 000 ms | 10 Mo | 1001 Mo | 0 | Synthese-OF-2026-00002.pdf 0.0 Mo, Selection-prioritaire-OF-2026-00002.pdf 0.0 Mo, Email-OF-2026-00002.txt 0.0 Mo |
| Génération asynchrone coverage_excel (200 lignes) | 200 lignes | 141 ms | 20 000 ms | 5 Mo | 1002 Mo | 0 | Analyse-OF-2026-00002.xlsx 0.0 Mo |
| Création d'une offre de 500 lignes | 500 lignes | 54 ms | 5 000 ms | 8 Mo | 1002 Mo | 0 | 500 lignes · 175732.26 € HT |
| Éditeur — chargement (500 lignes) | 500 lignes | 10 ms | 1 500 ms | 1 Mo | 1002 Mo | 0 | 500 lignes |
| Éditeur — modification en masse (500 lignes) | 500 changements | 65 ms | 5 000 ms | 9 Mo | 1002 Mo | 0 | 500 modifications · révision 2 |
| Génération asynchrone offer_excel (500 lignes) | 500 lignes | 249 ms | 50 000 ms | 30 Mo | 1015 Mo | 0 | Offre-OF-2026-00003.xlsx 0.1 Mo |
| Génération asynchrone offer_pdf (500 lignes) | 500 lignes | 372 ms | 50 000 ms | 21 Mo | 1008 Mo | 0 | Offre-OF-2026-00003.pdf 0.2 Mo |
| Génération asynchrone catalog (500 lignes) | 500 lignes | 342 ms | 50 000 ms | 18 Mo | 1017 Mo | 0 | Catalogue-OF-2026-00003.pdf 0.2 Mo |
| Liste produits — recherche + page de 50 | 20 000 produits | 22 ms | 500 ms | 0 Mo | 1017 Mo | 0 | 50 résultats |
| Écran Clients — page 1 (tri par CA 12 mois) | 5 000 clients | 72 ms | 1 500 ms | 0 Mo | 1017 Mo | 0 | 25 / 5000 clients |
| Écran Clients — recherche | 5 000 clients | 196 ms | 1 000 ms | 0 Mo | 1017 Mo | 0 | 109 résultats |
| Écran Accueil (indicateurs, évolution, répartition) | 591500 lignes | 1 446 ms | 3 000 ms | 13 Mo | 1019 Mo | 0 | ok |
| Écran Actions (tableau de bord) | organisation | 117 ms | 2 000 ms | 0 Mo | 1017 Mo | 0 | ok |
| Écran Opportunités (liste triée) | 13 500 opportunités | 84 ms | 1 000 ms | 0 Mo | 1017 Mo | 0 | 200 affichées |
| Écran Rapports (résultats par mission, 90 j) | organisation | 44 ms | 3 000 ms | 12 Mo | 1019 Mo | 0 | ok |
| Objectifs entreprise + portefeuilles (mensuel, N-1) | 591500 lignes | 48 ms | 2 000 ms | 0 Mo | 1017 Mo | 0 | 0 portefeuille(s) |
| Compte rendu quotidien de LÉA | organisation | 206 ms | 3 000 ms | 12 Mo | 1019 Mo | 0 | 4805 réassorts · 0 dormants · 4483 nouveautés |
| Objectifs d'un client (tableau mensuel) | grand compte | 7 ms | 500 ms | 0 Mo | 1017 Mo | 0 | 12 mois |
| Fiche client — grand compte (habitudes, missions) | ~1 200 lignes | 56 ms | 2 000 ms | 11 Mo | 1017 Mo | 0 | chargée |

Résultat : **tous les budgets sont respectés, aucune erreur.**

Limites connues : mesures sur une machine de développement, sans charge concurrente ; « mémoire de l'opération » = pic du tas JavaScript
au-dessus du niveau de départ (après ramasse-miettes), le pic RSS est celui du processus complet (il ne redescend pas entre deux opérations) ;
les médias du jeu de charge sont 8 visuels partagés (dédupliqués dans les fichiers) : avec des photos toutes différentes, la taille des
Excel et PDF croît avec le nombre de photos ; l'analyse de l'organisation entière reste un traitement par lots (cron quotidien), pas une requête interactive.
