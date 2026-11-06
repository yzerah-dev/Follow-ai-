# Sécurité et conformité

| Mesure | Mise en œuvre |
|---|---|
| Authentification | Session JWT HS256 signée (jose), cookie httpOnly/SameSite=Lax/Secure en prod, 12 h. Mots de passe bcrypt (pgcrypto, format Supabase Auth). |
| Autorisation | Rôles vérifiés dans les actions serveur **et** RLS PostgreSQL forcée (barrière finale). |
| Isolation | `organization_id` + FK composites + RLS ; tests `tests/integration/rls.test.ts` (16 cas) et E2E. |
| Agent | Claims `agent_org` (backend uniquement), ignorés si un utilisateur est présent ; jamais d'approbation, jamais de prix d'achat. |
| Validation | Zod sur toutes les entrées (actions, webhooks, sorties IA, imports). |
| Rate limiting | `lib/security/rate-limit.ts` (mémoire, par instance) sur login, LÉA, actions, webhooks. Production multi-instance : brancher Redis. |
| Secrets | AES-256-GCM (`APP_ENCRYPTION_KEY`) dans `connection_secrets`, table sans accès applicatif. |
| Fichiers | Stockage privé, chemins validés (anti-traversée), servis uniquement après contrôle RLS ; `nosniff`, `no-store`. |
| Webhooks | HMAC-SHA256 horodaté, anti-rejeu 5 min, comparaison à temps constant, taille bornée, idempotence. |
| Injection de prompt | Contenus externes encapsulés (`wrapUntrusted`), détection journalisée, outils et sorties typés, garde-fous déterministes, repli sur gabarit sûr. |
| En-têtes | X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, `poweredByHeader: false`. |
| Audit | `audit_logs` append-only (trigger), acteur non usurpable (RLS). |
| Envois | Liste d'opposition, consentement email requis pour une prospection, validation humaine, traçabilité `communication_events`. |

## RGPD (mécanismes techniques — ne remplace pas une validation juridique)
- Désinscription : détection automatique (« STOP », « désinscrire ») → `suppression_entries` ; blocage à l'envoi.
- Consentements par contact et par canal (`consent_email/sms/whatsapp`, source, date).
- Export / suppression : suppression d'une organisation en cascade (`on delete cascade`) ; export par requêtes SQL filtrées
  par `organization_id` (outil d'export self-service : à développer, voir PROGRESS.md).
- Minimisation : les prompts n'incluent que les données nécessaires ; aucun prix d'achat transmis à l'IA.

## Sauvegardes
Production : sauvegardes Supabase (PITR selon le plan) + Storage. Local : `pg_dump follow_ai`.

## Points à traiter avant production
CSP stricte, rate limit distribué, rotation des clés, MFA (Supabase Auth), revue des politiques Storage, pentest.
