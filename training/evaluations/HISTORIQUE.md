# Historique des itérations d'entraînement — LÉA Sales Academy

Fournisseur évalué : **simulateur déterministe (mock)**. Le modèle IA réel n'a pas encore été évalué (aucune clé API).
Toutes les corrections ci-dessous sont des modifications de code relues et testées : rien ne modifie la production automatiquement.

| Itération | Fichier | Score moyen | Scénarios réussis | Erreurs critiques | Chaleur /15 | Compréhension /15 | Argumentation /20 | Objections /20 | Conclusion /15 | Fiabilité /15 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 — avant corrections | `2026-11-07_iteration-0-avant-corrections_academy-1.0_mock.json` | 91,1 | 53 / 105 | 0 | 14,9 | 14,7 | 16,3 | 18,4 | 11,6 | 15 |
| 2 — finale | `2026-11-07_iteration-2-final_academy-1.0_mock.json` | 98,6 | 105 / 105 | 0 | 14,9 | 14,5 | 19,2 | 19,9 | 15 | 15 |

## Itération 0 → 1 : erreurs relevées par les simulations

| Erreur constatée | Correction (cerveau de LÉA) |
|---|---|
| « Je vais réfléchir », « concurrent moins cher », « pas le temps » : réponses sans donnée ni demande de décision | Rappel factuel de l'offre (montant, validité) + question de conclusion (méthode P.R.O.V.E.) |
| « Concurrent moins cher » : « votre demande de remise dépasse… » alors qu'aucune remise n'était demandée | Message de transfert réservé aux demandes de remise ; comparaison sur bases identiques |
| « Je n'ai besoin de rien » non reconnu (classé « autre ») | Analyse des objections enrichie |
| Rendez-vous accepté sans proposer de créneau | Proposition d'un point de 15 minutes et question sur le créneau (aucun créneau inventé) |
| Réclamation « Quand serai-je livré ? » : pas de réponse et proposition de commande | Question de délai détectée → vérification annoncée, aucune vente tant que le problème n'est pas réglé |
| Remise de 1 % accordée noyée dans un argumentaire contradictoire | Réponse courte : remise accordée dans la politique + validation |

## Itération 1 → 2 : relecture humaine des réponses (au-delà du score)

| Constat | Correction |
|---|---|
| Acheteur agacé (« vos relances m'agacent ») : LÉA renvoyait une offre révisée — pression excessive | « Pas besoin » : plus aucune offre envoyée d'office ; un seul point chiffré + rendez-vous court |
| Même engagement répété deux fois dans un message | Phrase dupliquée supprimée ; l'évaluateur pénalise désormais les répétitions |

## Corrections de l'évaluateur (transparence)

- Plus strict : « préparer / lancer la commande » compte désormais comme sollicitation commerciale (refus, réclamation) ; répétitions pénalisées.
- Plus juste : pour une opposition ou une réclamation, la note « objections » porte sur la prise en compte et l'engagement
  (pas de « défense » d'offre) ; après un accord, un engagement de suivi vaut conclusion.

## Failles de sécurité révélées par les tests adverses (corrigées en production)

| Faille | Correction |
|---|---|
| Une date de livraison inventée par le modèle réel n'était bloquée par aucun garde-fou | Garde-fou « délai non confirmé » dans `features/agent/guards.ts` → repli sur la réponse sûre |
| Un prix inventé par le modèle réel n'était bloqué par aucun garde-fou | Garde-fou « montant absent des données vérifiées » (offre, lignes, conditions, montants cités par le client) |
| Faux positif du nouveau garde-fou (« je vous appelle 10 minutes » lu comme une date) | Expression corrigée (limite de mot) |

## Défaut révélé par l'examen final (corrigé)

- Opportunité de réassort de 240 références : la clé de dédoublonnage dépassait la taille maximale d'un index PostgreSQL
  (8 952 > 8 191 octets) → l'analyse échouait pour les très grands comptes. Clé condensée (SHA-1) au-delà de 8 produits.
