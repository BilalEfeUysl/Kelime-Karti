-- =====================================================================
-- Faz 6: Otomatik yedekler + bakım
--  1) "backups" deposu (özel): her kullanıcı sadece kendi klasörüne
--     ("<user_id>/…json.gz") yazıp okuyabilir. En fazla 50 MB.
--  2) purge_tombstones(gün): kullanıcının kendi, belirtilen günden daha eski
--     silinmiş (tombstone) satırlarını sunucudan tamamen kaldırır.
--     Uzun süre çevrimdışı kalan bir cihaz, silinen bir kaydı sonradan
--     düzenlerse o kayıt geri gelebilir — bu yüzden en az 30 gün şartı var.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('backups', 'backups', false, 52428800, array['application/gzip', 'application/octet-stream'])
on conflict (id) do nothing;

create policy backups_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy backups_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy backups_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy backups_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = (select auth.uid())::text);

create or replace function public.purge_tombstones(p_days integer)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cutoff bigint;
  v_total integer := 0;
  v_count integer;
  v_table text;
begin
  if v_uid is null or not private.is_member() then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;
  if p_days < 30 then
    raise exception 'En az 30 gün olmalı';
  end if;
  v_cutoff := (extract(epoch from now()) * 1000)::bigint - p_days::bigint * 86400000;
  foreach v_table in array array['note_examples', 'cards', 'notes', 'note_types', 'decks', 'deck_configs', 'media', 'app_settings'] loop
    execute format('delete from public.%I where user_id = $1 and deleted_at is not null and deleted_at < $2', v_table)
      using v_uid, v_cutoff;
    get diagnostics v_count = row_count;
    v_total := v_total + v_count;
  end loop;
  return v_total;
end;
$$;

revoke execute on function public.purge_tombstones(integer) from public, anon;
grant execute on function public.purge_tombstones(integer) to authenticated;
