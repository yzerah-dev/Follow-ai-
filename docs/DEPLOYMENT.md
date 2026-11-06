# Déploiement (Vercel + Supabase)

> Aucun déploiement n'a été effectué. Toute mise en production nécessite une approbation explicite.

## 1. Supabase
1. Créer le projet (région UE recommandée).
2. Appliquer les migrations `supabase/migrations/*.sql` dans l'ordre (`supabase db push` ou éditeur SQL).
   **Ne pas** appliquer `supabase/local/` (rôles et `auth` existent déjà). Le fichier `..._storage.sql` crée le bucket privé `follow-private`.
3. Chaîne de connexion **directe** (ou pooler en mode session) du rôle `postgres` → `DATABASE_URL`. L'application exécute chaque requête
   sous `set local role authenticated` + claims : la RLS s'applique.
4. Utilisateurs : en V1 l'auth locale lit `auth.users.encrypted_password` (bcrypt, format GoTrue) — compatible avec les comptes Supabase Auth
   à mot de passe. L'adaptateur `AUTH_MODE=supabase` (Supabase Auth complet : MFA, magic link, SSO) est à développer (voir PROGRESS.md).
5. Créer les organisations et membres (SQL ou futur écran d'onboarding). Ne pas exécuter le seed de démonstration en production.

## 2. Vercel
Variables : `DATABASE_URL`, `SESSION_SECRET` (≥ 32 car.), `APP_ENCRYPTION_KEY` (32 octets base64), `LLM_PROVIDER`, `ANTHROPIC_API_KEY`,
`LLM_MODEL`, `CRON_SECRET`, `WEBHOOK_SIGNING_SECRET`, `DEMO_TOOLS=false`.
Crons (`vercel.json`, en-tête `Authorization: Bearer $CRON_SECRET` ajouté par Vercel) :
`/api/cron/daily-plan` (jours ouvrés, journée de travail de LÉA) et `/api/cron/dispatch` (toutes les 15 min, envois programmés).
La fréquence 15 min nécessite un plan Vercel le permettant (sinon : planificateur externe appelant la même route).

## 3. Stockage
Le driver local écrit sous `./storage` (non persistant sur Vercel). **Avant production** : implémenter le driver Supabase Storage
derrière `lib/storage` (même convention `<organization_id>/...`, bucket privé, politiques déjà fournies).

## 4. Vérifications
`/api/health`, connexion, isolation (deux organisations de test), envoi désactivé tant qu'aucun connecteur réel n'est validé.
