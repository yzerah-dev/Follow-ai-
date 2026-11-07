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

## Objectifs de CA (mission 6 — `features/customers/targets.ts`)
- Objectif annuel (1er janvier) ou mensuel (1er du mois) fixé par un humain (l'agent ne peut pas, RLS).
- **CA réalisé** = factures émises − avoirs, hors annulations, du début de période à aujourd'hui.
- **Attendu à date** = objectif × part écoulée : saisonnalité N-1 du client si l'historique couvre la période précédente
  (première facture ≤ 45 j / 7 j après son début), sinon prorata temporis.
- **Écart** = réalisé − attendu ; « En retard » au-delà de `target_alert_pct` (10 %), « À confirmer » avant 5 % de la période.
- **Prévision de fin de période** = réalisé / part écoulée (rythme actuel).
- **Plan d'accélération** : leviers ouverts du client (réassort, réactivation, complémentaires, nouveautés…) ; la valeur affichée est
  la part du retard couverte par des leviers chiffrés, jamais un montant inventé.

## Mesure des résultats (`features/dashboard/performance.ts`)
Par mission, sur 90 jours : opportunités détectées / traitées, offres envoyées, gagnées, taux de conversion,
**commandes HT** (demandes de commande issues des offres), **CA facturé attribuable** = lignes de factures du client sur les produits de
l'offre émises dans les 45 jours suivant l'envoi, avoirs déduits, plafonné au montant de l'offre.

## Playbook des objections — persuasion par la donnée (`features/agent/playbook.ts`, `negotiation.ts`)
Une objection n'est pas un refus. Pour « trop cher », « pas de budget », « trop de stock », « pas besoin », « ça ne se vend pas » :
1. **Analyse de couverture** (`features/analytics/coverage.ts`) de chaque référence de l'offre :
   - ventes/jour : sorties caisse déclarées, sinon **estimation** = achats entre la 1re et la dernière commande / jours (H1) ;
   - stock : déclaré par le client (≤ 30 jours), sinon **estimation** = dernière commande − ventes estimées depuis (H2) ;
   - couverture = stock / ventes par jour ; risque : ≤ 7 j « rupture imminente », ≤ 21 j « à surveiller » ;
   - quantité recommandée = ventes par jour × cycle habituel − stock, arrondie au colisage ;
   - rotation lente : plus de 2 cycles sans achat, ou couverture > 2 cycles ;
   - confiance : vérifié (sorties caisse + stock déclaré) · déclaré · estimation fiable (≥ 4 commandes régulières) · moyenne · fragile.
   Inconnu ≠ 0 : une valeur absente reste `null` et s'affiche « Inconnu ».
2. **Stratégie** :
   - trop cher / budget : on garde les références à fort potentiel, on retire les rotations lentes, quantités ramenées au besoin ;
     un budget chiffré annoncé est respecté (références en rupture d'abord) ; **jamais plus cher** que l'offre initiale ;
   - trop de stock : le stock déclaré est enregistré (`customer_stock_reports`, source « customer_message ») ; seules les références
     à couvrir restent ; sinon reprise de contact datée (couverture − 7 jours, 45 jours au plus) sans nouvelle offre ;
     stock déclaré sans référence identifiable → LÉA demande laquelle avant de recalculer ;
   - pas besoin : seule la rupture imminente est proposée ; sinon la décision est respectée ;
   - ça ne se vend pas : la référence lente est retirée et remplacée par des compléments / nouveautés (quantité de découverte).
3. **Offre révisée** : nouvelle offre (source « lea »), l'ancienne passe « remplacée » (`supersedes_offer_id`) ; supports régénérés :
   PDF, Excel illustré, **analyse de couverture** (Excel, photos, hypothèses, niveau de confiance), catalogue si nouveautés.
   La révision remplace la remise (pas de double concession). En mode supervisé, l'offre et la réponse attendent une validation.
4. **Limites** : 2 révisions au plus par offre, puis le commercial reprend ; un refus explicite est définitif ;
   aucune fausse urgence, aucune estimation présentée comme un stock vérifié, aucune rentabilité promise, aucun autre client cité.
