-- Formation commerciale V2 : couverture de stock, stock déclaré par le client, offres révisées.

-- Une offre révisée après objection remplace la précédente (qui n'est ni gagnée ni perdue).
alter type public.offer_status add value if not exists 'superseded';
alter table public.offers add column supersedes_offer_id uuid;
alter table public.offers add constraint offers_supersedes_fk
  foreign key (organization_id, supersedes_offer_id) references public.offers(organization_id, id) on delete set null (supersedes_offer_id);

-- Stock ou ventes déclarés par le client (message, saisie du commercial, import de sorties caisse).
-- Une donnée déclarée n'est pas un stock vérifié : la source est toujours conservée et affichée.
create table public.customer_stock_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  product_id uuid,                                    -- null : déclaration globale (« il me reste beaucoup de stock »)
  qty_on_hand numeric(14,3) check (qty_on_hand >= 0), -- null = inconnu (≠ 0)
  units_sold_per_day numeric(14,4) check (units_sold_per_day >= 0), -- sorties caisse, si fournies
  source text not null check (source in ('customer_message', 'sales_rep', 'sell_out_import')),
  message_id uuid,
  note text,
  reported_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (organization_id, id),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete cascade,
  foreign key (organization_id, message_id) references public.messages(organization_id, id) on delete set null (message_id)
);
create index on public.customer_stock_reports (organization_id, customer_id, product_id, reported_at desc);

alter table public.customer_stock_reports enable row level security;
alter table public.customer_stock_reports force row level security;
create policy customer_stock_reports_select on public.customer_stock_reports for select using (app.is_member(organization_id));
create policy customer_stock_reports_insert on public.customer_stock_reports for insert with check (app.can_write(organization_id));
create policy customer_stock_reports_update on public.customer_stock_reports for update using (app.can_write(organization_id)) with check (app.can_write(organization_id));
create policy customer_stock_reports_delete on public.customer_stock_reports for delete using (app.can_manage(organization_id));
grant select, insert, update, delete on public.customer_stock_reports to authenticated, service_role;
