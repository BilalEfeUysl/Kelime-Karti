-- =====================================================================
-- Faz 3: Herkes KENDİ Gemini API anahtarını kullanır.
-- Anahtar sunucuda ŞİFRELİ saklanır (AES-256-GCM, şifreleme anahtarı
-- sadece sunucu ortam değişkeninde: GEMINI_KEY_SECRET). Tabloya
-- tarayıcıdan erişim yok; sadece sunucu (gizli anahtarla) okur/yazar.
-- Tarayıcıya anahtarın sadece son 4 karakteri gösterilir.
-- =====================================================================

create table public.ai_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  encrypted text not null,          -- base64(iv | tag | şifreli metin)
  last4 text not null,
  daily_limit integer not null default 200 check (daily_limit between 1 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_keys enable row level security;
revoke all on public.ai_keys from anon, authenticated;

-- Toplu örnek cümle işleri: istemcinin ilerleme göndermesi sunucu üzerinden
-- (gizli anahtarla) yapılır; kullanıcı sadece kendi işlerini okuyabilir (001'de).
alter table public.ai_jobs add column if not exists last_error_at timestamptz;

-- Artık kullanılmayan "uygulama geneli" sınırlar (herkes kendi anahtarını kullanıyor)
delete from public.app_config where key in ('gemini_global_daily_limit', 'gemini_default_user_limit');
