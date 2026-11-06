# Règles commerciales

## Politique de remise (par organisation — `organization_settings`)
- `max_auto_discount_pct` : plafond que LÉA peut proposer. Au-delà : **transfert au commercial** (tâche `escalation`).
- `require_discount_approval` : si vrai, toute remise communiquée nécessite une validation humaine. Défaut : vrai.
- Défaut d'une nouvelle organisation : **0 %** (aucune remise automatique).
- **Préréglage pilote JONAS** (`JONAS_PILOT_POLICY`) : 1 % maximum, transfert au-delà, défense de la valeur,
  collecte quantité / référence / prix cible. **Mode autonome, remise ≤ 1 % envoyée sans validation** (décision du client, 2026-11-07).
  Jamais appliqué aux autres organisations.
- Une remise communiquée est **appliquée à l'offre** au moment de l'envoi (lignes, totaux) : la demande de commande la reflète.

## Autonomie (`features/agent/autonomy.ts`)
| Situation | Autonome | Semi-autonome | Supervisé |
|---|---|---|---|
| Offre ≤ plafond de montant, contact vérifié | envoi seul | envoi seul | validation |
| Remise ≤ plafond de la politique | envoi seul si l'org l'autorise | validation | validation |
| Remise > plafond, concurrence (escalade) | commercial | commercial | commercial |
| Accord / rendez-vous / objection simple | envoi seul (+ demande de commande / tâche RDV) | envoi seul | validation |
| Question ouverte, expéditeur non vérifié, contenu suspect, garde-fou | validation | validation | validation |
| Relance n ≤ max (défaut 2) | envoi seul | envoi seul | validation |
Envois autonomes : plage horaire (défaut lun-ven 8h30-18h30, Paris) et quota quotidien, sinon programmés au créneau suivant.
Interrupteur « Suspendre LÉA » (managers) : plus aucun envoi automatique.
- Le texte d'un message ne peut contenir aucun pourcentage supérieur à la décision du système (`checkMessage`).

## Construction d'une offre (`features/offers/builder.ts`)
1. Prix : tarif client valide > liste de prix générale valide > prix catalogue ; **sinon la ligne est exclue**.
2. Disponibilité : rupture sans date → exclue ; inconnue → avertissement « à confirmer » ; stock connu insuffisant → avertissement.
3. Quantités : arrondi au colis supérieur, minimum de commande produit.
4. Totaux HT/TVA/TTC en décimal, TVA ventilée par taux. Minimum de commande et franco client vérifiés (avertissements).
5. Statut initial « À valider », sauf en mode autonome pour une offre préparée par LÉA sous le plafond de montant (statut « Validée », décision tracée).

## Opportunités (`features/opportunities/engine.ts`)
| Type | Règle déterministe |
|---|---|
| Réassort | produit acheté ≥ 3 fois, prochaine échéance (dernier achat + intervalle moyen) dans l'horizon (21 j par défaut), retard ≤ max(30 j, cycle) |
| Client dormant | ≥ 2 factures et inactivité > max(seuil org, 2,5 × cycle) |
| Nouveauté | produit nouveau (< 120 j) dans une catégorie ≥ 25 % des achats du client, non encore acheté |
| Vente complémentaire | co-achats org : lift ≥ 2, support ≥ 4, confiance ≥ 0,25 |
| Campagne | campagne active contenant des produits déjà achetés |
| Offre non conclue | offre envoyée depuis ≥ 7 j sans résultat |
| Rendez-vous | CA 12 mois ≥ 10 k€ et baisse ≥ 30 % sur 90 j glissants |

Chaque opportunité porte justification, confiance, sources, priorité, action, date et **valeur estimée** (null si prix inconnu,
toujours libellée « estimée », jamais présentée comme une commande). Recalcul idempotent, expiration et historique conservé.

## Distinctions financières
Facture ≠ commande (`order_requests`) ≠ encaissement (`payment_status`). Avoirs soustraits, factures annulées exclues.
