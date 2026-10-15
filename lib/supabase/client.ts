// Tarayıcı tarafı Supabase istemcisi.
// Oturum (giriş bilgisi) tarayıcının localStorage'ında saklanır; böylece
// internet yokken de "giriş yapmış" sayılırız ve uygulama açılır.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Yeni Supabase projelerinde "publishable key" (sb_publishable_...),
// eski projelerde "anon key" kullanılır. İkisinden biri yeterli.
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && key);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!url || !key) {
      throw new Error("Supabase ayarları eksik: .env.local dosyasını doldur (README'ye bak).");
    }
    client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true, // şifre sıfırlama bağlantısındaki oturumu yakala
        storageKey: "kk-auth",
      },
    });
  }
  return client;
}
