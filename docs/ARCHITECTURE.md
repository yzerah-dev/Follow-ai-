# Architecture

```
app/                    Pages (App Router) et actions serveur — couche fine
  (app)/                Espace authentifié : accueil, clients, factures, produits, offres, conversations, connexions, paramètres
  actions/              Actions serveur : validation Zod, rôle, rate limit, appel aux services, revalidation
  api/                  Fichiers privés (assets, images), fiche produit, cron LÉA, webhook email, santé
components/ui           Primitives (style shadcn/ui : Button, Card, Badge, Table…)
components/app          Composants applicatifs (sidebar, panneau LÉA, studio créatif, validations)
features/
  invoices/analytics    Intelligence commerciale déterministe (CA net, cycles, habitudes, co-achats)
  opportunities/        Moteur d'opportunités (engine pur + service DB idempotent)
  offers/               Tarifs, politique commerciale, construction d'offres, cycle de vie, demande de commande
  agent/                LÉA : prompts, schémas, cerveau simulé, garde-fous, orchestration (lea.ts)
  conversations/        Validation/envoi, ingestion entrante, simulation de réponse
  creative-studio/      Templates, générateurs PDF/Excel, validation, service
  imports/              Définitions, parsing CSV/XLSX, validation, upserts idempotents
  customers/, dashboard/, settings/
lib/
  database/             Pool pg, withUser/withAgent/withPrivileged, migrations, insertions en lot
  auth/                 Session signée (jose), fournisseur local bcrypt, contexte, rôles
  ai/                   Adaptateur LLM (mock | Anthropic), images (désactivé)
  integrations/         Adaptateurs de canaux (email simulé, connecteurs officiels en attente)
  security/             Données non fiables, chiffrement, webhooks, rate limit, audit
  documents/pdf.ts      Composition PDF contrôlée
  storage/              Stockage privé (local ; Supabase Storage en production)
supabase/migrations     Schéma, RLS, stockage
supabase/local          Shim Supabase pour PostgreSQL local (rôles, auth.uid())
tests/unit|integration|e2e
```

## Flux d'une requête
1. `proxy.ts` redirige vers `/login` sans cookie de session.
2. `requireContext()` vérifie le JWT de session et l'appartenance à l'organisation active (lue sous RLS).
3. L'action serveur vérifie le rôle (`canWrite`, `canManage`, `isAdmin`), valide les entrées (Zod), applique un rate limit.
4. Le service s'exécute dans `withUser(userId)` : transaction `set local role authenticated` + `request.jwt.claims` →
   la **RLS PostgreSQL** est la barrière finale, identique à Supabase/PostgREST.
5. Les jobs (cron LÉA, webhooks) utilisent `withAgent(orgId)` : claims `agent_org`, limités par la RLS à une seule organisation.

## Tâches asynchrones
- Imports : `after()` (Next.js) exécute le traitement après la réponse HTTP ; l'interface se rafraîchit jusqu'à la fin.
- Planification quotidienne de LÉA : `GET /api/cron/daily-plan` (Vercel Cron, `CRON_SECRET`), idempotente par jour et par organisation.
- Inngest était prévu ; écarté temporairement (dépendance zod 3 vulnérable) — voir DECISIONS.md. Les services sont écrits pour être
  appelés tels quels depuis une fonction Inngest.
