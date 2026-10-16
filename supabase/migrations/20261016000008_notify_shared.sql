-- =====================================================================
-- 008: YÖNETİCİ DESTE EKLEYİNCE ÜYELERE HABER VER
--
-- Yönetici içerik (deste, not, not tipi, örnek cümle, resim) gönderdiğinde
-- diğer üyelerin sync_heads satırı da güncellenir. Açık olan uygulamaları
-- Realtime ile bunu duyar, eşleme yapar ve paylaşılan desteler hemen gelir
-- (bkz. 007). Sadece cevaplar (kart zamanlaması, cevap geçmişi) haber
-- vermez; onlar paylaşılmaz.
--
-- push_changes'in geri kalanı 001'deki ile aynıdır.
-- =====================================================================

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
  v_content boolean := false;
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
        if v_table in ('decks', 'note_types', 'notes', 'note_examples', 'media') then
          v_content := true;
        end if;
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
  -- Yönetici içerik değiştirdiyse üyelere de haber ver (paylaşılan desteler)
  if v_content and private.is_admin() then
    perform private.touch_sync_head(p.id, null)
       from public.profiles p
      where p.id <> v_uid and p.disabled_at is null;
  end if;

  return jsonb_build_object('applied', v_applied, 'skipped', v_skipped, 'errors', v_errors);
end;
$$;
