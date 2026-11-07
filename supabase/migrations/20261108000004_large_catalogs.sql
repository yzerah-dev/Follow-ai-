-- Grands catalogues V3 : offres volumineuses éditables, historique des modifications, générations asynchrones.

-- Lignes d'offre enrichies (type de recommandation, historique d'achat, confiance) et sans doublon de produit
alter table public.offer_lines
  add column recommendation_type text check (recommendation_type in ('reorder', 'permanent', 'back_in_stock', 'complementary', 'new_product', 'manual')),
  add column confidence text check (confidence in ('verified', 'declared', 'high', 'medium', 'low')),
  add column purchase_count integer check (purchase_count >= 0),
  add column last_order_date date,
  add column history_qty numeric(14,3);
create unique index offer_lines_offer_product_uq on public.offer_lines (offer_id, product_id);
create index on public.offer_lines (organization_id, offer_id);

-- Version de l'offre (incrémentée à chaque sauvegarde de l'éditeur) : protège des écritures concurrentes
alter table public.offers add column revision integer not null default 1;

-- Historique des modifications de lignes (ajout seul)
create table public.offer_line_changes (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  offer_id uuid not null,
  product_id uuid,
  action text not null check (action in ('add', 'update', 'remove')),
  field text,
  old_value text,
  new_value text,
  revision integer not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_by_agent boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (organization_id, offer_id) references public.offers(organization_id, id) on delete cascade
);
create index on public.offer_line_changes (organization_id, offer_id, id desc);
alter table public.offer_line_changes enable row level security;
alter table public.offer_line_changes force row level security;
create policy offer_line_changes_select on public.offer_line_changes for select using (app.is_member(organization_id));
create policy offer_line_changes_insert on public.offer_line_changes for insert with check (app.can_write(organization_id));
grant select, insert on public.offer_line_changes to authenticated, service_role;

-- Générations lourdes asynchrones : progression, reprise sur erreur
alter table public.creative_jobs
  add column progress integer not null default 0,
  add column total integer not null default 0,
  add column attempts integer not null default 0,
  add column step text,
  add column result jsonb not null default '{}'::jsonb,
  add column started_at timestamptz,
  add column heartbeat_at timestamptz;
create index on public.creative_jobs (organization_id, status, created_at);

-- Requêtes du moteur de sélection : historique client × produit et co-achats
create index if not exists invoice_lines_org_invoice_product_idx on public.invoice_lines (organization_id, invoice_id, product_id);
create index if not exists products_org_new_idx on public.products (organization_id, category) where is_new and status = 'active';

-- Retirer une ligne d'offre fait partie du travail commercial courant (édition d'offre) : autorisé aux rôles d'écriture.
drop policy if exists offer_lines_delete on public.offer_lines;
create policy offer_lines_delete on public.offer_lines for delete using (app.can_write(organization_id));
