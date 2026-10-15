// KLASİK ALGORİTMA (SM-2, Anki'nin FSRS öncesi zamanlayıcısı). FSRS kapalıyken kullanılır.
//  - Yeni/öğrenme: adımlar (Tekrar → ilk adım, Zor → aynı adım, İyi → sonraki adım
//    ya da mezuniyet aralığı, Kolay → kolay aralığı)
//  - Tekrar: Tekrar → unutma (kolaylık −%20, aralık × "yeni aralık", yeniden öğrenme
//    adımları), Zor → aralık × zor çarpanı (kolaylık −%15), İyi → aralık × kolaylık,
//    Kolay → aralık × kolaylık × kolay bonusu (kolaylık +%15). Hepsi × aralık çarpanı.
// Saf fonksiyon: veritabanına dokunmaz. Aralıkların rastgeleleştirilmesi (fuzz) ve
// yük dengeleme sonradan uygulanır (lib/scheduler/fsrs.ts → schedule()).
import type { CardRow } from "@/lib/db/types";
import { type DeckOptions, stepMs } from "./config";

const DAY = 86_400_000;
export type Rating = 1 | 2 | 3 | 4;

export interface Sm2Result {
  state: number;
  step: number;
  /** Gün içi adımda: tam zaman (ms). Günlük aralıkta null (gün sayısı `days`) */
  dueMs: number | null;
  days: number; // gün aralığı (adımdaysa 0)
  ease: number; // binde
  lapses: number;
}

export function sm2Next(card: CardRow, rating: Rating, o: DeckOptions, now: number): Sm2Result {
  const L = o.learningSteps.map(stepMs);
  const R = o.relearningSteps.map(stepMs);
  const ease = card.ease > 0 && card.state !== 0 ? card.ease / 1000 : o.startingEase;
  const mod = o.intervalModifier;
  const toMs = (ms: number) => ({ dueMs: now + ms });

  // Adım (öğrenme ya da yeniden öğrenme) mantığı
  const stepped = (steps: number[], graduate: (easy: boolean) => number, isRelearn: boolean): Sm2Result => {
    const s = Math.min(card.state === 0 ? 0 : card.step, Math.max(0, steps.length - 1));
    const base = { ease: Math.round(ease * 1000), lapses: card.lapses };
    const grad = (easy: boolean): Sm2Result => {
      const days = graduate(easy);
      return { state: 2, step: 0, dueMs: null, days, ...base };
    };
    if (!steps.length) return grad(rating === 4);
    const state = isRelearn ? 3 : 1;
    switch (rating) {
      case 1:
        return { state, step: 0, ...toMs(steps[0]), days: 0, ...base };
      case 2: {
        const ms = s === 0 ? (steps.length > 1 ? (steps[0] + steps[1]) / 2 : steps[0] * 1.5) : steps[s];
        return { state, step: s, ...toMs(ms), days: 0, ...base };
      }
      case 3:
        if (s + 1 < steps.length) return { state, step: s + 1, ...toMs(steps[s + 1]), days: 0, ...base };
        return grad(false);
      case 4:
        return grad(true);
    }
  };

  if (card.state === 0 || card.state === 1) {
    return stepped(L, (easy) => (easy ? o.easyInterval : o.graduatingInterval), false);
  }
  if (card.state === 3) {
    // Unutmadan sonraki aralık interval_days'te saklı
    return stepped(R, (easy) => Math.max(o.minimumInterval, card.interval_days + (easy ? 1 : 0)), true);
  }

  // Tekrar kartı
  const ivl = Math.max(1, card.interval_days);
  const elapsed = card.last_review ? (now - card.last_review) / DAY : ivl;
  const delay = Math.max(0, elapsed - ivl);
  const cap = (d: number) => Math.min(o.maximumInterval, Math.max(o.minimumInterval, Math.round(d)));
  if (rating === 1) {
    const newIvl = cap(ivl * o.newInterval);
    const newEase = Math.max(1.3, ease - 0.2);
    const base = { ease: Math.round(newEase * 1000), lapses: card.lapses + 1 };
    if (R.length) return { state: 3, step: 0, dueMs: now + R[0], days: newIvl, ...base };
    return { state: 2, step: 0, dueMs: null, days: newIvl, ...base };
  }
  const hardIvl = cap(Math.max(ivl * o.hardInterval * mod, o.hardInterval > 1 ? ivl + 1 : 1));
  if (rating === 2) return { state: 2, step: 0, dueMs: null, days: hardIvl, ease: Math.round(Math.max(1.3, ease - 0.15) * 1000), lapses: card.lapses };
  const goodIvl = cap(Math.max((ivl + delay / 2) * ease * mod, hardIvl + 1));
  if (rating === 3) return { state: 2, step: 0, dueMs: null, days: goodIvl, ease: Math.round(ease * 1000), lapses: card.lapses };
  const easyIvl = cap(Math.max((ivl + delay) * ease * o.easyBonus * mod, goodIvl + 1));
  return { state: 2, step: 0, dueMs: null, days: easyIvl, ease: Math.round((ease + 0.15) * 1000), lapses: card.lapses };
}
