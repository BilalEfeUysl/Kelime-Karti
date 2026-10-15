// Toplu örnek cümle üretimi: tek istekte en fazla 25 kelime, yapılandırılmış JSON.
// Bozuk/eksik cevaplar ayıklanır; eksik kalan kelimeler "missing" ile döner
// (istemci onları sonraki partiye koyar). Cümleler istemcide yerel veritabanına
// "onay bekliyor" olarak yazılır ve normal şekilde eşlenir.
import { BATCH_SCHEMA, BATCH_SIZE, type BatchWord, batchPrompt, parseBatch } from "@/lib/ai/prompts";
import { AiError, aiErrorResponse, assertUnderLimit, countRequest, geminiModel, requireMember, toAiError, userGemini } from "@/lib/server/ai/gemini";

export async function POST(req: Request) {
  try {
    const ctx = await requireMember(req);
    const body = (await req.json().catch(() => null)) as { jobId?: string; items?: BatchWord[] } | null;
    const { data: job } = await ctx.admin.from("ai_jobs").select("status, params").eq("id", body?.jobId ?? "").eq("user_id", ctx.user.id).maybeSingle();
    if (!job) throw new AiError("İş bulunamadı.", 404, "bad_request");
    if (job.status !== "running") throw new AiError("İş duraklatılmış ya da bitmiş.", 409, "bad_request");
    const items = (body?.items ?? [])
      .filter((w) => typeof w?.id === "string" && typeof w?.word === "string" && w.word.trim())
      .slice(0, BATCH_SIZE)
      .map((w) => ({ id: w.id, word: w.word.trim().slice(0, 80), meaning: w.meaning?.trim().slice(0, 120) || undefined }));
    if (!items.length) throw new AiError("Kelime yok.", 400, "bad_request");
    const opts = { count: Number(job.params.count) || 2, level: String(job.params.level || "YDS / B1-B2"), translate: job.params.translate !== false };

    const { client, dailyLimit } = await userGemini(ctx);
    const remaining = await assertUnderLimit(ctx, dailyLimit);
    let text: string;
    try {
      const res = await client.models.generateContent({
        model: geminiModel(),
        contents: batchPrompt(items, opts),
        config: { responseMimeType: "application/json", responseJsonSchema: BATCH_SCHEMA, temperature: 0.8 },
      });
      text = res.text ?? "";
      await countRequest(ctx, "examples", res.usageMetadata?.totalTokenCount ?? 0);
    } catch (err) {
      throw toAiError(err);
    }
    const { results, missing } = parseBatch(text, items, opts);
    return Response.json({ results: Object.fromEntries(results), missing, remainingToday: remaining - 1 });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
