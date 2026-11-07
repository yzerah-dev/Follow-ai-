# Performance — grands catalogues

_Mesures générées par `npm run perf` le 2026-11-07 (ne pas modifier à la main)._

Environnement : PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) local, Node v22.23.4, 4 vCPU, 17 Go de RAM (conteneur de développement).
Toutes les requêtes passent par la RLS (identité agent de l'organisation), comme en production.

Jeu de charge (`scripts/perf/seed-large.ts`) : **20 000 produits**, **5 000 clients**,
**109 750 factures**, **591 500 lignes de factures** sur 3 ans
(250 grands comptes à ~1 200 lignes, 4 750 magasins), 2 000 variantes, 12 500 tarifs clients, médias produits autorisés.

| Opération | Volume | Temps | Budget | Mémoire de l'opération (tas) | Pic RSS du processus | Erreurs | Détail |
|---|---|---:|---:|---:|---:|---:|---|
| Analyse des opportunités (organisation entière) | 5000 clients · 591500 lignes | 22 131 ms | 60 000 ms | 1009 Mo | 1190 Mo | 0 | 17730 opportunités |
| Sélection — 20 grands comptes (total) | 20 clients | 2 020 ms | 40 000 ms | 24 Mo | 981 Mo | 0 | moyenne 101 ms · p95 120 ms · 177 lignes/client |
| Sélection — 20 magasins (total) | 20 clients | 611 ms | 40 000 ms | 13 Mo | 968 Mo | 0 | moyenne 31 ms · p95 34 ms · 101 lignes/client |
| Offre complète par le moteur (grand compte) | jusqu'à 500 lignes | 127 ms | 3 000 ms | 10 Mo | 971 Mo | 0 | 135 lignes |
| Couverture de stock (grand compte) | 400 références | 52 ms | 2 000 ms | 2 Mo | 967 Mo | 0 | 210 références |
| Création d'une offre de 200 lignes | 200 lignes | 42 ms | 2 000 ms | 3 Mo | 967 Mo | 0 | 200 lignes · 65783.28 € HT |
| Éditeur — chargement (200 lignes) | 200 lignes | 8 ms | 1 500 ms | 0 Mo | 967 Mo | 0 | 200 lignes |
| Éditeur — modification en masse (200 lignes) | 200 changements | 46 ms | 2 000 ms | 4 Mo | 967 Mo | 0 | 200 modifications · révision 2 |
| Génération asynchrone offer_excel (200 lignes) | 200 lignes | 231 ms | 20 000 ms | 17 Mo | 975 Mo | 0 | Offre-OF-2026-00003.xlsx 0.0 Mo |
| Génération asynchrone offer_pdf (200 lignes) | 200 lignes | 328 ms | 20 000 ms | 17 Mo | 971 Mo | 0 | Offre-OF-2026-00003.pdf 0.1 Mo |
| Génération asynchrone catalog (200 lignes) | 200 lignes | 244 ms | 20 000 ms | 8 Mo | 970 Mo | 0 | Catalogue-OF-2026-00003.pdf 0.1 Mo |
| Génération asynchrone synthesis_pdf + priority_pdf + email_txt (200 lignes) | 200 lignes | 372 ms | 20 000 ms | 9 Mo | 970 Mo | 0 | Synthese-OF-2026-00003.pdf 0.0 Mo, Selection-prioritaire-OF-2026-00003.pdf 0.0 Mo, Email-OF-2026-00003.txt 0.0 Mo |
| Génération asynchrone coverage_excel (200 lignes) | 200 lignes | 159 ms | 20 000 ms | 6 Mo | 972 Mo | 0 | Analyse-OF-2026-00003.xlsx 0.0 Mo |
| Création d'une offre de 500 lignes | 500 lignes | 64 ms | 5 000 ms | 8 Mo | 970 Mo | 0 | 500 lignes · 175732.26 € HT |
| Éditeur — chargement (500 lignes) | 500 lignes | 11 ms | 1 500 ms | 1 Mo | 970 Mo | 0 | 500 lignes |
| Éditeur — modification en masse (500 lignes) | 500 changements | 88 ms | 5 000 ms | 9 Mo | 971 Mo | 0 | 500 modifications · révision 2 |
| Génération asynchrone offer_excel (500 lignes) | 500 lignes | 263 ms | 50 000 ms | 30 Mo | 986 Mo | 0 | Offre-OF-2026-00004.xlsx 0.1 Mo |
| Génération asynchrone offer_pdf (500 lignes) | 500 lignes | 495 ms | 50 000 ms | 22 Mo | 980 Mo | 0 | Offre-OF-2026-00004.pdf 0.2 Mo |
| Génération asynchrone catalog (500 lignes) | 500 lignes | 349 ms | 50 000 ms | 18 Mo | 990 Mo | 0 | Catalogue-OF-2026-00004.pdf 0.2 Mo |
| Liste produits — recherche + page de 50 | 20 000 produits | 26 ms | 500 ms | 0 Mo | 990 Mo | 0 | 50 résultats |
| Écran Clients — page 1 (tri par CA 12 mois) | 5 000 clients | 69 ms | 1 500 ms | 0 Mo | 990 Mo | 0 | 25 / 5000 clients |
| Écran Clients — recherche | 5 000 clients | 144 ms | 1 000 ms | 0 Mo | 990 Mo | 0 | 109 résultats |
| Écran Accueil (indicateurs, évolution, répartition) | 591500 lignes | 2 055 ms | 3 000 ms | 1 Mo | 1003 Mo | 0 | ok |
| Écran Actions (tableau de bord) | organisation | 80 ms | 2 000 ms | 0 Mo | 1003 Mo | 0 | ok |
| Écran Opportunités (liste triée) | 13 500 opportunités | 60 ms | 1 000 ms | 0 Mo | 1003 Mo | 0 | 200 affichées |
| Écran Rapports (résultats par mission, 90 j) | organisation | 81 ms | 3 000 ms | 12 Mo | 1005 Mo | 0 | ok |
| Fiche client — grand compte (habitudes, missions) | ~1 200 lignes | 65 ms | 2 000 ms | 11 Mo | 1003 Mo | 0 | chargée |

Résultat : **tous les budgets sont respectés, aucune erreur.**

Limites connues : mesures sur une machine de développement, sans charge concurrente ; « mémoire de l'opération » = pic du tas JavaScript
au-dessus du niveau de départ (après ramasse-miettes), le pic RSS est celui du processus complet (il ne redescend pas entre deux opérations) ;
les médias du jeu de charge sont 8 visuels partagés (dédupliqués dans les fichiers) : avec des photos toutes différentes, la taille des
Excel et PDF croît avec le nombre de photos ; l'analyse de l'organisation entière reste un traitement par lots (cron quotidien), pas une requête interactive.
