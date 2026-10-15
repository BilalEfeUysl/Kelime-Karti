// FSRS OPTİMİZASYONU (sunucu): cevap geçmişinden kişisel FSRS parametrelerini hesaplar.
// Tarayıcı her kartın geçmişini [puan, önceki tekrardan bu yana gün] dizisi
// olarak gönderir; resmi fsrs-rs kütüphanesi (Node bağlaması) eğitimi yapar.
// Hiçbir şey saklanmaz; sonuç tarayıcıda deste ayarına yazılır.
import { computeParameters, FSRSBindingItem, FSRSBindingReview } from "@open-spaced-repetition/binding";
import { aiErrorResponse, AiError, requireMember } from "@/lib/server/ai/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

const MIN_REVIEWS = 400;

export async function POST(req: Request) {
  try {
    await requireMember(req);
    const body = (await req.json().catch(() => null)) as { histories?: [number, number][][]; relearningSteps?: number } | null;
    const histories = (body?.histories ?? []).slice(0, 100_000);
    // Her kart için: ilk tekrardan başlayarak, son tekrarı "tahmin edilecek" olan önekler
    const items: FSRSBindingItem[] = [];
    let reviews = 0;
    for (const h of histories) {
      if (!Array.isArray(h) || h.length < 2) continue;
      const clean = h
        .filter((r) => Array.isArray(r) && r[0] >= 1 && r[0] <= 4 && r[1] >= 0)
        .map(([rating, delta]) => new FSRSBindingReview(Math.round(rating), Math.round(delta)));
      reviews += clean.length;
      for (let i = 2; i <= clean.length; i++) {
        if (clean[i - 1].deltaT > 0) items.push(new FSRSBindingItem(clean.slice(0, i)));
      }
    }
    if (reviews < MIN_REVIEWS) {
      throw new AiError(`Optimizasyon için en az ${MIN_REVIEWS} tekrar gerekiyor (şu an ${reviews}). Biraz daha çalışınca tekrar dene.`, 400, "bad_request");
    }
    const params = await computeParameters(items, {
      enableShortTerm: true,
      numRelearningSteps: Math.max(0, Math.min(10, Number(body?.relearningSteps) || 1)),
      timeout: 500,
    });
    if (!Array.isArray(params) || params.length < 17 || params.some((x) => !Number.isFinite(x))) {
      throw new AiError("Parametreler hesaplanamadı.", 500);
    }
    return Response.json({ params: params.map((x) => Math.round(x * 10000) / 10000), reviews, items: items.length });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
