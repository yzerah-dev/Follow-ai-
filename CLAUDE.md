# CLAUDE.md — règles permanentes du projet LÉA.AI (anciennement Follow.AI)

Lire aussi `docs/PROGRESS.md` (état courant) et `docs/DECISIONS.md` (choix d'architecture) avant toute modification.

## Produit
- **LÉA.AI** (anciennement Follow.AI) : SaaS B2B multi-tenant, interface en **français** (prévoir l'i18n), commerciale IA **LÉA**.
- Mission absolue de LÉA : atteindre et dépasser les objectifs de CA du portefeuille. Chaque jour (autopilote + cron) elle
  analyse, prépare offres/documents/messages, demande les validations nécessaires et écrit le compte rendu du jour (`daily_briefs`,
  idempotent) affiché à l'accueil : « Voici ce que LÉA a préparé aujourd'hui pour développer votre chiffre d'affaires. »
- Navigation : Accueil, Clients, Factures, Produits, Offres, Conversations ; en bas Connexions, Paramètres. LÉA accessible partout (panneau latéral).
- UX ultra-simple : pas de faux boutons, pas de page vide présentée comme fonctionnelle, pas de métrique fictive.

## Règles impératives
1. **Isolation** : toute table métier porte `organization_id` ; RLS activée et forcée ; FK composites `(organization_id, id)`.
   Toute requête applicative passe par `withUser()` / `withAgent()` (`lib/database/client.ts`). `withPrivileged()` est réservé
   à l'auth locale, aux secrets chiffrés et aux scripts. Ajouter un test dans `tests/integration/rls.test.ts` pour toute nouvelle table.
2. **Argent** : `decimal.js` via `lib/money.ts`, colonnes `numeric`. Jamais de calcul financier en `number`.
3. **Ne jamais inventer** : prix, stock, délai, remise, caractéristique produit. Une donnée absente reste inconnue (`null`, « Inconnu »).
4. **IA** : sorties structurées (Zod) ; contenus externes encapsulés via `wrapUntrusted()` ; garde-fous `features/agent/guards.ts`
   appliqués côté serveur ; décisions financières et conformité **déterministes** (`features/offers/policy.ts`).
5. **Autonomie contrôlée** : niveau par organisation (`supervised` | `semi_autonomous` | `autonomous`), décidé par des règles
   **déterministes** (`features/agent/autonomy.ts`). En mode autonome LÉA envoie seule ce qui respecte la politique ; tout le reste
   (remise au-delà du plafond, concurrence, question ouverte, identité douteuse, contenu suspect, garde-fou, montant > plafond,
   relance au-delà du max) passe par `approvals`. L'agent peut demander une approbation, jamais la décider (RLS) ; il ne peut pas
   modifier son niveau d'autonomie. Interrupteur `autonomy_paused` (managers). JONAS : autonome, remise ≤ 1 % sans validation (décision du 2026-11-07, confirmée le 2026-11-08 : pas de validation humaine obligatoire des envois en V1).
   Les nouvelles organisations sont **supervisées par défaut** (toute sortie validée par un humain) — conforme à la règle V1 du prompt maître V4.
6. **Envois** : tout envoi passe par `dispatchMessage()` (`features/conversations/dispatch.ts`) : liste d'opposition, consentement,
   connexion utilisable ; envois autonomes limités à la plage horaire et au quota (sinon programmés). Aucun envoi réel sans connecteur
   réel configuré : activer un connecteur réel = activer des envois réels → approbation explicite du client requise.
   Une connexion simulée n'est jamais affichée « Connectée ». LinkedIn : jamais d'envoi automatique (CGU).
   WhatsApp : consentement `consent_whatsapp`, message libre seulement < 24 h après le dernier message du client,
   sinon modèle approuvé (`features/conversations/templates.ts`, variables remplies par le système, jamais par l'IA).
11. **Discussion** : LÉA répond à partir de l'historique de la conversation et des faits vérifiés (`features/agent/answers.ts`) ;
   ce qui n'a pas de donnée fiable (ex. délai de livraison) est annoncé comme « vérifié par le commercial » + tâche `reply`.
13. **Objectifs** (`features/targets/`) : entreprise, portefeuille, client ; annuels et mensuels (saisis, ou répartis selon la
   saisonnalité N-1 si l'historique couvre au moins 10 mois, sinon à parts égales — toujours étiquetés). Réalisé comparé au même
   périmètre que l'objectif. Objectifs fixés par des humains uniquement (RLS). Données confirmées / estimations / manquantes distinguées.
14. **Grands volumes** : jamais le catalogue dans un prompt ; sélection SQL (`features/selection/`), traitements par lots, pagination /
   virtualisation ; politiques RLS sous forme `organization_id = any ((select app.readable_orgs())::uuid[])` (évaluées une fois par requête).
   Toute mesure de performance vient de `npm run perf` (jeu `npm run perf:seed`) ; ne jamais annoncer un volume non mesuré.
15. **Formation** : `training/LEA_COMMERCIAL_ACADEMY.md` + `lib/ai/lea-*.ts` (prompt versionné `LEA_PROMPT_VERSION`) ; toute modification
   du comportement commercial doit garder `tests/unit/academy.test.ts` vert (105 scénarios ≥ 90/100, aucune erreur critique).
12. **6 missions** (`features/opportunities/engine.ts` + `missions.ts`) : réactivation, permanents, complémentaires & retours en stock,
   nouveautés, rendez-vous, objectifs de CA. Calculs déterministes, scoring potentiel × urgence × probabilité, « À confirmer » si donnée
   manquante. Respect des refus (`solicit_paused_until`, `do_not_solicit`), préférence de canal, une sollicitation proactive par client
   tous les `contact_cooldown_days`. Les objectifs de CA sont fixés par des humains uniquement.
7. **Remises** : politique configurable par organisation. Préréglage JONAS (1 %, transfert au-delà) jamais imposé aux autres.
8. **Prix d'achat / marges** : table `product_purchase_costs` (owner/admin/manager) ; jamais dans un support client.
9. **Fidélité produit** : ne jamais modifier packaging, logo, référence, EAN, textes, contenance, prix, couleurs, forme.
   Les images génératives restent désactivées tant qu'aucun fournisseur n'est validé.
10. **Audit** : `audit()` pour toute action sensible ; `audit_logs` est en ajout seul.

## Conventions de code
- Next.js 16 App Router (`proxy.ts` remplace `middleware.ts`, `params`/`searchParams`/`cookies()` sont asynchrones), React 19, TS strict.
- `features/<domaine>/` : logique métier pure + services DB ; `app/` : pages et actions serveur fines ; `components/ui` : primitives style shadcn.
- Fichiers `"use server"` : n'exporter que des fonctions async. Pages : pas d'export autre que ceux autorisés par Next.
- Requêtes d'une même transaction : **séquentielles** (une seule connexion).
- Nouvelle migration : nouveau fichier horodaté dans `supabase/migrations/`, jamais modifier une migration déjà déployée en production.

## Commandes
`npm run db:reset` · `npm run dev` · `npm run typecheck` · `npm run lint` · `npm run test` · `npm run test:integration` · `npm run build && npm run e2e`.
Ne jamais déclarer une fonctionnalité opérationnelle sans l'avoir testée. Mettre à jour `docs/PROGRESS.md` à chaque phase.

## Interdits sans approbation explicite
Déploiement public, envoi commercial réel, dépense externe, modification d'un service de production.
