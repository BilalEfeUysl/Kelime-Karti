// Serbest sohbet: kart içeriği bağlam olarak gider, cevap parça parça (streaming) gelir.
import { AiError, aiErrorResponse, assertUnderLimit, countRequest, geminiModel, requireMember, toAiError, userGemini } from "@/lib/server/ai/gemini";

interface ChatMessage {
  role: "user" | "model";
  text: string;
}

const SYSTEM =
  "Sen Türk öğrencilere YDS için İngilizce öğreten, kısa ve net cevap veren yardımcı bir öğretmensin. " +
  "Türkçe cevap ver (İngilizce örnekler hariç). Soru karttaki örnek cümleyle ilgiliyse o cümleye göre cevapla. " +
  "Biçim: kısa paragraflar; gerekiyorsa '- ' ile madde işaretleri; önemli kelimeleri **kalın** yaz; " +
  "İngilizce örnek cümleleri *italik* yaz. Başlık, tablo ve uzun giriş cümleleri kullanma; gereksiz uzatma.";

export async function POST(req: Request) {
  try {
    const ctx = await requireMember(req);
    const body = (await req.json().catch(() => null)) as { messages?: ChatMessage[]; context?: string } | null;
    const messages = (body?.messages ?? [])
      .filter((m) => (m.role === "user" || m.role === "model") && typeof m.text === "string" && m.text.trim())
      .slice(-20)
      .map((m) => ({ role: m.role, parts: [{ text: m.text.slice(0, 4000) }] }));
    if (!messages.length || messages[messages.length - 1].role !== "user") throw new AiError("Mesaj boş.", 400, "bad_request");

    const { client, dailyLimit } = await userGemini(ctx);
    await assertUnderLimit(ctx, dailyLimit);
    const context = body?.context?.slice(0, 3000);
    let stream: AsyncGenerator<{ text?: string }>;
    try {
      stream = await client.models.generateContentStream({
        model: geminiModel(),
        contents: messages,
        config: { systemInstruction: context ? `${SYSTEM}\n\nÖğrencinin üzerinde çalıştığı kart:\n${context}` : SYSTEM, temperature: 0.6 },
      });
    } catch (err) {
      throw toAiError(err);
    }
    await countRequest(ctx, "chat");

    const encoder = new TextEncoder();
    const body2 = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of stream) if (chunk.text) controller.enqueue(encoder.encode(chunk.text));
        } catch (err) {
          controller.enqueue(encoder.encode(`\n\n[Hata: ${toAiError(err).message}]`));
        }
        controller.close();
      },
    });
    return new Response(body2, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
