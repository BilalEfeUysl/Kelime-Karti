-- =====================================================================
-- Supabase güvenlik/performans denetiminin (Advisors) önerdiği küçük düzeltmeler
-- =====================================================================

-- Fonksiyonun arama yolu sabit olsun (güvenlik önerisi)
alter function private.card_sched_columns() set search_path = '';

-- app_config: admin kuralı "for all" olduğu için okuma (select) iki kez
-- denetleniyordu. Yazma kurallarını ayrı ayrı tanımla.
drop policy app_config_admin_write on public.app_config;
create policy app_config_admin_insert on public.app_config for insert to authenticated
  with check ((select private.is_admin()));
create policy app_config_admin_update on public.app_config for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Yabancı anahtarlar için index (performans önerisi)
create index ai_jobs_user_idx on public.ai_jobs (user_id);
create index invites_created_by_idx on public.invites (created_by);
create index invites_used_by_idx on public.invites (used_by);
