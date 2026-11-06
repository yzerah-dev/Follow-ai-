# Base de données

PostgreSQL (Supabase en production). Migrations : `supabase/migrations/`.

## Principes
- `organization_id` sur toutes les tables métier ; `unique (organization_id, id)` sur les tables référencées et
  **clés étrangères composites** : impossible de rattacher une facture d'une organisation à un client d'une autre.
- Montants `numeric(14,2)`, prix unitaires `numeric(14,4)`, quantités `numeric(14,3)`. Lus en chaîne puis `Decimal`.
- `updated_at` automatique ; `audit_logs` en ajout seul (trigger) ; `messages.created_at = clock_timestamp()`.
- Anti-doublons : index unique partiel `opportunities (organization_id, dedupe_key) where status in ('open','in_progress')`,
  `approvals` (une seule demande en attente par sujet), `invoices (organization_id, invoice_number, doc_type)`,
  `messages (organization_id, channel, provider_message_id)`, clés d'idempotence (`agent_runs`, `followup_tasks`, `communication_events`).

## Tables
| Domaine | Tables |
|---|---|
| Organisation | organizations, organization_members, organization_settings, document_counters |
| Clients | customers, contacts, customer_contacts (N-N, contacts partagés) |
| Produits | products, product_purchase_costs (restreinte), product_variants, product_images, product_prices, inventory_snapshots |
| Facturation | invoices (factures + avoirs, statut ≠ règlement), invoice_lines |
| Commercial | campaigns, campaign_products, opportunities, offers, offer_lines, order_requests |
| Communications | communication_connections, connection_secrets (aucun accès applicatif), conversations, messages, communication_events, suppression_entries |
| LÉA | agent_memory (fait vérifié / déclaré / hypothèse, `valid_until`), agent_runs (coûts, jetons), agent_decisions, approvals, followup_tasks, appointments |
| Studio | creative_templates (versionnés), creative_jobs, generated_assets (sha256, rapport de validation), documents |
| Imports | imports, import_rows |
| Conformité | suppression_entries, audit_logs |

## RLS (voir `20261106000002_rls.sql`)
- `app.member_role(org)` (security definer) ; `app.is_member`, `app.can_write` (tous sauf lecture seule + agent),
  `app.can_manage` (owner/admin/manager), `app.is_admin` (owner/admin).
- Politiques standard : lecture membre, écriture `can_write`, suppression `can_manage`.
- Spécifiques : prix d'achat (manage), paramètres et membres (admin), connexions (admin), approbations (décision humaine uniquement),
  audit (lecture manager+, insertion sans usurpation), secrets (aucune politique → inaccessibles).

## Synchronisation ERP (prévue)
`external_code`, `external_ref`, `import_id` et les upserts sur clés naturelles permettent une synchronisation incrémentale ;
un connecteur ERP réutilisera `features/imports/service.ts`.
