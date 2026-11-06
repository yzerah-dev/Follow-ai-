# Formats d'import

Fichiers **CSV** (UTF-8, séparateur `;` ou `,` détecté, BOM accepté) ou **XLSX** (première feuille, ligne 1 = en-têtes).
**XLS** (Excel 97-2003) non pris en charge : aucune bibliothèque maintenue et sûre retenue (le paquet `xlsx` npm n'est plus maintenu
et présente des vulnérabilités connues) — enregistrer en XLSX ou CSV. Limites : 15 Mo, 100 000 lignes.

Les en-têtes sont associés automatiquement (synonymes FR/EN, sans accents ni casse) et modifiables avant import.
Nombres : `1 234,56`, `1.234,56`, `1234.56` acceptés. Dates : `JJ/MM/AAAA` ou `AAAA-MM-JJ`. EAN : clé de contrôle vérifiée.

Ordre conseillé : clients → contacts → produits → tarifs → stocks → factures.

| Entité | Clé naturelle (réimport = mise à jour) | Colonnes obligatoires |
|---|---|---|
| Clients | Code client | Code client, Raison sociale |
| Contacts | Email (+ lien au client) | Code client, Email |
| Produits | Référence | Référence, Désignation |
| Tarifs | Produit + client + qté min + début | Référence produit, Prix unitaire HT (code client vide = liste générale) |
| Stocks | nouveau relevé à chaque import | Référence produit, Stock physique |
| Factures | Numéro + type | Numéro, Code client, Date, Désignation, Quantité, Prix unitaire HT |

## Factures
Une ligne du fichier = une ligne de facture ; les lignes sont regroupées par numéro + type. Colonnes optionnelles :
Type (`facture`/`avoir`), Statut (`émise`/`annulée`), Règlement (`payée`, `non réglée`, `en retard`, `partiel`), Référence produit, EAN,
Remise %, TVA %, Montant ligne HT (sinon calculé). Les **avoirs** se saisissent en montants positifs avec Type = avoir.
Une facture déjà présente est **ignorée** (aucun double comptage). Totaux recalculés en décimal, TVA ventilée par taux.

Chaque import conserve : fichier (empreinte SHA-256), mapping, lignes brutes, statut par ligne, rapport d'erreurs.
Après import, LÉA recalcule automatiquement les opportunités.
