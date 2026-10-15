-- =====================================================================
-- İsimle giriş: davet kodlu kayıt kaldırıldı.
-- İzin verilen kişiler artık sunucu kodunda (lib/server/members.ts) duruyor;
-- hesap ve profil ilk girişte /api/login tarafından oluşturuluyor.
-- =====================================================================

drop table if exists public.invites;
