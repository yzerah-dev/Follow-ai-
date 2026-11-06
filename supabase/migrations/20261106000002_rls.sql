-- =====================================================================
-- Follow.AI — Row Level Security
-- Modèle :
--   * Utilisateur : claims {"sub": <user_id>, "role": "authenticated"}
--   * Agent LÉA (jobs serveur) : claims {"role": "authenticated", "agent_org": <org_id>}
--     -> l'agent ne voit QUE son organisation, ne peut jamais approuver,
--        ni lire les prix d'achat, ni administrer.
--   Les claims agent ne sont positionnés que par le backend (connexion serveur).
--   Les JWT Supabase Auth émis aux utilisateurs ne contiennent jamais "agent_org".
-- =====================================================================

create or replace function app.current_agent_org() returns uuid
language sql stable as $$
  select case when auth.uid() is null
    then nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'agent_org', '')::uuid
  end
$$;

create or replace function app.member_role(org uuid) returns public.member_role
language sql stable security definer set search_path = public, pg_temp as $$
  select m.role from public.organization_members m
  where m.organization_id = org and m.user_id = auth.uid() and m.status = 'active'
$$;

create or replace function app.is_member(org uuid) returns boolean
language sql stable as $$
  select coalesce(app.member_role(org) is not null, false) or coalesce(app.current_agent_org() = org, false)
$$;

create or replace function app.can_write(org uuid) returns boolean
language sql stable as $$
  select coalesce(app.member_role(org) in ('owner','admin','manager','commercial'), false)
      or coalesce(app.current_agent_org() = org, false)
$$;

create or replace function app.can_manage(org uuid) returns boolean
language sql stable as $$
  select coalesce(app.member_role(org) in ('owner','admin','manager'), false)
$$;

create or replace function app.is_admin(org uuid) returns boolean
language sql stable as $$
  select coalesce(app.member_role(org) in ('owner','admin'), false)
$$;

-- Prochain numéro de document (offres, commandes) — atomique, isolé par org.
create or replace function app.next_document_number(org uuid, doc_kind text, prefix text) returns text
language plpgsql security invoker as $$
declare v integer;
begin
  if not app.can_write(org) then raise exception 'not allowed'; end if;
  insert into public.document_counters as c (organization_id, kind, last_value) values (org, doc_kind, 1)
  on conflict (organization_id, kind) do update set last_value = c.last_value + 1
  returning last_value into v;
  return prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(v::text, 5, '0');
end $$;

grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on public.connection_secrets from authenticated;

-- ---------------------------------------------------------------------
-- Activer la RLS partout (forcée, y compris pour le propriétaire des tables)
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    -- organization_members n'est pas FORCE : app.member_role (security definer) doit pouvoir la lire.
    if t.tablename <> 'organization_members' then
      execute format('alter table public.%I force row level security', t.tablename);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Politiques standard pour les tables métier
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'customers','contacts','customer_contacts','products','product_variants','product_images',
    'product_prices','inventory_snapshots','imports','import_rows','invoices','invoice_lines',
    'campaigns','campaign_products','agent_runs','opportunities','offers','offer_lines',
    'order_requests','conversations','messages','communication_events','agent_decisions',
    'agent_memory','followup_tasks','appointments','creative_jobs','generated_assets','documents'
  ] loop
    execute format('create policy %I on public.%I for select using (app.is_member(organization_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (app.can_write(organization_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (app.can_write(organization_id)) with check (app.can_write(organization_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete using (app.can_manage(organization_id))', t || '_delete', t);
  end loop;
end $$;

-- Organisations
create policy organizations_select on public.organizations for select using (app.is_member(id));
create policy organizations_update on public.organizations for update using (app.is_admin(id)) with check (app.is_admin(id));

-- Membres : visibles par les membres, gérés par owner/admin
create policy members_select on public.organization_members for select using (app.is_member(organization_id));
create policy members_insert on public.organization_members for insert with check (app.is_admin(organization_id));
create policy members_update on public.organization_members for update using (app.is_admin(organization_id)) with check (app.is_admin(organization_id));
create policy members_delete on public.organization_members for delete using (app.is_admin(organization_id));

-- Paramètres
create policy settings_select on public.organization_settings for select using (app.is_member(organization_id));
create policy settings_update on public.organization_settings for update using (app.is_admin(organization_id)) with check (app.is_admin(organization_id));

-- Compteurs : écriture via app.next_document_number
create policy counters_select on public.document_counters for select using (app.is_member(organization_id));
create policy counters_insert on public.document_counters for insert with check (app.can_write(organization_id));
create policy counters_update on public.document_counters for update using (app.can_write(organization_id)) with check (app.can_write(organization_id));

-- Prix d'achat : owner / admin / manager uniquement (jamais l'agent, jamais un commercial)
create policy costs_all on public.product_purchase_costs for all
  using (app.can_manage(organization_id)) with check (app.can_manage(organization_id));

-- Connexions : lecture membres, écriture admin
create policy connections_select on public.communication_connections for select using (app.is_member(organization_id));
create policy connections_write on public.communication_connections for insert with check (app.is_admin(organization_id));
create policy connections_update on public.communication_connections for update using (app.is_admin(organization_id)) with check (app.is_admin(organization_id));
create policy connections_delete on public.communication_connections for delete using (app.is_admin(organization_id));

-- connection_secrets : aucune politique => inaccessible au rôle authenticated.

-- Désinscriptions : tout membre écrivant peut inscrire une opposition ; seul un admin peut la lever.
create policy suppression_select on public.suppression_entries for select using (app.is_member(organization_id));
create policy suppression_insert on public.suppression_entries for insert with check (app.can_write(organization_id));
create policy suppression_delete on public.suppression_entries for delete using (app.is_admin(organization_id));

-- Approbations : l'agent peut DEMANDER, seul un humain habilité peut DÉCIDER.
create policy approvals_select on public.approvals for select using (app.is_member(organization_id));
create policy approvals_insert on public.approvals for insert with check (app.can_write(organization_id) and status = 'pending');
create policy approvals_update on public.approvals for update
  using (auth.uid() is not null and app.can_write(organization_id) and app.member_role(organization_id) <> 'read_only')
  with check (auth.uid() is not null and app.can_write(organization_id) and (status = 'pending' or decided_by = auth.uid()));

-- Templates créatifs : lecture membres, écriture manager+
create policy templates_select on public.creative_templates for select using (app.is_member(organization_id));
create policy templates_insert on public.creative_templates for insert with check (app.can_manage(organization_id));
create policy templates_update on public.creative_templates for update using (app.can_manage(organization_id)) with check (app.can_manage(organization_id));

-- Audit : insertion par tout membre (pour soi-même) ou l'agent ; lecture manager+
create policy audit_insert on public.audit_logs for insert with check (
  app.is_member(organization_id)
  and ((actor_type = 'user' and actor_user_id = auth.uid()) or (actor_type in ('agent','system') and actor_user_id is null))
);
create policy audit_select on public.audit_logs for select using (app.can_manage(organization_id));
