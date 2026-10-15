// Kişinin kendi Gemini anahtarı: durum (GET), kaydet/değiştir (PUT), sil (DELETE).
// Anahtar sunucuda şifreli saklanır; cevaplarda sadece son 4 karakteri döner.
import { GoogleGenAI } from "@google/genai";
import { encryptSecret } from "@/lib/server/ai/crypto";
import { AiError, aiErrorResponse, geminiModel, requireMember, toAiError, usedToday } from "@/lib/server/ai/gemini";

export async function GET(req: Request) {
  try {
    const ctx = await requireMember(req);
    const { data } = await ctx.admin.from("ai_keys").select("last4, daily_limit").eq("user_id", ctx.user.id).maybeSingle();
    return Response.json({
      hasKey: !!data,
      last4: data?.last4 ?? null,
      dailyLimit: data?.daily_limit ?? 200,
      usedToday: await usedToday(ctx),
      model: geminiModel(),
    });
  } catch (err) {
    return aiErrorResponse(err);
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await requireMember(req);
    const body = (await req.json().catch(() => null)) as { key?: string; dailyLimit?: number } | null;
    const key = body?.key?.trim();
    const limit = body?.dailyLimit === undefined ? undefined : Math.round(Number(body.dailyLimit));
    if (limit !== undefined && !(limit >= 1 && limit <= 100000)) throw new AiError("Günlük sınır 1 ile 100000 arasında olmalı.", 400, "bad_request");

    if (key) {
      if (key.length < 20 || /\s/.test(key)) throw new AiError("Bu bir Gemini API anahtarına benzemiyor.", 400, "bad_key");
      // Anahtarı dene (model bilgisi istemek kota harcamaz)
      try {
        await new GoogleGenAI({ apiKey: key }).models.get({ model: geminiModel() });
      } catch (err) {
        const e = toAiError(err);
        if (e.code === "bad_key" || e.status === 400) throw new AiError("Google bu anahtarı kabul etmedi. Doğru kopyaladığından emin ol.", 400, "bad_key");
        if (e.code !== "quota") throw e;
      }
      const row = { user_id: ctx.user.id, encrypted: encryptSecret(key), last4: key.slice(-4), updated_at: new Date().toISOString(), ...(limit ? { daily_limit: limit } : {}) };
      const { error } = await ctx.admin.from("ai_keys").upsert(row);
      if (error) throw new AiError("Anahtar kaydedilemedi.", 500);
    } else if (limit !== undefined) {
      const { error, count } = await ctx.admin.from("ai_keys").update({ daily_limit: limit }, { count: "exact" }).eq("user_id", ctx.user.id);
      if (error) throw new AiError("Kaydedilemedi.", 500);
      if (!count) throw new AiError("Önce anahtarını gir.", 400, "no_key");
    } else {
      throw new AiError("Anahtar ya da sınır gönderilmedi.", 400, "bad_request");
    }
    return GET(req);
  } catch (err) {
    return aiErrorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await requireMember(req);
    await ctx.admin.from("ai_keys").delete().eq("user_id", ctx.user.id);
    return Response.json({ hasKey: false });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
