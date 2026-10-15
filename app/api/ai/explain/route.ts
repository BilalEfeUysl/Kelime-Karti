// "Gemini'ye sor" hazır açıklama. Sonuç kelimeye göre ORTAK önbellekte tutulur:
// aynı kelime (herhangi bir kullanıcı tarafından) tekrar sorulursa kota harcanmaz.
import { EXPLAIN_SCHEMA, explainPrompt, normalizeWord, parseExplanation, PROMPT_VERSION } from "@/lib/ai/prompts";
import { AiError, aiErrorResponse, assertUnderLimit, countRequest, geminiModel, requireMember, toAiError, userGemini } from "@/lib/server/ai/gemini";

export async function POST(req: Request) {
  try {
    const ctx = await requireMember(req);
    const body = (await req.json().catch(() => null)) as { word?: string; meaning?: string; refresh?: boolean } | null;
    const word = normalizeWord(body?.word ?? "").slice(0, 80);
    if (!word) throw new AiError("Açıklanacak kelime boş.", 400, "bad_request");
    const model = geminiModel();
    const cacheKey = `explain:${PROMPT_VERSION}:${model}:${word}`;

    if (!body?.refresh) {
      const { data: hit } = await ctx.admin.from("ai_cache").select("response, hits").eq("key", cacheKey).maybeSingle();
      if (hit) {
        await ctx.admin.from("ai_cache").update({ hits: (hit.hits ?? 0) + 1 }).eq("key", cacheKey);
        return Response.json({ explanation: hit.response, cached: true });
      }
    }

    const { client, dailyLimit } = await userGemini(ctx);
    await assertUnderLimit(ctx, dailyLimit);
    let text: string;
    try {
      const res = await client.models.generateContent({
        model,
        contents: explainPrompt(word, body?.meaning?.slice(0, 200)),
        config: { responseMimeType: "application/json", responseJsonSchema: EXPLAIN_SCHEMA, temperature: 0.4 },
      });
      text = res.text ?? "";
      await countRequest(ctx, "explain", res.usageMetadata?.totalTokenCount ?? 0);
    } catch (err) {
      throw toAiError(err);
    }
    const explanation = parseExplanation(text, word);
    if (!explanation) throw new AiError("Gemini'nin cevabı anlaşılamadı, tekrar dene.", 502);
    await ctx.admin.from("ai_cache").upsert({ key: cacheKey, kind: "explain", model, response: explanation, hits: 0 });
    return Response.json({ explanation, cached: false });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
