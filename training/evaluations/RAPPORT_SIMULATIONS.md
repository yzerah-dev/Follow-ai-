# Rapport de simulations — LÉA Sales Academy

_Généré par `npx tsx scripts/training/run-simulations.ts` le 2026-11-07 · prompt `academy-1.0` · fournisseur **mock** (simulation-deterministe) — **simulateur déterministe, pas le modèle IA réel**._

| Indicateur | Valeur |
|---|---|
| Scénarios / échanges évalués | 105 / 210 |
| Score moyen | **98.6 / 100** (objectif 90) |
| Scénarios réussis | 105 / 105 |
| Erreurs critiques | 0 |
| Durée | 0.2 s |

Moyenne par critère : chaleur 14.9/15 · compréhension 14.5/15 · argumentation 19.2/20 · objections 19.9/20 · conclusion 15/15 · fiabilité 15/15.

## Par catégorie

| Catégorie | Scénarios | Score moyen | Réussis |
|---|---:|---:|---:|
| acheteur-agressif | 7 | 100 | 7/7 |
| acheteur-prix | 7 | 100 | 7/7 |
| acheteur-sympathique | 7 | 97 | 7/7 |
| baisse-ca | 7 | 91 | 7/7 |
| client-dormant | 7 | 99 | 7/7 |
| client-hesitant | 7 | 100 | 7/7 |
| client-mecontent | 7 | 100 | 7/7 |
| client-presse | 7 | 100 | 7/7 |
| client-sans-budget | 7 | 99 | 7/7 |
| client-surstocke | 7 | 100 | 7/7 |
| grand-compte | 7 | 100 | 7/7 |
| negociation-difficile | 7 | 96 | 7/7 |
| presentation-nouveautes | 7 | 98 | 7/7 |
| reassort-volumineux | 7 | 100 | 7/7 |
| suivi-commandes | 7 | 100 | 7/7 |

## Scénarios sous l'objectif (erreurs expliquées et réponse de référence)

Aucun : tous les scénarios atteignent l'objectif sans erreur critique.

## Méthode et limites

- Évaluateur déterministe (`lib/ai/lea-conversation-evaluator.ts`) : grille 15/15/20/20/15/15, erreurs critiques éliminatoires.
  Il mesure le respect de la méthode et la fiabilité des chiffres ; il ne remplace pas l'avis d'un commercial expérimenté.
- Fournisseur simulé : les réponses proviennent des gabarits déterministes de LÉA. **La qualité avec le modèle IA réel n'est pas mesurée par ce rapport** (aucune clé API configurée).
- Chaque échec ajoute un cas au test de régression (`tests/unit/academy.test.ts`) après correction validée en revue de code ; rien ne modifie la production automatiquement.
