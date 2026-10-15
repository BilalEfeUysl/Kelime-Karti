// SUNUCU tarafı Supabase yardımcıları (Next.js Route Handler'larında kullanılır).
// Gizli anahtar (SUPABASE_SECRET_KEY) ASLA tarayıcıya gitmez; bu dosya
// sadece sunucuda çalışır.
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    throw new Error("Sunucu ayarları eksik: NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SECRET_KEY gerekli.");
  }
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** İstekteki "Authorization: Bearer <token>" başlığından kullanıcıyı doğrular. */
export async function getUserFromRequest(req: Request): Promise<User | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await getAdminClient().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

/** İsteği yapan kişi aktif bir admin mi? Değilse null döner. */
export async function requireAdmin(req: Request): Promise<User | null> {
  const user = await getUserFromRequest(req);
  if (!user) return null;
  const { data } = await getAdminClient()
    .from("profiles")
    .select("role, disabled_at")
    .eq("id", user.id)
    .maybeSingle();
  return data?.role === "admin" && !data.disabled_at ? user : null;
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
