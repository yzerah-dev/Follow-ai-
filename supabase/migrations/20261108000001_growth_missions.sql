-- =====================================================================
-- Follow.AI — Cerveau commercial : 6 missions permanentes de LÉA
-- Réactivation · Permanents · Complémentaires & retours en stock · Nouveautés · Rendez-vous · Objectifs de CA
-- =====================================================================

-- Nouveaux types d'opportunités (non utilisés dans cette transaction : compatible ADD VALUE)
alter type public.opportunity_type add value if not exists 'back_in_stock';
alter type public.opportunity_type add value if not exists 'target_gap';

-- Objectifs de chiffre d'affaires par client (annuel ou mensuel)
create table public.customer_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  period_type text not null check (period_type in ('year', 'month')),
  period_start date not null,
  target_ht numeric(14,2) not null check (target_ht > 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, customer_id, period_type, period_start),
  check ((period_type = 'year' and extract(doy from period_start) = 1) or (period_type = 'month' and extract(day from period_start) = 1)),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id) on delete cascade
);
create index on public.customer_targets (organization_id, customer_id);
create trigger customer_targets_touch before update on public.customer_targets for each row execute function app.touch_updated_at();

alter table public.customer_targets enable row level security;
alter table public.customer_targets force row level security;
create policy customer_targets_select on public.customer_targets for select using (app.is_member(organization_id));
-- Objectifs fixés par les humains habilités (pas par l'agent, pas en lecture seule)
create policy customer_targets_insert on public.customer_targets for insert with check (auth.uid() is not null and app.can_write(organization_id));
create policy customer_targets_update on public.customer_targets for update using (auth.uid() is not null and app.can_write(organization_id)) with check (auth.uid() is not null and app.can_write(organization_id));
create policy customer_targets_delete on public.customer_targets for delete using (app.can_manage(organization_id));
grant select, insert, update, delete on public.customer_targets to authenticated, service_role;

-- Respect des refus et préférences de contact
alter table public.customers
  add column do_not_solicit boolean not null default false,       -- le client ne veut plus être sollicité
  add column solicit_paused_until date;                           -- pause après un refus
alter table public.contacts
  add column preferred_channel text check (preferred_channel in ('email', 'whatsapp', 'phone'));

-- Paramètres des missions
alter table public.organization_settings
  add column meeting_interval_days integer not null default 180 check (meeting_interval_days between 30 and 1000),
  add column contact_cooldown_days integer not null default 7 check (contact_cooldown_days between 0 and 90),
  add column refusal_cooldown_days integer not null default 60 check (refusal_cooldown_days between 0 and 365),
  add column target_alert_pct numeric(5,2) not null default 10 check (target_alert_pct between 0 and 100);

-- Tâches : plan d'accélération et rendez-vous à organiser
alter table public.followup_tasks drop constraint if exists followup_tasks_kind_check;
alter table public.followup_tasks add constraint followup_tasks_kind_check
  check (kind in ('followup', 'call', 'reply', 'meeting', 'order', 'escalation', 'plan'));
