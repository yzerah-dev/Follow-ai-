-- =====================================================================
-- Follow.AI — Schéma principal multi-tenant
-- Toutes les tables métier portent organization_id.
-- Les clés étrangères métier sont composites (organization_id, id) afin
-- qu'aucune ligne ne puisse référencer une ligne d'une autre organisation.
-- Montants : numeric (jamais de float).
-- =====================================================================

create schema if not exists app;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type public.member_role as enum ('owner', 'admin', 'manager', 'commercial', 'read_only');
create type public.customer_status as enum ('prospect', 'active', 'dormant', 'lost', 'blocked');
create type public.invoice_doc_type as enum ('invoice', 'credit_note');
create type public.invoice_status as enum ('issued', 'cancelled');
create type public.payment_status as enum ('unknown', 'unpaid', 'partially_paid', 'paid', 'overdue');
create type public.availability_status as enum ('in_stock', 'low_stock', 'out_of_stock', 'on_order', 'unknown');
create type public.offer_status as enum ('draft', 'pending_approval', 'approved', 'sent', 'negotiation', 'accepted', 'rejected', 'expired');
create type public.opportunity_type as enum ('reorder', 'dormant_customer', 'new_product', 'cross_sell', 'campaign', 'unclosed_offer', 'appointment');
create type public.opportunity_status as enum ('open', 'in_progress', 'converted', 'dismissed', 'expired');
create type public.channel as enum ('email', 'whatsapp', 'linkedin', 'sms', 'phone');
create type public.connection_status as enum ('not_connected', 'needs_configuration', 'connected', 'error', 'expired');
create type public.message_direction as enum ('inbound', 'outbound');
create type public.message_status as enum ('draft', 'pending_approval', 'approved', 'sent', 'simulated_sent', 'delivered', 'failed', 'received');
create type public.conversation_status as enum ('open', 'waiting_customer', 'waiting_us', 'closed');
create type public.memory_certainty as enum ('verified_fact', 'declared', 'hypothesis');
create type public.approval_status as enum ('pending', 'approved', 'rejected');
create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed');
create type public.task_status as enum ('pending', 'done', 'cancelled');
create type public.asset_validation as enum ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------------------
-- Organisations & membres
-- ---------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,64}$'),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'commercial',
  display_name text,
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index on public.organization_members (user_id);

create table public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  currency char(3) not null default 'EUR',
  locale text not null default 'fr-FR',
  timezone text not null default 'Europe/Paris',
  -- Politique commerciale (configurable par entreprise)
  max_auto_discount_pct numeric(5,2) not null default 0 check (max_auto_discount_pct between 0 and 100),
  require_discount_approval boolean not null default true,
  require_message_approval boolean not null default true,
  dormant_after_days integer not null default 120 check (dormant_after_days between 15 and 1000),
  reorder_lookahead_days integer not null default 21 check (reorder_lookahead_days between 1 and 120),
  offer_validity_days integer not null default 30 check (offer_validity_days between 1 and 365),
  policy_name text,
  brand jsonb not null default '{}'::jsonb,
  lea_settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.document_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  last_value integer not null default 0,
  primary key (organization_id, kind)
);

-- ---------------------------------------------------------------------
-- Clients & contacts
-- ---------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  external_code text,
  legal_name text not null check (length(legal_name) between 1 and 300),
  trade_name text,
  country char(2) default 'FR',
  address_line1 text,
  address_line2 text,
  postal_code text,
  city text,
  phone text,
  email text,
  website text,
  owner_user_id uuid references auth.users(id) on delete set null,
  segment text,
  status public.customer_status not null default 'active',
  payment_terms text,
  min_order_amount numeric(14,2) check (min_order_amount >= 0),
  franco_amount numeric(14,2) check (franco_amount >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, external_code)
);
create index on public.customers (organization_id, status);
create index on public.customers (organization_id, legal_name);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salutation text check (salutation in ('M.', 'Mme') or salutation is null),
  first_name text,
  last_name text,
  email text,
  phone text,
  mobile text,
  linkedin_url text,
  title text,
  consent_email boolean not null default false,
  consent_sms boolean not null default false,
  consent_whatsapp boolean not null default false,
  consent_source text,
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index contacts_org_email_uq on public.contacts (organization_id, lower(email)) where email is not null;

-- Un contact peut appartenir à plusieurs sociétés ; une société a plusieurs contacts.
create table public.customer_contacts (
  organization_id uuid not null,
  customer_id uuid not null,
  contact_id uuid not null,
  job_function text,
  is_primary boolean not null default false,
  can_receive_offers boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (customer_id, contact_id),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete cascade
);
create index on public.customer_contacts (organization_id, contact_id);

-- ---------------------------------------------------------------------
-- Produits, tarifs, stocks
-- ---------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reference text not null,
  ean text check (ean is null or ean ~ '^[0-9]{8,14}$'),
  brand text,
  name text not null,
  description text,
  category text,
  packaging_notes text,
  length_cm numeric(10,2),
  width_cm numeric(10,2),
  height_cm numeric(10,2),
  weight_kg numeric(10,3),
  units_per_case integer check (units_per_case > 0),      -- colisage
  pcb integer check (pcb > 0),                             -- par combien
  sale_price_ht numeric(14,4) check (sale_price_ht >= 0),  -- tarif général
  vat_rate numeric(5,2) not null default 20.00 check (vat_rate between 0 and 100),
  availability public.availability_status not null default 'unknown',
  available_from date,
  min_order_qty integer check (min_order_qty > 0),
  marketing_points text[] not null default '{}',
  is_new boolean not null default false,
  launched_at date,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, reference)
);
create index on public.products (organization_id, category);
create index on public.products (organization_id, ean);

-- Prix d'achat isolés : lisibles uniquement par owner/admin/manager.
create table public.product_purchase_costs (
  organization_id uuid not null,
  product_id uuid not null,
  purchase_price_ht numeric(14,4) not null check (purchase_price_ht >= 0),
  updated_at timestamptz not null default now(),
  primary key (product_id),
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete cascade
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id uuid not null,
  reference text not null,
  ean text,
  label text not null,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete cascade,
  unique (organization_id, reference)
);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id uuid not null,
  storage_path text not null,
  kind text not null default 'source' check (kind in ('source', 'packaging', 'generated', 'demo_placeholder')),
  is_primary boolean not null default false,
  alt text,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete cascade
);
create index on public.product_images (organization_id, product_id);

create table public.product_prices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id uuid not null,
  customer_id uuid,                              -- null = liste de prix générale
  price_list text not null default 'general',
  unit_price_ht numeric(14,4) not null check (unit_price_ht >= 0),
  min_qty integer not null default 1 check (min_qty > 0),
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from),
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete cascade,
  foreign key (organization_id, customer_id) references public.customers(organization_id, id) on delete cascade
);
create index on public.product_prices (organization_id, product_id, customer_id);

create table public.inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id uuid not null,
  qty_on_hand numeric(14,3) not null,
  qty_available numeric(14,3),
  captured_at timestamptz not null default now(),
  source text not null default 'import',
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete cascade
);
create index on public.inventory_snapshots (organization_id, product_id, captured_at desc);

-- ---------------------------------------------------------------------
-- Imports
-- ---------------------------------------------------------------------
create table public.imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity text not null check (entity in ('customers', 'contacts', 'products', 'prices', 'inventory', 'invoices')),
  filename text not null,
  file_sha256 text not null,
  status text not null default 'uploaded' check (status in ('uploaded', 'mapped', 'processing', 'completed', 'failed')),
  mapping jsonb not null default '{}'::jsonb,
  total_rows integer not null default 0,
  ok_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  error_rows integer not null default 0,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (organization_id, id)
);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  import_id uuid not null,
  row_no integer not null,
  raw jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'imported', 'updated', 'skipped_duplicate', 'error')),
  errors jsonb not null default '[]'::jsonb,
  entity_id uuid,
  foreign key (organization_id, import_id) references public.imports(organization_id, id) on delete cascade,
  unique (import_id, row_no)
);

-- ---------------------------------------------------------------------
-- Factures (sources principales de l'intelligence commerciale)
-- ---------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_number text not null,
  customer_id uuid not null,
  invoice_date date not null,
  currency char(3) not null default 'EUR',
  total_ht numeric(14,2) not null,
  total_vat numeric(14,2) not null,
  total_ttc numeric(14,2) not null,
  doc_type public.invoice_doc_type not null default 'invoice',
  status public.invoice_status not null default 'issued',
  payment_status public.payment_status not null default 'unknown',
  external_ref text,
  related_invoice_id uuid,
  import_id uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, invoice_number, doc_type),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id) on delete restrict,
  foreign key (organization_id, related_invoice_id) references public.invoices(organization_id, id) on delete set null (related_invoice_id),
  foreign key (organization_id, import_id) references public.imports(organization_id, id) on delete set null (import_id)
);
create index on public.invoices (organization_id, customer_id, invoice_date desc);
create index on public.invoices (organization_id, invoice_date desc);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  invoice_id uuid not null,
  line_no integer not null,
  product_id uuid,
  product_reference text,
  ean text,
  description text not null,
  quantity numeric(14,3) not null,
  unit text not null default 'U',
  unit_price_ht numeric(14,4) not null,
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  vat_rate numeric(5,2) not null default 20.00,
  line_total_ht numeric(14,2) not null,
  units_per_case integer,
  unique (invoice_id, line_no),
  foreign key (organization_id, invoice_id) references public.invoices(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete set null (product_id)
);
create index on public.invoice_lines (organization_id, product_id);
create index on public.invoice_lines (organization_id, invoice_id);

-- ---------------------------------------------------------------------
-- Campagnes
-- ---------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  starts_on date,
  ends_on date,
  discount_pct numeric(5,2) check (discount_pct between 0 and 100),
  status text not null default 'draft' check (status in ('draft', 'active', 'ended')),
  target_categories text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.campaign_products (
  organization_id uuid not null,
  campaign_id uuid not null,
  product_id uuid not null,
  special_price_ht numeric(14,4) check (special_price_ht >= 0),
  primary key (campaign_id, product_id),
  foreign key (organization_id, campaign_id) references public.campaigns(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Agent : exécutions, décisions, mémoire
-- ---------------------------------------------------------------------
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  status public.job_status not null default 'queued',
  idempotency_key text,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  provider text,
  model text,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_usd numeric(12,6) not null default 0,
  triggered_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key)
);

-- ---------------------------------------------------------------------
-- Offres
-- ---------------------------------------------------------------------
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  type public.opportunity_type not null,
  product_ids uuid[] not null default '{}',
  title text not null,
  justification text not null,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  estimated_value_ht numeric(14,2) check (estimated_value_ht >= 0),   -- null = inconnu
  priority integer not null default 50 check (priority between 0 and 100),
  recommended_action text not null,
  suggested_date date,
  data_sources jsonb not null default '[]'::jsonb,
  details jsonb not null default '{}'::jsonb,
  status public.opportunity_status not null default 'open',
  dedupe_key text not null,
  expires_at timestamptz,
  offer_id uuid,
  run_id uuid,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id) on delete cascade,
  foreign key (organization_id, run_id) references public.agent_runs(organization_id, id) on delete set null (run_id)
);
-- Anti-doublon : une seule opportunité active par clé.
create unique index opportunities_active_dedupe_uq on public.opportunities (organization_id, dedupe_key)
  where status in ('open', 'in_progress');
create index on public.opportunities (organization_id, status, priority desc);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number text not null,
  customer_id uuid not null,
  contact_id uuid,
  owner_user_id uuid references auth.users(id) on delete set null,
  offer_date date not null default current_date,
  valid_until date,
  status public.offer_status not null default 'draft',
  source text not null default 'manual' check (source in ('manual', 'opportunity', 'campaign', 'lea')),
  opportunity_id uuid,
  campaign_id uuid,
  conditions text,
  currency char(3) not null default 'EUR',
  subtotal_ht numeric(14,2) not null default 0,
  discount_total_ht numeric(14,2) not null default 0,
  total_ht numeric(14,2) not null default 0,
  total_vat numeric(14,2) not null default 0,
  total_ttc numeric(14,2) not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  arguments jsonb not null default '[]'::jsonb,
  sent_at timestamptz,
  outcome text check (outcome in ('won', 'lost') or outcome is null),
  outcome_amount_ht numeric(14,2),
  created_by_agent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, number),
  check (valid_until is null or valid_until >= offer_date),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id) on delete restrict,
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete set null (contact_id),
  foreign key (organization_id, opportunity_id) references public.opportunities(organization_id, id) on delete set null (opportunity_id),
  foreign key (organization_id, campaign_id) references public.campaigns(organization_id, id) on delete set null (campaign_id)
);
create index on public.offers (organization_id, status);
create index on public.offers (organization_id, customer_id);

alter table public.opportunities
  add foreign key (organization_id, offer_id) references public.offers(organization_id, id) on delete set null (offer_id);

create table public.offer_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  offer_id uuid not null,
  line_no integer not null,
  product_id uuid not null,
  description text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price_ht numeric(14,4) not null check (unit_price_ht >= 0),
  price_source text not null,
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  vat_rate numeric(5,2) not null,
  line_total_ht numeric(14,2) not null,
  rationale text,
  unique (offer_id, line_no),
  foreign key (organization_id, offer_id) references public.offers(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete restrict
);

-- Demandes de commande (distinctes des factures et des encaissements)
create table public.order_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number text not null,
  offer_id uuid not null,
  customer_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'sent_to_erp', 'cancelled')),
  lines jsonb not null,
  total_ht numeric(14,2) not null,
  total_ttc numeric(14,2) not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, number),
  unique (organization_id, offer_id),
  foreign key (organization_id, offer_id) references public.offers(organization_id, id) on delete restrict,
  foreign key (organization_id, customer_id) references public.customers(organization_id, id) on delete restrict
);

-- ---------------------------------------------------------------------
-- Communications
-- ---------------------------------------------------------------------
create table public.communication_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel public.channel not null,
  provider text not null,
  status public.connection_status not null default 'not_connected',
  simulation_enabled boolean not null default false,
  display_name text,
  config jsonb not null default '{}'::jsonb,   -- non secret uniquement
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, channel, provider)
);

-- Secrets chiffrés côté application (AES-256-GCM). Aucun accès pour le rôle authenticated.
create table public.connection_secrets (
  connection_id uuid primary key references public.communication_connections(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid,
  contact_id uuid,
  channel public.channel not null,
  subject text,
  status public.conversation_status not null default 'open',
  assigned_user_id uuid references auth.users(id) on delete set null,
  offer_id uuid,
  last_message_at timestamptz,
  next_action text,
  identity_confidence text not null default 'verified' check (identity_confidence in ('verified', 'probable', 'unknown')),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id) on delete set null (customer_id),
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete set null (contact_id),
  foreign key (organization_id, offer_id) references public.offers(organization_id, id) on delete set null (offer_id)
);
create index on public.conversations (organization_id, customer_id, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  direction public.message_direction not null,
  channel public.channel not null,
  from_address text,
  to_address text,
  subject text,
  body text not null,
  attachments jsonb not null default '[]'::jsonb,
  status public.message_status not null,
  provider_message_id text,
  ai_generated boolean not null default false,
  ai_analysis jsonb,
  handled boolean not null default false,
  reply_to_message_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, conversation_id) references public.conversations(organization_id, id) on delete cascade
);
create index on public.messages (organization_id, conversation_id, created_at);
create unique index messages_provider_uq on public.messages (organization_id, channel, provider_message_id) where provider_message_id is not null;

create table public.communication_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid,
  conversation_id uuid,
  message_id uuid,
  event_type text not null,
  simulated boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, connection_id) references public.communication_connections(organization_id, id) on delete set null (connection_id),
  foreign key (organization_id, message_id) references public.messages(organization_id, id) on delete set null (message_id)
);

create table public.suppression_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel public.channel not null,
  address text not null,          -- normalisé (email minuscule, téléphone E.164)
  reason text not null default 'unsubscribe',
  created_at timestamptz not null default now(),
  unique (organization_id, channel, address)
);

create table public.agent_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid,
  customer_id uuid,
  decision_type text not null,
  rationale text not null,
  payload jsonb not null default '{}'::jsonb,
  requires_approval boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (organization_id, run_id) references public.agent_runs(organization_id, id) on delete set null (run_id),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id) on delete set null (customer_id)
);
create index on public.agent_decisions (organization_id, created_at desc);

create table public.agent_memory (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid,
  kind text not null check (kind in ('preference', 'usual_products', 'objection', 'promise', 'appointment', 'followup_result', 'instruction', 'negotiation', 'next_action', 'note')),
  certainty public.memory_certainty not null,
  content text not null check (length(content) <= 4000),
  data jsonb not null default '{}'::jsonb,
  source text not null,
  valid_until timestamptz,          -- au-delà : donnée périmée
  created_by_agent boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id) on delete cascade
);
create index on public.agent_memory (organization_id, customer_id, created_at desc);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_type text not null check (subject_type in ('offer', 'message', 'discount', 'creative_asset')),
  subject_id uuid not null,
  status public.approval_status not null default 'pending',
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  requested_by_agent boolean not null default false,
  requested_by uuid references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null))
);
create unique index approvals_pending_uq on public.approvals (organization_id, subject_type, subject_id) where status = 'pending';
create index on public.approvals (organization_id, status);

create table public.followup_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid,
  conversation_id uuid,
  offer_id uuid,
  kind text not null check (kind in ('followup', 'call', 'reply', 'meeting', 'order', 'escalation')),
  title text not null,
  due_at timestamptz not null,
  status public.task_status not null default 'pending',
  assigned_user_id uuid references auth.users(id) on delete set null,
  idempotency_key text,
  notes text,
  created_by_agent boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id) on delete cascade,
  foreign key (organization_id, conversation_id) references public.conversations(organization_id, id) on delete set null (conversation_id),
  foreign key (organization_id, offer_id) references public.offers(organization_id, id) on delete set null (offer_id)
);
create index on public.followup_tasks (organization_id, status, due_at);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  contact_id uuid,
  kind text not null check (kind in ('visio', 'showroom', 'visit', 'call')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'cancelled', 'done')),
  notes text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id) on delete set null (contact_id)
);

-- ---------------------------------------------------------------------
-- Studio créatif
-- ---------------------------------------------------------------------
create table public.creative_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('product_sheet', 'offer_pdf', 'offer_excel', 'catalog', 'poster')),
  name text not null,
  version integer not null default 1 check (version > 0),
  definition jsonb not null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, kind, name, version)
);

create table public.creative_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  status public.job_status not null default 'queued',
  offer_id uuid,
  product_ids uuid[] not null default '{}',
  template_id uuid,
  input jsonb not null default '{}'::jsonb,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, offer_id) references public.offers(organization_id, id) on delete cascade,
  foreign key (organization_id, template_id) references public.creative_templates(organization_id, id) on delete set null (template_id)
);

create table public.generated_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  creative_job_id uuid,
  offer_id uuid,
  product_id uuid,
  kind text not null,
  filename text not null,
  storage_path text not null,
  mime_type text not null,
  byte_size integer not null check (byte_size >= 0),
  sha256 text not null,
  template_version integer,
  is_generative boolean not null default false,
  validation_status public.asset_validation not null default 'pending',
  validation_report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (organization_id, creative_job_id) references public.creative_jobs(organization_id, id) on delete set null (creative_job_id),
  foreign key (organization_id, offer_id) references public.offers(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete cascade
);
create index on public.generated_assets (organization_id, offer_id);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_type text not null check (owner_type in ('customer', 'product', 'offer', 'invoice', 'organization')),
  owner_id uuid not null,
  name text not null,
  storage_path text not null,
  mime_type text not null,
  byte_size integer not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Journal d'audit (append-only)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_type text not null check (actor_type in ('user', 'agent', 'system')),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_logs (organization_id, created_at desc);

create or replace function app.forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs est en ajout seul';
end $$;
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function app.forbid_mutation();

-- updated_at automatique
create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
do $$
declare t text;
begin
  foreach t in array array['customers','contacts','products','offers','opportunities','communication_connections','organization_settings'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;
