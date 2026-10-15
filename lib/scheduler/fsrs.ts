// ZAMANLAYICI (ortak giriş noktası). Saf fonksiyonlar: veritabanına dokunmaz.
//
//  - FSRS açıksa ts-fsrs (öğrenme/yeniden öğrenme adımlarıyla), kapalıysa klasik
//    SM-2 (lib/scheduler/sm2.ts) kullanılır.
//  - Günlük aralıklar sonradan "bulanıklaştırılır" (fuzz: hep aynı güne yığılmasın)
//    ve yük dengelemesi açıksa bulanık aralıktaki EN BOŞ gün seçilir; "kolay günler"
//    (ör. pazar yarım yük) burada hesaba katılır.
//  - Rastgelelik karta bağlıdır: düğmelerin önizlemesi ile gerçek sonuç aynıdır.
import {
  type Card as FsrsCard,
  fsrs,
  type FSRS,
  GenSeedStrategyWithCardId,
  type Grade,
  Rating,
  type StepUnit,
  StrategyMode,
} from "ts-fsrs";
import type { CardRow, ReviewLogRow } from "@/lib/db/types";
import type { DeckOptions } from "./config";
import type { DayInfo } from "./day";
import { formatInterval } from "./format";
import { sm2Next } from "./sm2";

export type Answer = 1 | 2 | 3 | 4; // Tekrar, Zor, İyi, Kolay
export const ANSWERS: Answer[] = [1, 2, 3, 4];
export const ANSWER_LABELS: Record<Answer, string> = { 1: "Tekrar", 2: "Zor", 3: "İyi", 4: "Kolay" };

const DAY = 86_400_000;

/** Kartın zamanlama alanları (bir cevaptan sonra değişenler) */
export type SchedPatch = Pick<
  CardRow,
  "state" | "step" | "due" | "stability" | "difficulty" | "elapsed_days" | "scheduled_days" | "reps" | "lapses" | "last_review" | "interval_days" | "ease"
>;

/** Yük dengeleme için: bugünden itibaren gün → o gün vakti gelen tekrar sayısı */
export interface ScheduleContext {
  day?: DayInfo;
  dueOnDay?: (dayOffset: number) => number;
}

const schedulers = new Map<string, FSRS>();

export function getScheduler(opts: DeckOptions): FSRS {
  const key = JSON.stringify([opts.desiredRetention, opts.maximumInterval, opts.learningSteps, opts.relearningSteps, opts.fsrsParams]);
  let f = schedulers.get(key);
  if (!f) {
    f = fsrs({
      request_retention: opts.desiredRetention,
      maximum_interval: opts.maximumInterval,
      enable_fuzz: false, // bulanıklaştırmayı biz yapıyoruz (yük dengeleme ile birlikte)
      enable_short_term: true,
      learning_steps: opts.learningSteps as StepUnit[],
      relearning_steps: opts.relearningSteps as StepUnit[],
      ...(opts.fsrsParams ? { w: opts.fsrsParams } : {}),
    }).useStrategy(StrategyMode.SEED, GenSeedStrategyWithCardId("cid"));
    schedulers.set(key, f);
  }
  return f;
}

/** Bizim kart satırını ts-fsrs kartına çevirir. Klasik algoritmadan gelen
 *  (FSRS hafıza değeri olmayan) kartlar için aralık/kolaylıktan tahmin edilir. */
export function toFsrsCard(card: CardRow, now: number): FsrsCard & { cid: string } {
  let stability = card.stability;
  let difficulty = card.difficulty;
  if (card.state !== 0 && (!(stability > 0) || !(difficulty > 0))) {
    stability = Math.max(0.5, card.interval_days || 1);
    difficulty = Math.min(10, Math.max(1, 5 - ((card.ease || 2500) / 1000 - 2.5) * 4.2));
  }
  return {
    cid: card.id,
    due: new Date(card.state === 0 ? now : card.due),
    stability,
    difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.step,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  };
}

/** Karta ve tekrar sayısına bağlı, tekrarlanabilir 0..1 sayı */
function seeded(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/** Anki'nin bulanıklaştırma aralığı */
export function fuzzRange(days: number, maxIvl: number): [number, number] {
  if (days < 2.5) return [days, days];
  const delta = Math.max(1, days < 7 ? days * 0.15 : days < 20 ? days * 0.1 : days * 0.05);
  const lo = Math.max(2, Math.round(days - delta));
  const hi = Math.min(maxIvl, Math.round(days + delta));
  return [Math.min(lo, hi), hi];
}

/** Bulanık aralıktan gün seç: yük dengeleme açıksa en boş (kolay günlere göre ağırlıklı) gün */
export function pickDays(days: number, card: CardRow, opts: DeckOptions, ctx: ScheduleContext | undefined): number {
  const [lo, hi] = fuzzRange(days, opts.maximumInterval);
  if (lo === hi) return lo;
  const r = seeded(card.id, card.reps);
  if (!opts.loadBalance || !ctx?.dueOnDay || !ctx.day) return lo + Math.floor(r * (hi - lo + 1));
  const weekdayOf = (offset: number) => (((ctx.day!.today + offset + 3) % 7) + 7) % 7; // 0 = pazartesi
  let best = lo;
  let bestScore = Infinity;
  for (let d = lo; d <= hi; d++) {
    const factor = opts.easyDays[weekdayOf(d)] ?? 1;
    // Boş gün (0) sadece başka seçenek yoksa
    const score = factor <= 0 ? 1e9 + d : (ctx.dueOnDay(d) + 1) / factor + seeded(card.id, d) * 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function fromFsrsCard(c: FsrsCard, card: CardRow, opts: DeckOptions, now: number, ctx?: ScheduleContext): SchedPatch {
  let due = c.due.getTime();
  let days = c.scheduled_days;
  if (c.state === 2 && days >= 1) {
    days = pickDays(days, card, opts, ctx);
    due = now + days * DAY;
  }
  return {
    state: c.state,
    step: c.learning_steps,
    due,
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: days,
    reps: c.reps,
    lapses: c.lapses,
    last_review: now,
    interval_days: c.state === 2 ? days : c.state === 3 ? card.interval_days : days,
    ease: card.ease,
  };
}

/** Dört cevabın sonuçları (kartın yeni zamanlama alanları) */
export function nextStates(card: CardRow, opts: DeckOptions, now: number, ctx?: ScheduleContext): Record<Answer, SchedPatch> {
  const out = {} as Record<Answer, SchedPatch>;
  if (opts.fsrs) {
    const preview = getScheduler(opts).repeat(toFsrsCard(card, now), new Date(now));
    for (const a of ANSWERS) out[a] = fromFsrsCard(preview[a as Grade].card, card, opts, now, ctx);
    return out;
  }
  for (const a of ANSWERS) {
    const r = sm2Next(card, a, opts, now);
    const graduated = r.dueMs === null;
    const days = graduated ? (r.days >= 1 ? pickDays(r.days, card, opts, ctx) : r.days) : 0;
    out[a] = {
      state: r.state,
      step: r.step,
      due: graduated ? now + days * DAY : r.dueMs!,
      stability: card.stability,
      difficulty: card.difficulty,
      elapsed_days: card.last_review ? Math.max(0, Math.floor((now - card.last_review) / DAY)) : 0,
      scheduled_days: graduated ? days : 0,
      reps: card.reps + 1,
      lapses: r.lapses,
      last_review: now,
      interval_days: graduated ? days : r.state === 3 ? r.days : card.interval_days,
      ease: r.ease,
    };
  }
  return out;
}

/** Dört butonun sonraki aralık önizlemesi ("<10dk", "3g", "1,2ay") */
export function previewAnswers(card: CardRow, opts: DeckOptions, now: number, ctx?: ScheduleContext): Record<Answer, string> {
  const states = nextStates(card, opts, now, ctx);
  const out = {} as Record<Answer, string>;
  for (const a of ANSWERS) out[a] = formatInterval(states[a].due - now);
  return out;
}

/** Bir cevabın sonucu: kartın yeni zamanlama alanları + cevap geçmişi kaydı */
export function answerCard(
  card: CardRow,
  answer: Answer,
  opts: DeckOptions,
  now: number,
  extra: { durationMs: number; filtered?: boolean },
  ctx?: ScheduleContext,
): { patch: SchedPatch; log: Partial<ReviewLogRow> } {
  const patch = nextStates(card, opts, now, ctx)[answer];
  const kind = extra.filtered ? 3 : card.state === 2 ? 1 : card.state === 3 ? 2 : 0;
  const log: Partial<ReviewLogRow> = {
    card_id: card.id,
    note_id: card.note_id,
    deck_id: card.original_deck_id ?? card.deck_id,
    reviewed_at: now,
    rating: answer,
    kind,
    state: card.state,
    due: card.state === 0 ? null : card.due,
    stability: patch.stability,
    difficulty: patch.difficulty,
    elapsed_days: card.last_review ? Math.max(0, Math.floor((now - card.last_review) / DAY)) : 0,
    last_elapsed_days: card.elapsed_days,
    scheduled_days: patch.scheduled_days,
    interval_before: card.interval_days,
    interval_after: patch.interval_days,
    ease: card.ease,
    duration_ms: Math.max(0, Math.round(extra.durationMs)),
  };
  return { patch, log };
}

/** Şu anki hatırlama olasılığı (kart bilgisi, arama, istatistik için) */
export function retrievability(card: CardRow, opts: DeckOptions, now: number): number | null {
  if (card.state === 0 || !card.last_review) return null;
  return getScheduler(opts).get_retrievability(toFsrsCard(card, now), new Date(now), false);
}

export { Rating };
