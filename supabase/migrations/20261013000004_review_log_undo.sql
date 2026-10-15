-- =====================================================================
-- "Geri al" desteği: cevap geçmişi kaydı silindi olarak işaretlenebilir.
-- İçerik (puan, zaman, aralık…) yine ASLA değişmez; sadece deleted_at bir
-- kez doldurulabilir. Bu işaret de diğer cihazlara eşlenir.
-- =====================================================================

-- Sadece deleted_at sütunu güncellenebilir (sütun bazlı yetki)
grant update (deleted_at) on public.review_logs to authenticated;
create policy review_logs_update_own on public.review_logs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

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
  v_count integer;
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

  -- Cevap geçmişi: sadece eklenir; içeriği asla değişmez. Tek istisna:
  -- "Geri al" ile silindi olarak işaretlenebilir (deleted_at bir kez dolar).
  if p_table = 'review_logs' then
    if private.insert_row(p_table, p_row, p_uid) then
      return true;
    end if;
    if (p_row ->> 'deleted_at') is not null then
      update public.review_logs
         set deleted_at = (p_row ->> 'deleted_at')::bigint
       where id = v_id and user_id = p_uid and deleted_at is null;
      get diagnostics v_count = row_count;
      return v_count > 0;
    end if;
    return false;
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
