-- Interrupteur d'arrêt de LÉA : accessible aux managers (sécurité) sans leur ouvrir tous les paramètres.
create or replace function app.set_autonomy_paused(org uuid, paused boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.can_manage(org) then raise exception 'not allowed'; end if;
  update public.organization_settings set autonomy_paused = paused where organization_id = org;
end $$;
revoke all on function app.set_autonomy_paused(uuid, boolean) from public;
grant execute on function app.set_autonomy_paused(uuid, boolean) to authenticated;
