# Studio créatif — LÉA Designer

Accessible depuis une offre (« Créer mes supports ») et depuis une fiche produit (« Fiche produit PDF »).

## Chaîne
données validées (RLS) → composition contrôlée → validation automatique → stockage privé versionné → validation humaine.

| Fonction | Implémentation | Statut |
|---|---|---|
| generateOfferPdf | pdf-lib, en-tête charte, tableau avec photos sources, totaux, conditions | ✅ testé |
| generateOfferExcel | ExcelJS, images dans les cellules, valeurs décimales figées | ✅ testé |
| generateProductSheet | PDF A4 | ✅ |
| generateCatalog | PDF grille 1-3 colonnes | ✅ |
| generateRetailPoster | PDF composition contrôlée (sans IA générative) | ✅ |
| generateProductVisual / LifestyleShooting / MerchandisingScene | `ImageGenerationAdapter` | ⛔ désactivé (aucun fournisseur validé) |
| validateDocument | lignes, quantités, prix, totaux recalculés, références/EAN fidèles, absence d'image générative et de valeurs internes | ✅ |
| validateBrandConsistency | couleur principale, raison sociale | ✅ |

Un document dont un contrôle échoue ne peut pas être validé. Seuls les documents validés sont joints aux emails.

## Fidélité produit
Les supports de fidélité utilisent exclusivement les photos sources (`product_images` approuvées). Packaging, logo, référence, EAN,
textes, contenance, prix, couleurs et forme ne sont jamais modifiés. Les visuels de démonstration sont étiquetés « Visuel de démo ».

## Templates
`creative_templates` : par organisation, par type, versionnés (`version`), définition validée par Zod (couleurs, options d'affichage,
pied de page, colonnes). Chaque asset enregistre la version utilisée et son empreinte SHA-256.

## ChatGPT Work
Aucune API officielle de pilotage n'est supposée. `ChatGptWorkAdapter` existe mais reste désactivé.
