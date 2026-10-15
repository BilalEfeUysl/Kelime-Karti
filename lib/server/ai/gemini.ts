// SUNUCU: Gemini isteklerinin ortak kısmı.
//  - İsteği yapan kişi giriş yapmış, aktif bir üye mi?
//  - Kişinin KENDİ anahtarı (şifreli saklanan) çözülür; tarayıcıya hiç gönderilmez.
//  - Günlük sayaç: Google'ın ücretsiz kotası gibi Pasifik saatiyle gece yarısı sıfırlanır.
//  - Gemini hataları anlaşılır Türkçe mesajlara çevrilir.
import { ApiError, GoogleGenAI } from "@google/genai";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getAdminClient, getUserFromRequest } from "@/lib/supabase/server";
import { decryptSecret } from "./crypto";

export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: "auth" | "no_key" | "limit" | "quota" | "bad_key" | "gemini" | "bad_request" = "gemini",
  ) {
    super(message);
  }
}

export function aiErrorResponse(err: unknown) {
  const e = err instanceof AiError ? err : toAiError(err);
  return Response.json({ error: e.message, code: e.code }, { status: e.status });
}

/** Pasifik saatine göre bugünün tarihi (YYYY-AA-GG): Gemini kotası bu saatte sıfırlanır */
export function quotaDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export const QUOTA_RESET_TEXT = "Türkiye saatiyle yaklaşık 10:00–11:00'da";

/** Gemini'den gelen hatayı sınıflandırır */
export function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  const status = err instanceof ApiError ? err.status : Number((err as { status?: number })?.status) || 0;
  const msg = String((err as Error)?.message ?? err);
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    return new AiError(`Gemini ücretsiz kullanım sınırın doldu. Sınır ${QUOTA_RESET_TEXT} sıfırlanır.`, 429, "quota");
  }
  if (status === 400 && /API key|API_KEY_INVALID/i.test(msg)) return new AiError("Gemini anahtarın geçersiz. Ayarlar'dan yeniden gir.", 400, "bad_key");
  if (status === 401 || status === 403) return new AiError("Gemini anahtarın bu işlem için yetkili değil. Ayarlar'dan kontrol et.", 403, "bad_key");
  if (status === 404) return new AiError(`Gemini modeli bulunamadı (${geminiModel()}).`, 502, "gemini");
  if (status >= 500 || /fetch failed|ECONN|ETIMEDOUT/i.test(msg)) return new AiError("Gemini şu an cevap vermiyor, biraz sonra tekrar dene.", 503, "gemini");
  return new AiError("Gemini isteği başarısız oldu.", 502, "gemini");
}

export interface AiContext {
  user: User;
  admin: SupabaseClient;
}

/** Giriş yapmış ve aktif üye mi? */
export async function requireMember(req: Request): Promise<AiContext> {
  const user = await getUserFromRequest(req);
  if (!user) throw new AiError("Oturum gerekli, tekrar giriş yap.", 401, "auth");
  const admin = getAdminClient();
  const { data } = await admin.from("profiles").select("disabled_at").eq("id", user.id).maybeSingle();
  if (!data || data.disabled_at) throw new AiError("Bu hesabın erişimi kapalı.", 403, "auth");
  return { user, admin };
}

export interface UserKey {
  client: GoogleGenAI;
  dailyLimit: number;
}

/** Kişinin anahtarını çözer ve Gemini istemcisi oluşturur */
export async function userGemini(ctx: AiContext): Promise<UserKey> {
  const { data } = await ctx.admin.from("ai_keys").select("encrypted, daily_limit").eq("user_id", ctx.user.id).maybeSingle();
  if (!data) throw new AiError("Önce Ayarlar → Gemini bölümünden kendi API anahtarını gir.", 400, "no_key");
  let key: string;
  try {
    key = decryptSecret(data.encrypted);
  } catch {
    throw new AiError("Kayıtlı anahtar okunamadı (sunucu ayarı değişmiş olabilir). Anahtarını yeniden gir.", 400, "no_key");
  }
  return { client: new GoogleGenAI({ apiKey: key }), dailyLimit: data.daily_limit };
}

/** Bugün yapılan istek sayısı */
export async function usedToday(ctx: AiContext): Promise<number> {
  const { data } = await ctx.admin.from("ai_usage").select("requests").eq("user_id", ctx.user.id).eq("day", quotaDay());
  return (data ?? []).reduce((s, r) => s + (r.requests ?? 0), 0);
}

/** Günlük sınırı aştıysa hata fırlatır */
export async function assertUnderLimit(ctx: AiContext, limit: number): Promise<number> {
  const used = await usedToday(ctx);
  if (used >= limit) {
    throw new AiError(`Bugünkü Gemini hakkın (${limit}) doldu. Sınır ${QUOTA_RESET_TEXT} sıfırlanır; Ayarlar'dan değiştirebilirsin.`, 429, "limit");
  }
  return limit - used;
}

/** Bir isteği sayaca ekler */
export async function countRequest(ctx: AiContext, kind: string, tokens = 0): Promise<void> {
  const day = quotaDay();
  const { data } = await ctx.admin.from("ai_usage").select("id, requests, tokens").eq("user_id", ctx.user.id).eq("day", day).eq("kind", kind).maybeSingle();
  if (data) {
    await ctx.admin.from("ai_usage").update({ requests: data.requests + 1, tokens: data.tokens + tokens }).eq("id", data.id);
  } else {
    await ctx.admin.from("ai_usage").insert({ user_id: ctx.user.id, day, kind, requests: 1, tokens });
  }
}
