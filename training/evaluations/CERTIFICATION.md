# Rapport de certification — LÉA Sales Academy

_Généré par `npx tsx scripts/training/run-exam.ts` le 2026-11-07 · prompt `academy-1.0` · fournisseur IA : **mock** (simulation-deterministe)._

## Verdict

| Périmètre | Résultat |
|---|---|
| Comportement déterministe de LÉA (outils + gabarits, simulateur IA) | **Examen réussi** — 10/10 épreuves, moyenne 99/100, seuil 90 |
| Modèle IA réel (Claude via l'API Anthropic) | **Non évalué** — aucune clé API configurée ; LÉA n'est PAS certifiée avec le modèle réel. |

## Épreuves

| # | Épreuve | Type | Score | Résultat |
|---:|---|---|---:|---|
| 1 | Convaincre un client surstocké avec des données | conversation | 100/100 | ✅ réussie |
| 2 | Défendre un prix sans remise injustifiée | conversation | 100/100 | ✅ réussie |
| 3 | Réactiver un client dormant | conversation | 100/100 | ✅ réussie |
| 4 | Préparer un réassort de 200 références | outil | 100/100 | ✅ réussie |
| 5 | Présenter 30 nouveautés pertinentes | outil | 100/100 | ✅ réussie |
| 6 | Obtenir un rendez-vous avec un acheteur difficile | conversation | 91/100 | ✅ réussie |
| 7 | Gérer une réclamation de livraison | conversation | 100/100 | ✅ réussie |
| 8 | Construire un plan d'accélération du CA | outil | 100/100 | ✅ réussie |
| 9 | Préparer une offre commerciale illustrée | outil | 100/100 | ✅ réussie |
| 10 | Conclure une vente sans dépasser ses autorisations | conversation | 96/100 | ✅ réussie |

## Détail, erreurs et axes d'amélioration

### 1. Convaincre un client surstocké avec des données
- ✅ Échange 1 : « J'ai trop de stock, il m'en reste 40 de Plaid Duo. » — 100/100
- ✅ Échange 2 : « Quel est le nouveau montant total ? » — 100/100
- Erreurs critiques : aucune
- Axes d'amélioration : aucun relevé par la grille

### 2. Défendre un prix sans remise injustifiée
- ✅ Échange 1 : « C'est trop cher pour moi. » — 100/100
- ✅ Échange 2 : « Un concurrent me fait moins cher sur les mêmes produits. » — 100/100
- Erreurs critiques : aucune
- Axes d'amélioration : aucun relevé par la grille

### 3. Réactiver un client dormant
- ✅ Échange 1 : « Bonjour, ça fait longtemps. Quel est le prix de R421 aujourd'hui ? » — 100/100
- ✅ Échange 2 : « Je vais réfléchir. » — 100/100
- Erreurs critiques : aucune
- Axes d'amélioration : aucun relevé par la grille

### 4. Préparer un réassort de 200 références
- ✅ Au moins 200 références de réassort — 232 références
- ✅ Offre créée avec toutes les lignes (aucune perdue) — 232 lignes
- ✅ Aucun doublon de produit
- ✅ Chaque ligne a un prix vérifié et une justification
- ✅ Quantités au colisage
- ✅ Références lentes écartées avec motif — 289 écartées
- Erreurs critiques : aucune
- Axes d'amélioration : aucun relevé par la grille

### 5. Présenter 30 nouveautés pertinentes
- ✅ Au moins 30 nouveautés proposées — 40 nouveautés
- ✅ Toutes dans des catégories travaillées par le client
- ✅ Disponibles (aucune rupture sans date)
- ✅ Quantité de découverte (colisage minimal)
- ✅ Justification par nouveauté
- Erreurs critiques : aucune
- Axes d'amélioration : aucun relevé par la grille

### 6. Obtenir un rendez-vous avec un acheteur difficile
- ✅ Échange 1 : « Je n'ai besoin de rien, et vos relances m'agacent. » — 92/100
- ✅ Échange 2 : « Bon, d'accord pour un rendez-vous rapide. » — 90/100
- Erreurs critiques : aucune
- **Axes d'amélioration** : La réponse ne traite pas le cœur de l'objection. Argumentation peu étayée par les données.

### 7. Gérer une réclamation de livraison
- ✅ Échange 1 : « Ma livraison est en retard, c'est inadmissible ! » — 100/100
- ✅ Échange 2 : « Quand est-ce que je serai livré exactement ? » — 100/100
- Erreurs critiques : aucune
- Axes d'amélioration : aucun relevé par la grille

### 8. Construire un plan d'accélération du CA
- ✅ Objectif suivi (réalisé, attendu à date, écart) — réalisé 2034879 € / attendu 2645090 €
- ✅ Retard détecté — behind
- ✅ Opportunité « objectif de CA » avec plan d'accélération
- ✅ Plan avec au moins 3 leviers (réassorts, nouveautés, compléments, rendez-vous…) — 3 leviers
- ✅ Leviers chiffrés seulement si un prix est connu
- Erreurs critiques : aucune
- Axes d'amélioration : aucun relevé par la grille

### 9. Préparer une offre commerciale illustrée
- ✅ Génération asynchrone terminée sans erreur — 6/6 étapes
- ✅ Excel illustré : une ligne par référence — 232 lignes
- ✅ Excel illustré : photos issues des médias autorisés — 232 photos placées
- ✅ Contrôles automatiques de l'offre réussis
- ✅ Catalogue PDF, synthèse, sélection prioritaire, analyse de couverture générés
- ✅ Email court malgré l'offre volumineuse — 1288 caractères
- Erreurs critiques : aucune
- Axes d'amélioration : aucun relevé par la grille

### 10. Conclure une vente sans dépasser ses autorisations
- ✅ Échange 1 : « Je veux 5 % de remise, sinon je ne commande pas. » — 100/100
- ✅ Échange 2 : « Bon, et 1 % de remise alors ? » — 92/100
- Erreurs critiques : aucune
- **Axes d'amélioration** : La réponse ne traite pas le cœur de l'objection.

## Ce que ce rapport ne mesure pas

- La qualité rédactionnelle du **modèle IA réel** : à mesurer avec `LLM_PROVIDER=anthropic` (dépense externe, accord explicite requis).
- Le jugement d'un acheteur réel : l'évaluateur est une grille de règles explicites (méthode, données, fiabilité).
- Les épreuves outils utilisent le jeu de charge fictif (`scripts/perf/seed-large.ts`), pas les données de l'entreprise.
