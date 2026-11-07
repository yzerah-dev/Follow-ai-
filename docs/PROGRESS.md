# Avancement — Follow.AI

_Mise à jour : 2026-11-08 — grands catalogues V3 (mesures : docs/PERFORMANCE.md)._

## Grands catalogues V3 (2026-11-08)
- Moteur de sélection (`features/selection/pipeline.ts`) : index produits, historique, fréquences, réassorts, permanents, retours en stock,
  compléments (co-achats SQL), nouveautés, vérification tarifs/disponibilités, classement, offre complète sans doublon (1 à 1 000 lignes),
  budget et catégories ; références à ne pas recommander listées avec motif. Le LLM ne reçoit qu'un résumé (catégories, 25 lignes).
- Plafonds du moteur d'opportunités relevés (40 nouveautés, 30 compléments, 50 références client inactif) ; index catalogue partagé,
  écritures par lots : analyse de l'organisation entière 51 s → 11,6 s sur 500 000 lignes.
- RLS : politiques réécrites (liste des organisations calculée une fois par requête) — accueil 8,2 s → 0,95 s, clients 9 s → 72 ms.
- Éditeur d'offre (`components/app/offer-editor.tsx`, `features/offers/editor.ts`) : virtualisation, recherche, filtres, tri, sélection
  multiple, modification en masse, exclusion, ajout de produit, doublons refusés, prix/colisage/remises recalculés serveur, sauvegarde
  automatique, révision (concurrence optimiste), historique (`offer_line_changes`), offre validée modifiée → nouvelle validation.
- Studio : Excel illustré enrichi (14 colonnes demandées), catalogue PDF, synthèse commerciale, sélection prioritaire, email personnalisé ;
  générations asynchrones (`creative_jobs` : progression, reprise sur erreur, reprise par le cron), images dédupliquées.
- Banc de charge : `npm run perf:seed` (20 000 produits, 5 000 clients, 499 500 lignes) puis `npm run perf` (budgets, rapport généré).


## Formation commerciale V2 (2026-11-08)
- Moteur de couverture de stock (`features/analytics/coverage.ts`) : ventes/jour, stock, couverture, risque de rupture, quantité
  recommandée, rotations lentes, compléments et nouveautés ; estimations étiquetées avec hypothèses et niveau de confiance.
- Playbook des objections (`features/agent/playbook.ts`) et négociation (`negotiation.ts`) : trop cher, pas de budget, trop de stock,
  pas besoin, ça ne se vend pas (nouvelle objection) → contre-arguments chiffrés, offre révisée, documents, question de décision.
- Stock déclaré par le client enregistré (`customer_stock_reports`, RLS testée) ; offres « remplacées » (`supersedes_offer_id`).
- Excel « analyse de couverture » illustré (colonnes demandées, Inconnu ≠ 0, onglet Méthode) joint aux offres révisées
  et téléchargeable depuis la fiche client (section « Couverture de stock »).
- Prompts système : personnalité (déterminée, persuasive, préparée, respectueuse) et méthode en 6 étapes ; interdits explicites.
- Détails des règles : `docs/COMMERCIAL_RULES.md` (section Playbook).


## Voix de LÉA (2026-11-08)
- Paramètres → **Voix de LÉA** : ton (chaleureux, dynamique, professionnel, expert), longueur, présentation transparente
  (« LÉA, assistante commerciale de … »), emojis WhatsApp, consignes de style (sans chiffres), canal prioritaire, canal de chaque relance.
- Messages adaptés à la situation : réassort (« répondez OK »), client inactif (reprise de contact), nouveauté (commande test), complément.
- Arguments factuels calculés (`features/agent/arguments.ts`) : meilleure vente (top 10 % des acheteurs sur 90 j), taux de réassort des magasins
  (≥ 6 sur 10, au moins 5 acheteurs), stock limité (≤ 3 × la quantité proposée), offre exceptionnelle (remise incluse). Jamais de client nommé, aucune marge.
- Objection prix : faits vérifiés, puis proposition d'ajuster les quantités ou une sélection plus courte ; remise ≤ plafond de la politique.
- Relances sur plusieurs canaux (ex. JONAS : J+1 WhatsApp, J+2 e-mail), 1 sollicitation tous les 2 jours pour JONAS.
- Déclaration du consentement des clients existants par l'entreprise (tracée dans l'audit) ; STOP et listes d'opposition toujours appliqués.
- Consigne IA mise à jour (plus de mention « brouillon soumis à validation »).
- JONAS (démo) : ton dynamique, e-mails moyens, emojis WhatsApp, style tiré des e-mails envoyés par l'équipe (sans chiffres ni noms).


## Direction artistique (2026-11-08)
- Palette violette (primaire #6e44ff), cartes arrondies 16–20 px, ombres douces ; carte LÉA (illustration, statut Active / Supervisée / Suspendue) dans la barre latérale.
- Navigation : Accueil, Clients, **Opportunités** (filtre par mission), **Actions** (validations, réponses, tâches, rendez-vous, activité de LÉA),
  Conversations, Produits, Offres, Factures, **Studio créatif** (supports générés, modèles), **Rapports** (résultats par mission, CA) ; bandeau de navigation mobile.
- Accueil : 4 indicateurs réels (CA du mois vs même période M-1, objectif annuel à date ou « À confirmer », clients actifs + nouveaux, actions à traiter),
  priorités du jour, carte LÉA avec « Lancer LÉA maintenant », 6 tuiles de missions, évolution du CA (6 mois, mois en cours en pointillés) et répartition
  permanents / nouveautés / complémentaires / autres (12 mois). Aucune valeur de la maquette n'est reprise.
- Pas de logos de marques clients (initiales) ; LÉA est une illustration SVG (déposer un visuel sous licence `public/lea.png` si souhaité) ;
  pas de carte « abonnement » tant que la facturation n'existe pas.


## Cerveau commercial — 6 missions (2026-11-08)
- Missions quotidiennes : réactivation, permanents, complémentaires & **retours en stock**, nouveautés (+ catalogue personnalisé),
  **rendez-vous** (non rencontrés / baisse de CA, invitation visio-téléphone-showroom, argumentaire au commercial),
  **objectifs de CA** (réalisé, attendu à date, écart, prévision, plan d'accélération).
- Fiche client : objectif CA (saisie), réalisé, écart, prévision, produits permanents (quantité conseillée), complémentaires,
  nouveautés recommandées, dernier / prochain rendez-vous, plan de développement, « ne plus solliciter ».
- Accueil : « Les priorités de LÉA aujourd'hui » (potentiel / urgence / probabilité) et résultats par mission (conversion, CA attribuable).
- Garde-fous : anti-doublons, pression commerciale (1 sollicitation / 7 j), pause après refus (60 j), préférences de canal.
- Mode supervisé : LÉA prépare désormais chaque jour (offres, supports, invitations, plans) au lieu de s'arrêter à l'analyse.
- **Décision client (2026-11-08)** : l'exigence « validation humaine des envois en V1 » est supprimée. JONAS reste en mode
  **autonome** (remise ≤ 1 % sans validation) ; le mode supervisé reste disponible par organisation dans Paramètres.

## Discussions multicanales (2026-11-07)
- **Conversations** : boîte unifiée filtrable (Toutes / Email / WhatsApp / À traiter), fil en bulles, badges (envoyé seul par LÉA,
  programmé, modèle WhatsApp, relance n°), fenêtre WhatsApp de 24 h affichée, réponse humaine possible dans le fil.
- **LÉA discute** : historique de conversation + réponses factuelles (prix, montant, validité, stock connu, franco, paiement, colisage,
  minimum) ; jamais de délai ou de stock inventé (le commercial est prévenu par une tâche).
- **WhatsApp** : premier contact et relances par modèles approuvés (PDF joint), messages libres dans les 24 h, STOP → opposition,
  numéros normalisés E.164, webhook Meta signé. Simulé en démo ; connecteur Meta écrit mais **non testé** (pas de compte).

## Mode autonome (2026-11-07)
Décision client : **JONAS en mode autonome, remise ≤ 1 % envoyée sans validation**. Livré et testé :
- 3 niveaux par organisation (supervisé / semi-autonome / autonome), règles déterministes, interrupteur « Suspendre LÉA ».
- Pilote automatique : opportunités → offres (plafond de montant, quota/jour) → PDF + Excel validés automatiquement si contrôles OK
  → email → envoi ou programmation (plage horaire, quota) → relances (2 max) → réponses aux clients → demande de commande sur accord.
- Remise accordée appliquée à l'offre ; escalade au commercial au-delà de 1 %, sur concurrence, question ouverte, contenu suspect.
- Accueil : « LÉA au travail » (envois du jour, programmés, transferts, dernières actions) et « Lancer LÉA maintenant ».
- Crons : `/api/cron/daily-plan` (jours ouvrés) et `/api/cron/dispatch` (toutes les 15 min).
- La démo « Négoce Beta » reste supervisée (les réglages JONAS ne sont pas imposés aux autres).
**Les envois restent SIMULÉS** tant qu'aucun connecteur réel (Gmail / Microsoft 365) n'est branché ; brancher un connecteur réel
activera des envois réels autonomes — à faire uniquement avec votre accord explicite au moment du branchement.

## Phases
| Phase | État |
|---|---|
| 0 — Initialisation | ✅ Next.js 16, TS strict, Tailwind 4, Vitest, Playwright, ESLint, .env.example, structure, docs |
| 1 — Socle SaaS | ✅ Auth locale, organisations, rôles, RLS forcée, layout/sidebar, accueil, paramètres, tests d'isolation |
| 2 — Données commerciales | ✅ Clients (fiche 360°), contacts partagés, factures + lignes + avoirs, produits, tarifs, stocks, offres, imports, recherche |
| 3 — Cerveau LÉA | ✅ Mémoire, analytique, opportunités (7 types), scoring, offres automatiques, journal des décisions, coûts — IA réelle non testée (pas de clé) |
| 4 — Communications | ✅ Conversations unifiées, brouillons IA, approbations, envoi **simulé**, réponses simulées, objections, relances, escalades, webhook entrant — connecteurs réels à configurer |
| 5 — Studio créatif | ✅ Offre PDF, Excel illustré, fiches, catalogue, affiche, validation, versionnement — génération d'images désactivée |
| 6 — Pilote | 🟡 Démo complète et scénario E2E OK ; restent : Supabase Storage, Supabase Auth, onboarding, déploiement (soumis à approbation) |

## Fonctionnalités opérationnelles (testées)
- Connexion / déconnexion, changement d'organisation, rôles (propriétaire, admin, manager, commercial, lecture seule).
- Cockpit : opportunités du jour avec justification, confiance et potentiel **estimé** ; validations ; réponses ; tâches ; résultats du mois (réels).
- Fiche client : CA net 12 mois, fréquence, panier, tendance, histogramme mensuel, produits habituels et prochain achat, opportunités,
  factures, contacts (consentement, partage), offres, conversations, mémoire de LÉA, prochaine action recommandée.
- Factures (facturé ≠ réglé), produits (tarifs, stock, prix d'achat réservé aux managers), offres (cycle complet), demande de commande.
- LÉA : préparation d'offre depuis une opportunité ou une fiche client ; email personnalisé ; analyse des réponses (10 objections,
  accord, rendez-vous, désinscription, absence) ; réponse respectant la politique (JONAS : 1 %, escalade au-delà) ; assistant latéral.
- Studio : génération, contrôles automatiques, aperçu, téléchargement, validation ; pièces jointes validées ajoutées à l'envoi.
- Imports CSV/XLSX : prévisualisation, mapping auto, validation, rapport, traitement asynchrone (`after()`), réimport sans doublon.
- Cron LÉA idempotent, webhook email signé, journal d'audit, liste d'opposition.

## Fonctionnalités simulées (clairement signalées)
- IA : `MockProvider` (badge « IA simulée »). Claude prêt (`LLM_PROVIDER=anthropic`) mais **non exécuté** faute de clé.
- Email : connexion « mode simulation » (badge « Envoi simulé » ; statut de connexion « Non connectée »).
- Réponses clients : outil de démonstration (`DEMO_TOOLS=true`).
- Données : 2 organisations fictives (`is_demo`, bandeau), 100 clients, 200 produits, ~1 700 factures / ~9 300 lignes par organisation,
  visuels produits de démonstration (dégradés étiquetés).

## Tests exécutés (2026-11-08, après la DA)
| Suite | Résultat |
|---|---|
| `npm run typecheck` | ✅ 0 erreur |
| `npm run lint` | ✅ 0 erreur, 0 avertissement |
| `npm run test` | ✅ 103/103 |
| `npm run test:integration` (PostgreSQL 16) | ✅ 66/66 (dont négociation, grands catalogues, 20 RLS) |
| `npm run perf` (20 000 produits, 500 000 lignes) | ✅ 27/27 budgets respectés — voir docs/PERFORMANCE.md |
| `npm run build` | ✅ |
| `npm run e2e` (Playwright, Chromium) | ✅ 6/6 (dont grand catalogue : éditeur, sauvegarde automatique, génération asynchrone) |

## Problèmes connus
- Rate limit en mémoire (par instance).
- Driver de stockage local uniquement : non persistant sur Vercel → implémenter Supabase Storage avant production.
- `AUTH_MODE=supabase` non implémenté (MFA, magic link, invitations).
- Une page « introuvable » rendue en streaming peut renvoyer HTTP 200 (contenu correct, aucune donnée exposée).
- Moteur d'opportunités : nombreuses opportunités « nouveauté / complémentaire » sur la démo (seuils à calibrer sur données réelles).
- Traitement d'import ligne par ligne (adapté à quelques dizaines de milliers de lignes ; à optimiser en lots pour l'ERP).

## Prochaines étapes
1. Driver Supabase Storage + adaptateur Supabase Auth ; écran d'onboarding (création d'organisation, invitations).
2. Fournir une clé `ANTHROPIC_API_KEY` de test pour valider le fournisseur Claude (évaluations sur réponses réelles anonymisées).
3. Connecteur Gmail / Microsoft 365 (OAuth, lecture des réponses, envoi après validation).
4. Édition manuelle des lignes d'offre ; rendez-vous (proposition de créneaux) ; portail B2B.
5. Export RGPD self-service ; rate limit Redis ; CSP stricte ; Inngest dès qu'une version compatible zod 4 est disponible.

## Intervention humaine nécessaire
| Besoin | Pourquoi | Comment | Ce qui continue sans |
|---|---|---|---|
| Clé API Anthropic | Activer le raisonnement IA réel | `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` dans l'environnement serveur | Tout, en IA simulée |
| Projet Supabase | Production multi-tenant | Créer le projet, appliquer les migrations (DEPLOYMENT.md) | Développement local complet |
| OAuth Gmail / M365 | Envoi et lecture réels | App Google Cloud / Entra ID, scopes listés dans INTEGRATIONS.md | Envoi simulé |
| WhatsApp / SMS / téléphonie | Canaux additionnels | Comptes fournisseurs officiels | Email |
| Données réelles JONAS | Calibrer LÉA | Exports CSV/XLSX clients, produits, tarifs, factures (IMPORT_FORMATS.md) | Démo fictive |
