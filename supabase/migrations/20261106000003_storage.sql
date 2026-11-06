-- =====================================================================
-- Supabase Storage — bucket privé par organisation.
-- Convention de chemin : <organization_id>/<catégorie>/<fichier>
-- Ignoré automatiquement hors Supabase (schéma storage absent).
-- =====================================================================
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('follow-private', 'follow-private', false)
      on conflict (id) do nothing;

    execute $p$create policy "org members read" on storage.objects for select
      using (bucket_id = 'follow-private' and app.is_member(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy "org writers insert" on storage.objects for insert
      with check (bucket_id = 'follow-private' and app.can_write(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy "org managers delete" on storage.objects for delete
      using (bucket_id = 'follow-private' and app.can_manage(((storage.foldername(name))[1])::uuid))$p$;
  end if;
end $$;
