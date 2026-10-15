-- =====================================================================
-- Kelime Kartı — ilk şema (Faz 0)
--
-- Bu dosya Supabase'deki Postgres veritabanını kurar:
--   * Tüm tablolar (eşlenen tablolar + sadece sunucuda duran tablolar)
--   * Row Level Security (her kullanıcı sadece kendi verisini görür)
--   * server_seq: her yazmada artan ortak sıra numarası (pull için)
--   * push_changes / pull_changes: senkron motorunun çağırdığı fonksiyonlar
--   * Storage: resimler için özel "media" kovası ve kuralları
--
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını
-- yapıştır → Run. (Ya da Supabase CLI ile: supabase db push)
-- =====================================================================

-- Dışarıya (REST API'ye) açılmayan yardımcı fonksiyonlar için ayrı şema.
create schema if not exists private;
grant usage on schema private to authenticated;

-- Tüm eşlenen tablolarda ortak, sürekli artan sıra numarası.
create sequence if not exists public.sync_seq as bigint;

-- ---------------------------------------------------------------------
-- 1) Sadece sunucuda duran tablolar
-- ---------------------------------------------------------------------

-- Kullanıcı profili. Kayıt API'si (davet kodu doğrulandıktan sonra) oluşturur.
-- Profili olmayan kullanıcı "üye" sayılmaz ve eşleme yapamaz.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'user' check (role in ('admin', 'user')),
  gemini_daily_limit integer not null default 50,
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);

-- Davet kodları. Kayıt sadece geçerli bir kodla yapılabilir.
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code)),
  role text not null default 'user' check (role in ('admin', 'user')),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz,
  revoked_at timestamptz
);

-- Uygulama geneli ayarlar (ör. tüm uygulama için günlük Gemini sınırı).
create table public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_config (key, value) values
  ('gemini_global_daily_limit', '200'::jsonb),
  ('gemini_default_user_limit', '50'::jsonb)
on conflict (key) do nothing;

-- "Bu kullanıcının verisi değişti" sinyali. Realtime ile dinlenir;
-- diğer açık cihaz bu satır değişince pull yapar.
create table public.sync_heads (
  user_id uuid primary key references auth.users (id) on delete cascade,
  changed_at timestamptz not null default now(),
  device_id text
);

-- Gemini (Faz 3) tabloları — şimdiden oluşturuluyor.
create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade,
  day date not null,
  kind text not null,
  requests integer not null default 0,
  tokens integer not null default 0,
  unique (user_id, day, kind)
);

create table public.ai_cache (
  key text primary key,
  kind text not null,
  model text,
  response jsonb not null,
  hits integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'paused', 'done', 'failed', 'cancelled')),
  params jsonb not null default '{}'::jsonb,
  note_ids uuid[] not null default '{}',
  done_ids uuid[] not null default '{}',
  total integer not null default 0,
  done integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) Yardımcı fonksiyonlar
-- ---------------------------------------------------------------------

-- Giriş yapmış kullanıcı davetle kayıt olmuş, aktif bir üye mi?
create or replace function private.is_member()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.disabled_at is null
  );
$$;

-- Giriş yapmış kullanıcı admin mi?
create or replace function private.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin' and p.disabled_at is null
  );
$$;

-- Her eşlenen satıra yazıldığı anda yeni bir server_seq verir.
-- ÖNEMLİ: Önce kullanıcıya özel bir kilit alınır. Böylece aynı kullanıcının
-- iki yazma işlemi aynı anda numara alıp ters sırada tamamlanamaz; pull
-- yapan cihaz hiçbir satırı atlamaz.
create or replace function private.assign_server_seq()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  new.server_seq := nextval('public.sync_seq');
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Eşlenen tablolar (cihazdaki IndexedDB ile aynı yapı)
--
-- Ortak sütunlar:
--   id          istemcide üretilen UUID
--   user_id     sahibi
--   created_at  oluşturulma zamanı (ms)
--   updated_at  HLC damgası (metin, "C" sıralamasıyla karşılaştırılır)
--   deleted_at  silinme zamanı (ms) — null ise canlı (tombstone)
--   server_seq  sunucunun verdiği sıra numarası (pull için)
-- ---------------------------------------------------------------------

create table public.deck_configs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  updated_at text collate "C" not null,
  deleted_at bigint,
  server_seq bigint not null default 0,
  name text not null,
  config jsonb not null default '{}'::jsonb
);

create table public.decks (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  updated_at text collate "C" not null,
  deleted_at bigint,
  server_seq bigint not null default 0,
  name text not null,            -- sadece bu destenin adı ("Alt"); tam ad üst destelerden hesaplanır
  parent_id uuid,                -- üst deste (null = en üst seviye)
  config_id uuid,                -- deck_configs (preset)
  description text not null default '',
  collapsed boolean not null default false,
  is_filtered boolean not null default false,
  filter jsonb
);

create table public.note_types (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  updated_at text collate "C" not null,
  deleted_at bigint,
  server_seq bigint not null default 0,
  name text not null,
  kind text not null default 'standard' check (kind in ('standard', 'cloze', 'image_occlusion')),
  fields jsonb not null default '[]'::jsonb,     -- [{id, name, sticky, ...}] sıralı
  templates jsonb not null default '[]'::jsonb,  -- [{id, name, front, back}]
  css text not null default '',
  sort_field text,                               -- sıralama alanının id'si
  word_field text                                -- kelimenin bulunduğu alanın id'si
);

create table public.notes (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  updated_at text collate "C" not null,
  deleted_at bigint,
  server_seq bigint not null default 0,
  note_type_id uuid not null,
  guid text not null,
  fields jsonb not null default '{}'::jsonb,     -- {alanId: "html"}
  tags text[] not null default '{}',
  sort_field text not null default ''
);

create table public.note_examples (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  updated_at text collate "C" not null,
  deleted_at bigint,
  server_seq bigint not null default 0,
  note_id uuid not null,
  text text not null,
  translation text,
  source text not null default 'user' check (source in ('deck', 'user', 'gemini')),
  approved boolean not null default true,
  position double precision not null default 0
);

create table public.cards (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  updated_at text collate "C" not null,           -- meta alanların HLC'si
  deleted_at bigint,
  server_seq bigint not null default 0,
  note_id uuid not null,
  deck_id uuid not null,
  ord integer not null default 0,
  -- Zamanlama grubu: "son tekrarı daha yeni olan kazanır" (sched_updated_at)
  state smallint not null default 0,              -- 0 yeni, 1 öğreniliyor, 2 tekrar, 3 yeniden öğreniliyor
  step smallint not null default 0,               -- öğrenme adımı
  due bigint not null default 0,                  -- sıradaki gösterim zamanı (ms)
  stability double precision not null default 0,
  difficulty double precision not null default 0,
  elapsed_days integer not null default 0,
  scheduled_days integer not null default 0,
  reps integer not null default 0,
  lapses integer not null default 0,
  last_review bigint,
  ease integer not null default 2500,             -- SM-2 kolaylık (binde): 2500 = %250
  interval_days integer not null default 0,       -- SM-2 aralık (gün)
  last_example_id uuid,
  sched_updated_at text collate "C" not null,
  -- Meta grup: "son düzenleyen kazanır" (updated_at)
  flags smallint not null default 0,
  suspended boolean not null default false,
  buried_until bigint,                            -- bu zamana kadar gömülü (ms); null = gömülü değil
  original_deck_id uuid,                          -- filtrelenmiş destedeyken asıl destesi
  original_due bigint,
  position integer not null default 0             -- yeni kartların sırası
);

-- Cevap geçmişi: SADECE EKLENİR, asla değiştirilmez/silinmez.
create table public.review_logs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  updated_at text collate "C" not null,
  deleted_at bigint,
  server_seq bigint not null default 0,
  card_id uuid not null,
  note_id uuid,
  deck_id uuid,
  reviewed_at bigint not null,                    -- cevap zamanı (ms)
  rating smallint not null check (rating between 0 and 4), -- 1 Tekrar, 2 Zor, 3 İyi, 4 Kolay (0 = elle)
  kind smallint not null default 0,               -- 0 öğrenme, 1 tekrar, 2 yeniden öğrenme, 3 filtreli, 4 elle
  state smallint,                                 -- cevaptan önceki durum
  due bigint,
  stability double precision,
  difficulty double precision,
  elapsed_days integer,
  last_elapsed_days integer,
  scheduled_days integer,
  interval_before integer,
  interval_after integer,
  ease integer,
  duration_ms integer not null default 0
);

create table public.media (
  id uuid primary key,                            -- uuidv5(hash, user_id): aynı resim = aynı id
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  updated_at text collate "C" not null,
  deleted_at bigint,
  server_seq bigint not null default 0,
  hash text not null,                             -- SHA-256 (hex)
  filename text not null,
  mime text not null default 'application/octet-stream',
  size bigint not null default 0,
  storage_path text,                              -- "{user_id}/{hash}.{uzantı}"
  uploaded_at bigint                              -- Storage'a yüklendiği zaman; null = henüz yüklenmedi
);

-- Kullanıcı ayarları: her ayar ayrı satır (iki cihaz farklı ayarları
-- değiştirirse ikisi de korunur). id = uuidv5(key, user_id).
create table public.app_settings (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  updated_at text collate "C" not null,
  deleted_at bigint,
  server_seq bigint not null default 0,
  key text not null,
  value jsonb
);

-- Ortak kurulum: index, server_seq tetikleyicisi, RLS ve yetkiler
do $$
declare
  t text;
begin
  foreach t in array array['deck_configs', 'decks', 'note_types', 'notes', 'note_examples',
                           'cards', 'review_logs', 'media', 'app_settings']
  loop
    execute format('create index %I on public.%I (user_id, server_seq)', t || '_user_seq_idx', t);
    execute format('create trigger assign_server_seq before insert or update on public.%I
                    for each row execute function private.assign_server_seq()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated
                    using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated
                    with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    -- review_logs değiştirilemez: update kuralı yok
    if t <> 'review_logs' then
      execute format('create policy %I on public.%I for update to authenticated
                      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
                     t || '_update_own', t);
    end if;
    -- Silme kuralı yok: satırlar gerçekten silinmez, deleted_at ile işaretlenir.
    execute format('revoke all on public.%I from anon', t);
    if t = 'review_logs' then
      execute format('grant select, insert on public.%I to authenticated', t);
    else
      execute format('grant select, insert, update on public.%I to authenticated', t);
    end if;
  end loop;
end;
$$;

create index cards_note_idx on public.cards (note_id);
create index note_examples_note_idx on public.note_examples (note_id);
create index review_logs_card_idx on public.review_logs (card_id);

-- ---------------------------------------------------------------------
-- 4) Sadece sunucu tablolarının RLS kuralları
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));
create policy profiles_admin_update on public.profiles for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
revoke all on public.profiles from anon;
grant select, update on public.profiles to authenticated;

alter table public.invites enable row level security;
create policy invites_admin_all on public.invites for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
revoke all on public.invites from anon;
grant select, insert, update, delete on public.invites to authenticated;

alter table public.app_config enable row level security;
create policy app_config_select on public.app_config for select to authenticated using (true);
create policy app_config_admin_write on public.app_config for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
revoke all on public.app_config from anon;
grant select, insert, update on public.app_config to authenticated;

alter table public.sync_heads enable row level security;
create policy sync_heads_select_own on public.sync_heads for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.sync_heads from anon;
grant select on public.sync_heads to authenticated;

alter table public.ai_usage enable row level security;
create policy ai_usage_select on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
revoke all on public.ai_usage from anon;
grant select on public.ai_usage to authenticated;

alter table public.ai_jobs enable row level security;
create policy ai_jobs_select_own on public.ai_jobs for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.ai_jobs from anon;
grant select on public.ai_jobs to authenticated;

-- ai_cache'e istemciden erişim yok (sadece sunucu, gizli anahtarla).
alter table public.ai_cache enable row level security;
revoke all on public.ai_cache from anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) Senkron fonksiyonları
-- ---------------------------------------------------------------------

-- Bir tablonun "id, user_id, server_seq" dışındaki sütun listesi.
create or replace function private.sync_columns(p_table text)
returns text
language sql stable set search_path = ''
as $$
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
  from pg_catalog.pg_attribute a
  where a.attrelid = ('public.' || quote_ident(p_table))::regclass
    and a.attnum > 0 and not a.attisdropped
    and a.attname not in ('id', 'user_id', 'server_seq');
$$;

-- Gelen satırda (jsonb) gerçekten bulunan sütunların listesi. Eklemede sadece
-- bunlar yazılır; olmayanlar tablodaki varsayılan değeri alır.
create or replace function private.present_columns(p_table text, p_row jsonb)
returns text
language sql stable set search_path = ''
as $$
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
  from pg_catalog.pg_attribute a
  where a.attrelid = ('public.' || quote_ident(p_table))::regclass
    and a.attnum > 0 and not a.attisdropped
    and a.attname <> 'server_seq'
    and p_row ? a.attname;
$$;

-- Kartların zamanlama grubu sütunları (sched_updated_at ile karşılaştırılır).
create or replace function private.card_sched_columns()
returns text[]
language sql immutable
as $$
  select array['state', 'step', 'due', 'stability', 'difficulty', 'elapsed_days',
               'scheduled_days', 'reps', 'lapses', 'last_review', 'ease',
               'interval_days', 'last_example_id', 'sched_updated_at'];
$$;

-- Yeni bir satır ekler (varsa dokunmaz). true = eklendi.
create or replace function private.insert_row(p_table text, p_row jsonb, p_uid uuid)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  v_row jsonb := p_row || jsonb_build_object('user_id', p_uid);
  v_cols text := private.present_columns(p_table, v_row);
  v_count integer;
begin
  execute format(
    'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)
     on conflict (id) do nothing', p_table, v_cols, v_cols, p_table)
    using v_row;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

-- Tek bir satırı çakışma kuralına göre yazar. true = bir şey değişti.
--   * Satır yoksa: eklenir.
--   * review_logs: sadece eklenir; varsa dokunulmaz.
--   * Diğerleri: gelen updated_at daha yeniyse alanlar yazılır ("son yazan kazanır").
--   * cards: zamanlama alanları sched_updated_at'e, diğerleri updated_at'e göre
--     ayrı ayrı karşılaştırılır.
--   * Gelen satırda olmayan sütunlar korunur (eski uygulama sürümleri yeni
--     sütunları silemez).
create or replace function private.apply_change(p_table text, p_row jsonb, p_uid uuid)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id uuid := (p_row ->> 'id')::uuid;
  v_existing jsonb;
  v_merged jsonb;
  v_changed boolean := false;
  v_sched text[] := '{}';
begin
  if v_id is null then
    raise exception 'id eksik';
  end if;
  if coalesce(p_row ->> 'updated_at', '') = '' then
    raise exception 'updated_at eksik';
  end if;
  if p_table = 'cards' then
    v_sched := private.card_sched_columns();
  end if;

  -- Cevap geçmişi: sadece eklenir; aynı id zaten varsa dokunulmaz.
  if p_table = 'review_logs' then
    return private.insert_row(p_table, p_row, p_uid);
  end if;

  execute format('select to_jsonb(t) from public.%I t where t.id = $1 for update', p_table)
    into v_existing using v_id;

  if v_existing is null then
    -- Yeni satır. (Başka kullanıcının aynı id'li satırı varsa RLS onu gizler,
    -- "on conflict do nothing" ile sessizce yok sayılır.)
    return private.insert_row(p_table, p_row, p_uid);
  end if;

  v_merged := v_existing;

  -- Meta grup (cards dışındaki tablolarda: tüm satır)
  if (p_row ->> 'updated_at') collate "C" > (v_existing ->> 'updated_at') collate "C" then
    v_merged := v_merged || ((p_row - v_sched) - 'id' - 'user_id' - 'server_seq' - 'created_at');
    v_changed := true;
  end if;

  -- Zamanlama grubu (sadece cards)
  if p_table = 'cards'
     and coalesce(p_row ->> 'sched_updated_at', '') <> ''
     and (p_row ->> 'sched_updated_at') collate "C" > (v_existing ->> 'sched_updated_at') collate "C" then
    v_merged := v_merged || coalesce(
      (select jsonb_object_agg(e.key, e.value) from jsonb_each(p_row) e where e.key = any (v_sched)),
      '{}'::jsonb);
    v_changed := true;
  end if;

  if not v_changed then
    return false;
  end if;

  execute format(
    'update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1))
     where t.id = $2',
    p_table, private.sync_columns(p_table), private.sync_columns(p_table), p_table)
    using v_merged, v_id;
  return true;
end;
$$;

-- sync_heads satırını günceller (istemci bu tabloya doğrudan yazamaz).
create or replace function private.touch_sync_head(p_uid uuid, p_device text)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.sync_heads (user_id, changed_at, device_id)
  values (p_uid, now(), p_device)
  on conflict (user_id) do update
    set changed_at = excluded.changed_at, device_id = excluded.device_id;
$$;

-- PUSH: istemci değişiklik paketini gönderir.
--   p_changes: [{"table": "decks", "row": {...}}, ...]
--   p_device:  gönderen cihazın kimliği (Realtime sinyalinde kendini tanısın diye)
-- Dönüş: {"applied": n, "skipped": n, "errors": [{"table","id","message"}]}
-- Hatalı bir satır tüm paketi bozmaz; hatası raporlanır, diğerleri yazılır.
create or replace function public.push_changes(p_changes jsonb, p_device text default null)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_change jsonb;
  v_table text;
  v_row jsonb;
  v_applied integer := 0;
  v_skipped integer := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  if v_uid is null or not private.is_member() then
    raise exception 'Bu hesap eşleme yapamaz (davetli üye değil).' using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) <> 'array' then
    raise exception 'p_changes bir dizi olmalı';
  end if;
  if jsonb_array_length(p_changes) > 1000 then
    raise exception 'Paket çok büyük (en fazla 1000 satır)';
  end if;

  -- Bu kullanıcının yazmalarını sıraya sok (bkz. assign_server_seq)
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_table := v_change ->> 'table';
    v_row := (v_change -> 'row') - 'user_id' - 'server_seq';
    begin
      if v_table is null or v_table not in ('deck_configs', 'decks', 'note_types', 'notes',
          'note_examples', 'cards', 'review_logs', 'media', 'app_settings') then
        raise exception 'Bilinmeyen tablo: %', coalesce(v_table, '(boş)');
      end if;
      if private.apply_change(v_table, v_row, v_uid) then
        v_applied := v_applied + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'table', v_table, 'id', v_row ->> 'id', 'message', sqlerrm));
    end;
  end loop;

  -- Diğer cihazlara "değişiklik var" sinyali
  if v_applied > 0 then
    perform private.touch_sync_head(v_uid, p_device);
  end if;

  return jsonb_build_object('applied', v_applied, 'skipped', v_skipped, 'errors', v_errors);
end;
$$;

-- PULL: server_seq'i p_since'ten büyük satırları sırayla döndürür.
-- İstemci dönen en büyük seq'i saklar ve bir sonraki sefer oradan devam eder.
create or replace function public.pull_changes(p_since bigint, p_limit integer default 500)
returns table (tbl text, seq bigint, row_data jsonb)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 2000);
begin
  if v_uid is null or not private.is_member() then
    raise exception 'Bu hesap eşleme yapamaz (davetli üye değil).' using errcode = '42501';
  end if;
  return query
  select u.tbl, u.seq, u.row_data from (
    (select 'deck_configs'::text as tbl, t.server_seq as seq, to_jsonb(t) as row_data
       from public.deck_configs t where t.user_id = v_uid and t.server_seq > p_since
       order by t.server_seq limit v_limit)
    union all
    (select 'decks', t.server_seq, to_jsonb(t) from public.decks t
       where t.user_id = v_uid and t.server_seq > p_since order by t.server_seq limit v_limit)
    union all
    (select 'note_types', t.server_seq, to_jsonb(t) from public.note_types t
       where t.user_id = v_uid and t.server_seq > p_since order by t.server_seq limit v_limit)
    union all
    (select 'notes', t.server_seq, to_jsonb(t) from public.notes t
       where t.user_id = v_uid and t.server_seq > p_since order by t.server_seq limit v_limit)
    union all
    (select 'note_examples', t.server_seq, to_jsonb(t) from public.note_examples t
       where t.user_id = v_uid and t.server_seq > p_since order by t.server_seq limit v_limit)
    union all
    (select 'cards', t.server_seq, to_jsonb(t) from public.cards t
       where t.user_id = v_uid and t.server_seq > p_since order by t.server_seq limit v_limit)
    union all
    (select 'review_logs', t.server_seq, to_jsonb(t) from public.review_logs t
       where t.user_id = v_uid and t.server_seq > p_since order by t.server_seq limit v_limit)
    union all
    (select 'media', t.server_seq, to_jsonb(t) from public.media t
       where t.user_id = v_uid and t.server_seq > p_since order by t.server_seq limit v_limit)
    union all
    (select 'app_settings', t.server_seq, to_jsonb(t) from public.app_settings t
       where t.user_id = v_uid and t.server_seq > p_since order by t.server_seq limit v_limit)
  ) u
  order by u.seq
  limit v_limit;
end;
$$;

-- İlk indirmede ilerleme çubuğu için: p_since'ten sonra kaç satır var?
create or replace function public.pull_count(p_since bigint)
returns bigint
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.is_member() then
    raise exception 'Bu hesap eşleme yapamaz (davetli üye değil).' using errcode = '42501';
  end if;
  return
    (select count(*) from public.deck_configs t where t.user_id = v_uid and t.server_seq > p_since) +
    (select count(*) from public.decks t where t.user_id = v_uid and t.server_seq > p_since) +
    (select count(*) from public.note_types t where t.user_id = v_uid and t.server_seq > p_since) +
    (select count(*) from public.notes t where t.user_id = v_uid and t.server_seq > p_since) +
    (select count(*) from public.note_examples t where t.user_id = v_uid and t.server_seq > p_since) +
    (select count(*) from public.cards t where t.user_id = v_uid and t.server_seq > p_since) +
    (select count(*) from public.review_logs t where t.user_id = v_uid and t.server_seq > p_since) +
    (select count(*) from public.media t where t.user_id = v_uid and t.server_seq > p_since) +
    (select count(*) from public.app_settings t where t.user_id = v_uid and t.server_seq > p_since);
end;
$$;

-- Admin paneli için kullanım göstergeleri.
create or replace function public.admin_usage()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Sadece admin' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'storage_bytes', (select coalesce(sum((o.metadata ->> 'size')::bigint), 0)
                        from storage.objects o where o.bucket_id = 'media'),
    'users', (select count(*) from public.profiles),
    'gemini_today', (select coalesce(sum(u.requests), 0) from public.ai_usage u
                       where u.day = (now() at time zone 'Europe/Istanbul')::date)
  );
end;
$$;

-- Fonksiyon yetkileri: sadece giriş yapmış kullanıcılar çağırabilir.
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
revoke execute on function public.push_changes(jsonb, text) from public, anon;
revoke execute on function public.pull_changes(bigint, integer) from public, anon;
revoke execute on function public.pull_count(bigint) from public, anon;
revoke execute on function public.admin_usage() from public, anon;
grant execute on function public.push_changes(jsonb, text) to authenticated;
grant execute on function public.pull_changes(bigint, integer) to authenticated;
grant execute on function public.pull_count(bigint) to authenticated;
grant execute on function public.admin_usage() to authenticated;

-- Realtime: sync_heads değişikliklerini yayınla (diğer cihaz anında pull yapsın).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.sync_heads;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 6) Storage: resimler (özel kova, her kullanıcı sadece kendi klasörü)
-- Yol biçimi: media/{user_id}/{sha256}.{uzantı}
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 10485760,
        array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
              'image/avif', 'image/bmp'])
on conflict (id) do nothing;

create policy media_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy media_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy media_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy media_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
