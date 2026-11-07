-- V4 : objectifs entreprise / portefeuille, objectifs mensuels répartis par saisonnalité, compte rendu quotidien de LÉA.

-- Objectifs mensuels client : distinction saisie manuelle / répartition automatique (saisonnalité N-1)
alter table public.customer_targets add column source text not null default 'manual' check (source in ('manual', 'seasonality', 'prorata'));

-- Objectifs entreprise (scope company) et portefeuille d'un commercial (scope portfolio), fixés par des humains uniquement
create table public.sales_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope text not null check (scope in ('company', 'portfolio')),
  owner_user_id uuid references auth.users(id) on delete cascade,
  period_type text not null check (period_type in ('year', 'month')),
  period_start date not null,
  target_ht numeric(14,2) not null check (target_ht > 0),
  source text not null default 'manual' check (source in ('manual', 'seasonality', 'prorata')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  check ((scope = 'company' and owner_user_id is null) or (scope = 'portfolio' and owner_user_id is not null)),
  check ((period_type = 'year' and extract(doy from period_start) = 1) or (period_type = 'month' and extract(day from period_start) = 1))
);
create unique index sales_targets_uq on public.sales_targets (organization_id, scope, coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), period_type, period_start);
alter table public.sales_targets enable row level security;
alter table public.sales_targets force row level security;
create policy sales_targets_select on public.sales_targets for select using (organization_id = any ((select app.readable_orgs())::uuid[]));
-- Les objectifs sont fixés par des humains (gestion) : jamais par l'agent.
create policy sales_targets_insert on public.sales_targets for insert with check (auth.uid() is not null and organization_id = any ((select app.manageable_orgs())::uuid[]));
create policy sales_targets_update on public.sales_targets for update using (auth.uid() is not null and organization_id = any ((select app.manageable_orgs())::uuid[])) with check (auth.uid() is not null and organization_id = any ((select app.manageable_orgs())::uuid[]));
create policy sales_targets_delete on public.sales_targets for delete using (organization_id = any ((select app.manageable_orgs())::uuid[]));
grant select, insert, update, delete on public.sales_targets to authenticated, service_role;
create trigger sales_targets_touch before update on public.sales_targets for each row execute function app.touch_updated_at();

-- Compte rendu quotidien de LÉA (un par organisation et par jour, régénérable : idempotent)
create table public.daily_briefs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brief_date date not null,
  payload jsonb not null,
  run_report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, brief_date)
);
alter table public.daily_briefs enable row level security;
alter table public.daily_briefs force row level security;
create policy daily_briefs_select on public.daily_briefs for select using (organization_id = any ((select app.readable_orgs())::uuid[]));
create policy daily_briefs_insert on public.daily_briefs for insert with check (organization_id = any ((select app.writable_orgs())::uuid[]));
create policy daily_briefs_update on public.daily_briefs for update using (organization_id = any ((select app.writable_orgs())::uuid[])) with check (organization_id = any ((select app.writable_orgs())::uuid[]));
grant select, insert, update on public.daily_briefs to authenticated, service_role;
