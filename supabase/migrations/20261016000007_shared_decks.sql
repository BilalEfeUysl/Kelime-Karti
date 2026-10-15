-- =====================================================================
-- 007: YÖNETİCİNİN DESTELERİ HERKESTE
--
-- Yöneticinin (admin) içinde kart olan her destesi, diğer üyelerin
-- koleksiyonuna KOPYA olarak gelir. Herkes kendi kopyasını kendi hızında
-- çalışır (zamanlama/geçmiş kişiye özel). Yönetici sonradan kart ekler,
-- düzeltir ya da silerse bu değişiklikler de kopyalara gider.
--
-- Nasıl çalışır?
--   - İstemci her eşlemede (push'tan sonra, pull'dan önce)
--     public.sync_shared_decks() çağırır. Fonksiyon, çağıranın
--     koleksiyonuna eksik kopyaları ekler, eskimiş olanları günceller.
--     Eklenen/güncellenen satırlar server_seq alır; hemen ardından gelen
--     pull bunları cihaza indirir.
--   - Kopyanın id'si sabittir: md5("shared:" + kullanıcı + ":" + kaynak id).
--     Böylece aynı kaynak her seferinde aynı kopyaya denk gelir.
--   - Kopyanın updated_at'i kaynağınkiyle aynı yazılır. Kaynak daha yeniyse
--     (yönetici düzenlemiş) kopya güncellenir; kullanıcı kendi kopyasını
--     sonradan düzenlediyse onunki kalır (yönetici tekrar düzenleyene kadar).
--   - Kartlarda sadece deste/sıra/silinme kopyalanır; zamanlama (ne zaman
--     tekrar edileceği) asla değiştirilmez.
--   - Resimler: yöneticinin media satırları kopyalanır (Storage'daki dosya
--     yöneticinin klasöründe kalır; üyelerin okumasına izin verilir).
-- =====================================================================

create or replace function private.shared_id(p_uid uuid, p_src uuid)
returns uuid
language sql immutable set search_path = ''
as $$
  select md5('shared:' || p_uid::text || ':' || p_src::text)::uuid;
$$;

create or replace function public.sync_shared_decks()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_admin uuid;
  v_hlc text;
  v_total integer := 0;
  v_n integer;
begin
  if v_uid is null or not private.is_member() then
    raise exception 'Bu hesap eşleme yapamaz (davetli üye değil).' using errcode = '42501';
  end if;
  select p.id into v_admin
    from public.profiles p
   where p.role = 'admin' and p.disabled_at is null
   order by p.created_at
   limit 1;
  if v_admin is null or v_admin = v_uid then
    return 0;
  end if;

  -- Bu kullanıcının yazmalarını sıraya sok (bkz. assign_server_seq)
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  v_hlc := lpad(((extract(epoch from clock_timestamp()) * 1000)::bigint)::text, 15, '0') || '-00000-5a5a5a5a5a5a5a5a';

  -- Paylaşılan desteler: içinde (ya da alt destesinde) canlı kart olan,
  -- filtreli olmayan yönetici desteleri. Boş "Varsayılan" deste gelmez.
  create temporary table if not exists pg_temp.kk_shared_decks (id uuid primary key) on commit drop;
  truncate pg_temp.kk_shared_decks;
  insert into pg_temp.kk_shared_decks (id)
  with recursive card_decks as (
    select distinct coalesce(c.original_deck_id, c.deck_id) as id
      from public.cards c
     where c.user_id = v_admin and c.deleted_at is null
  ), up as (
    select d.id, d.parent_id
      from public.decks d join card_decks cd on cd.id = d.id
     where d.user_id = v_admin and d.deleted_at is null and not d.is_filtered
    union
    select d.id, d.parent_id
      from public.decks d join up on d.id = up.parent_id
     where d.user_id = v_admin and d.deleted_at is null
  )
  select id from up;

  -- Paylaşılan notlar: canlı kartı olan yönetici notları
  create temporary table if not exists pg_temp.kk_shared_notes (id uuid primary key, note_type_id uuid) on commit drop;
  truncate pg_temp.kk_shared_notes;
  insert into pg_temp.kk_shared_notes (id, note_type_id)
  select n.id, n.note_type_id
    from public.notes n
   where n.user_id = v_admin and n.deleted_at is null
     and exists (select 1 from public.cards c where c.note_id = n.id and c.user_id = v_admin and c.deleted_at is null);

  -- 1) Desteler -------------------------------------------------------
  insert into public.decks (id, user_id, created_at, updated_at, name, parent_id, description)
  select private.shared_id(v_uid, a.id), v_uid, a.created_at, a.updated_at, a.name,
         case when a.parent_id is null then null else private.shared_id(v_uid, a.parent_id) end,
         a.description
    from public.decks a
    join pg_temp.kk_shared_decks s on s.id = a.id
   where a.user_id = v_admin
     and not exists (select 1 from public.decks c where c.id = private.shared_id(v_uid, a.id));
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  update public.decks c
     set name = a.name,
         parent_id = case when a.parent_id is null then null else private.shared_id(v_uid, a.parent_id) end,
         description = a.description,
         deleted_at = a.deleted_at,
         updated_at = a.updated_at
    from public.decks a
   where a.user_id = v_admin and c.user_id = v_uid
     and c.id = private.shared_id(v_uid, a.id)
     and a.updated_at > c.updated_at;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  -- 2) Not tipleri ----------------------------------------------------
  insert into public.note_types (id, user_id, created_at, updated_at, name, kind, fields, templates, css, sort_field, word_field)
  select private.shared_id(v_uid, a.id), v_uid, a.created_at, a.updated_at, a.name, a.kind,
         a.fields, a.templates, a.css, a.sort_field, a.word_field
    from public.note_types a
   where a.user_id = v_admin and a.deleted_at is null
     and a.id in (select note_type_id from pg_temp.kk_shared_notes)
     and not exists (select 1 from public.note_types c where c.id = private.shared_id(v_uid, a.id));
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  update public.note_types c
     set name = a.name, kind = a.kind, fields = a.fields, templates = a.templates, css = a.css,
         sort_field = a.sort_field, word_field = a.word_field,
         deleted_at = a.deleted_at, updated_at = a.updated_at
    from public.note_types a
   where a.user_id = v_admin and c.user_id = v_uid
     and c.id = private.shared_id(v_uid, a.id)
     and a.updated_at > c.updated_at;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  -- 3) Notlar ---------------------------------------------------------
  insert into public.notes (id, user_id, created_at, updated_at, note_type_id, guid, fields, tags, sort_field)
  select private.shared_id(v_uid, a.id), v_uid, a.created_at, a.updated_at,
         private.shared_id(v_uid, a.note_type_id), a.guid, a.fields, a.tags, a.sort_field
    from public.notes a
    join pg_temp.kk_shared_notes s on s.id = a.id
   where a.user_id = v_admin
     and not exists (select 1 from public.notes c where c.id = private.shared_id(v_uid, a.id));
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  update public.notes c
     set note_type_id = private.shared_id(v_uid, a.note_type_id),
         fields = a.fields, tags = a.tags, sort_field = a.sort_field,
         deleted_at = a.deleted_at, updated_at = a.updated_at
    from public.notes a
   where a.user_id = v_admin and c.user_id = v_uid
     and c.id = private.shared_id(v_uid, a.id)
     and a.updated_at > c.updated_at;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  -- 4) Örnek cümleler -------------------------------------------------
  insert into public.note_examples (id, user_id, created_at, updated_at, note_id, text, translation, source, approved, position)
  select private.shared_id(v_uid, a.id), v_uid, a.created_at, a.updated_at,
         private.shared_id(v_uid, a.note_id), a.text, a.translation, a.source, a.approved, a.position
    from public.note_examples a
    join pg_temp.kk_shared_notes s on s.id = a.note_id
   where a.user_id = v_admin and a.deleted_at is null
     and not exists (select 1 from public.note_examples c where c.id = private.shared_id(v_uid, a.id));
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  update public.note_examples c
     set text = a.text, translation = a.translation, source = a.source, approved = a.approved,
         position = a.position, deleted_at = a.deleted_at, updated_at = a.updated_at
    from public.note_examples a
   where a.user_id = v_admin and c.user_id = v_uid
     and c.id = private.shared_id(v_uid, a.id)
     and a.updated_at > c.updated_at;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  -- 5) Kartlar: yeni kart olarak eklenir; zamanlamaya hiç dokunulmaz ----
  insert into public.cards (id, user_id, created_at, updated_at, sched_updated_at, note_id, deck_id, ord, position)
  select private.shared_id(v_uid, a.id), v_uid, a.created_at, a.updated_at, v_hlc,
         private.shared_id(v_uid, a.note_id),
         private.shared_id(v_uid, coalesce(a.original_deck_id, a.deck_id)), a.ord, a.position
    from public.cards a
    join pg_temp.kk_shared_notes s on s.id = a.note_id
   where a.user_id = v_admin and a.deleted_at is null
     and coalesce(a.original_deck_id, a.deck_id) in (select id from pg_temp.kk_shared_decks)
     and not exists (select 1 from public.cards c where c.id = private.shared_id(v_uid, a.id));
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  -- Kopya şu an kullanıcının filtreli destesindeyse asıl destesi güncellenir
  update public.cards c
     set deck_id = case when c.original_deck_id is null
                        then private.shared_id(v_uid, coalesce(a.original_deck_id, a.deck_id)) else c.deck_id end,
         original_deck_id = case when c.original_deck_id is null
                                 then null else private.shared_id(v_uid, coalesce(a.original_deck_id, a.deck_id)) end,
         ord = a.ord,
         deleted_at = a.deleted_at,
         updated_at = a.updated_at
    from public.cards a
   where a.user_id = v_admin and c.user_id = v_uid
     and c.id = private.shared_id(v_uid, a.id)
     and a.updated_at > c.updated_at;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  -- 6) Resimler (dosya yöneticinin Storage klasöründe kalır) -----------
  insert into public.media (id, user_id, created_at, updated_at, hash, filename, mime, size, storage_path, uploaded_at)
  select private.shared_id(v_uid, a.id), v_uid, a.created_at, a.updated_at,
         a.hash, a.filename, a.mime, a.size, a.storage_path, a.uploaded_at
    from public.media a
   where a.user_id = v_admin and a.deleted_at is null
     and not exists (select 1 from public.media c where c.id = private.shared_id(v_uid, a.id));
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  update public.media c
     set hash = a.hash, filename = a.filename, mime = a.mime, size = a.size,
         storage_path = a.storage_path, uploaded_at = a.uploaded_at,
         deleted_at = a.deleted_at, updated_at = a.updated_at
    from public.media a
   where a.user_id = v_admin and c.user_id = v_uid
     and c.id = private.shared_id(v_uid, a.id)
     and a.updated_at > c.updated_at;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  if v_total > 0 then
    perform private.touch_sync_head(v_uid, null);
  end if;
  return v_total;
end;
$$;

revoke execute on function public.sync_shared_decks() from public, anon;
grant execute on function public.sync_shared_decks() to authenticated;
revoke execute on function private.shared_id(uuid, uuid) from public, anon;

-- Üyeler yöneticinin resimlerini okuyabilir (paylaşılan destelerdeki resimler için)
create policy media_objects_select_shared on storage.objects for select to authenticated
  using (
    bucket_id = 'media'
    and private.is_member()
    and exists (
      select 1 from public.profiles p
       where p.role = 'admin' and p.disabled_at is null
         and p.id::text = (storage.foldername(name))[1]
    )
  );
