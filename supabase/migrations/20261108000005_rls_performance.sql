-- Performance de la RLS sur les grands volumes (500 000 lignes de factures et plus).
-- Les politiques appelaient app.is_member(organization_id) LIGNE PAR LIGNE (fonction security definer, non « inlinable ») :
-- une recherche d'appartenance par ligne lue. Elles comparent désormais organization_id à la liste des organisations
-- autorisées, calculée UNE fois par requête ((select …) = InitPlan). Les droits sont strictement identiques :
--   lecture  = membre actif ou agent de l'organisation
--   écriture = owner / admin / manager / commercial, ou agent de l'organisation
--   gestion  = owner / admin / manager (jamais l'agent)

create or replace function app.readable_orgs() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select array_remove(
    coalesce((select array_agg(m.organization_id) from public.organization_members m where m.user_id = auth.uid() and m.status = 'active'), '{}'::uuid[])
      || app.current_agent_org(), null)
$$;

create or replace function app.writable_orgs() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select array_remove(
    coalesce((select array_agg(m.organization_id) from public.organization_members m
              where m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner','admin','manager','commercial')), '{}'::uuid[])
      || app.current_agent_org(), null)
$$;

create or replace function app.manageable_orgs() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select array_agg(m.organization_id) from public.organization_members m
                   where m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner','admin','manager')), '{}'::uuid[])
$$;

grant execute on function app.readable_orgs(), app.writable_orgs(), app.manageable_orgs() to authenticated, service_role;

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
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select using (organization_id = any ((select app.readable_orgs())::uuid[]))', t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (organization_id = any ((select app.writable_orgs())::uuid[]))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (organization_id = any ((select app.writable_orgs())::uuid[])) with check (organization_id = any ((select app.writable_orgs())::uuid[]))', t || '_update', t);
    execute format('create policy %I on public.%I for delete using (organization_id = any ((select app.manageable_orgs())::uuid[]))', t || '_delete', t);
  end loop;
end $$;

-- Exception conservée (migration 20261108000004) : retirer une ligne d'offre est permis aux rôles d'écriture.
drop policy if exists offer_lines_delete on public.offer_lines;
create policy offer_lines_delete on public.offer_lines for delete using (organization_id = any ((select app.writable_orgs())::uuid[]));

-- Tables récentes à fort volume
drop policy if exists customer_stock_reports_select on public.customer_stock_reports;
create policy customer_stock_reports_select on public.customer_stock_reports for select using (organization_id = any ((select app.readable_orgs())::uuid[]));
drop policy if exists offer_line_changes_select on public.offer_line_changes;
create policy offer_line_changes_select on public.offer_line_changes for select using (organization_id = any ((select app.readable_orgs())::uuid[]));
