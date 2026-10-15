// İSTATİSTİK HESAPLARI (tamamen cihazda). Saf fonksiyonlar: veritabanına dokunmaz.
import type { CardRow, ReviewLogRow } from "@/lib/db/types";
import type { DeckOptions } from "@/lib/scheduler/config";
import type { DayInfo } from "@/lib/scheduler/day";
import { retrievability } from "@/lib/scheduler/fsrs";

const DAY = 86_400_000;
export const MATURE_DAYS = 21;

export interface StatsInput {
  cards: CardRow[]; // seçilen destelerdeki (silinmemiş) kartlar
  logs: ReviewLogRow[]; // bu kartların silinmemiş cevapları
  day: DayInfo;
  now: number;
  /** Grafiklerin kapsadığı gün sayısı (ör. 30, 365) */
  rangeDays: number;
  optionsFor: (card: CardRow) => DeckOptions;
}

export interface Bucket {
  label: string;
  value: number;
}

export interface Stats {
  today: { count: number; ms: number; again: number; learn: number; review: number; relearn: number; filtered: number; correctPct: number | null };
  heatmap: Map<number, number>; // gün farkı (0 = bugün, -1 = dün…) → cevap sayısı
  future: { offset: number; count: number }[]; // 0 = bugün (gecikenler dahil)
  daily: { offset: number; learn: number; review: number; relearn: number; minutes: number }[];
  counts: { new: number; learning: number; young: number; mature: number; suspended: number; buried: number };
  intervals: Bucket[];
  difficulty: Bucket[];
  stability: Bucket[];
  retrievability: Bucket[];
  ease: Bucket[];
  hourly: { hour: number; count: number; correctPct: number | null }[];
  buttons: { group: "Öğrenme" | "Genç" | "Olgun"; counts: [number, number, number, number] }[];
  added: { offset: number; count: number }[];
  retention: { period: string; young: [number, number]; mature: [number, number] }[];
  totals: { reviews: number; ms: number; daysStudied: number; streak: number };
}

/** Bir anın bugüne göre gün farkı (0 = bugün, -1 = dün) */
export function dayOffset(t: number, day: DayInfo): number {
  return Math.floor((t - day.dayStart) / DAY);
}

function histogram(values: number[], edges: number[], fmt: (lo: number, hi: number, last: boolean) => string): Bucket[] {
  const out = edges.slice(0, -1).map((lo, i) => ({ label: fmt(lo, edges[i + 1], i === edges.length - 2), value: 0 }));
  for (const v of values) {
    let i = edges.findIndex((e, k) => k < edges.length - 1 && v >= e && v < edges[k + 1]);
    if (i < 0) i = v >= edges[edges.length - 1] ? out.length - 1 : 0;
    out[i].value++;
  }
  return out;
}

const isAnswer = (l: ReviewLogRow) => l.rating >= 1 && l.rating <= 4 && l.kind !== 4;

export function computeStats(input: StatsInput): Stats {
  const { cards, logs, day, now, rangeDays } = input;
  const answers = logs.filter((l) => l.deleted_at === null && isAnswer(l));

  // --- bugün
  const todayLogs = answers.filter((l) => l.reviewed_at >= day.dayStart);
  const reviewKind = todayLogs.filter((l) => l.kind === 1);
  const today = {
    count: todayLogs.length,
    ms: todayLogs.reduce((s, l) => s + l.duration_ms, 0),
    again: todayLogs.filter((l) => l.rating === 1).length,
    learn: todayLogs.filter((l) => l.kind === 0).length,
    review: reviewKind.length,
    relearn: todayLogs.filter((l) => l.kind === 2).length,
    filtered: todayLogs.filter((l) => l.kind === 3).length,
    correctPct: reviewKind.length ? Math.round((reviewKind.filter((l) => l.rating > 1).length / reviewKind.length) * 100) : null,
  };

  // --- takvim ve günlük
  const heatmap = new Map<number, number>();
  const dailyMap = new Map<number, { learn: number; review: number; relearn: number; ms: number }>();
  for (const l of answers) {
    const off = dayOffset(l.reviewed_at, day);
    heatmap.set(off, (heatmap.get(off) ?? 0) + 1);
    if (off > -rangeDays) {
      const d = dailyMap.get(off) ?? { learn: 0, review: 0, relearn: 0, ms: 0 };
      if (l.kind === 0) d.learn++;
      else if (l.kind === 2) d.relearn++;
      else d.review++;
      d.ms += l.duration_ms;
      dailyMap.set(off, d);
    }
  }
  const daily = Array.from({ length: rangeDays }, (_, i) => {
    const off = i - rangeDays + 1;
    const d = dailyMap.get(off);
    return { offset: off, learn: d?.learn ?? 0, review: d?.review ?? 0, relearn: d?.relearn ?? 0, minutes: Math.round((d?.ms ?? 0) / 60000) };
  });

  // Seri (art arda çalışılan günler) ve toplamlar
  let streak = 0;
  for (let off = heatmap.has(0) ? 0 : -1; heatmap.has(off); off--) streak++;
  const totals = { reviews: answers.length, ms: answers.reduce((s, l) => s + l.duration_ms, 0), daysStudied: heatmap.size, streak };

  // --- gelecek yük ve kart sayıları
  const futureDays = Math.min(rangeDays, 90);
  const future = Array.from({ length: futureDays }, (_, i) => ({ offset: i, count: 0 }));
  const counts = { new: 0, learning: 0, young: 0, mature: 0, suspended: 0, buried: 0 };
  const active: CardRow[] = [];
  for (const c of cards) {
    if (c.suspended) counts.suspended++;
    else if (c.buried_until && c.buried_until > now) counts.buried++;
    else if (c.state === 0) counts.new++;
    else if (c.state === 1 || c.state === 3) counts.learning++;
    else if (c.interval_days >= MATURE_DAYS) counts.mature++;
    else counts.young++;
    if (c.state !== 0 && !c.suspended) {
      active.push(c);
      const off = Math.max(0, dayOffset(c.due, day));
      if (off < futureDays) future[off].count++;
    }
  }

  const reviewCards = active.filter((c) => c.state === 2);
  const intervals = histogram(
    reviewCards.map((c) => c.interval_days),
    [0, 2, 3, 5, 8, 15, 31, 61, 91, 181, 366, 1e9],
    (lo, hi, last) => (last ? "1 yıl+" : hi - lo === 1 ? `${lo} g` : hi <= 31 ? `${lo}–${hi - 1} g` : `${Math.round(lo / 30)}–${Math.round((hi - 1) / 30)} ay`),
  );
  intervals[0].label = "1 g";
  const fsrsCards = active.filter((c) => c.stability > 0 && c.difficulty > 0);
  const pct = (lo: number, hi: number) => `%${lo}–${hi}`;
  const difficulty = histogram(
    fsrsCards.map((c) => ((c.difficulty - 1) / 9) * 100),
    [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100.0001],
    (lo, hi) => pct(lo, Math.round(hi)),
  );
  const stability = histogram(
    fsrsCards.map((c) => c.stability),
    [0, 1, 3, 7, 15, 30, 60, 120, 365, 1e9],
    (lo, hi, last) => (last ? "1 yıl+" : `${lo}–${hi} g`),
  );
  const retrievability_ = histogram(
    fsrsCards.map((c) => (retrievability(c, input.optionsFor(c), now) ?? 0) * 100),
    [0, 50, 60, 70, 80, 85, 90, 95, 100.0001],
    (lo, hi) => pct(lo, Math.round(hi)),
  );
  const ease = histogram(
    reviewCards.filter((c) => c.ease > 0).map((c) => c.ease / 1000),
    [0, 1.5, 1.9, 2.1, 2.3, 2.5, 2.7, 3, 1e9],
    (lo, hi, last) => (last ? "3,0+" : lo === 0 ? "<1,5" : `${lo.toFixed(1).replace(".", ",")}–${hi.toFixed(1).replace(".", ",")}`),
  );

  // --- saatlik başarı, düğmeler, eklenen
  const inRange = answers.filter((l) => l.reviewed_at >= day.dayStart - (rangeDays - 1) * DAY);
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, correct: 0 }));
  for (const l of inRange) {
    const h = new Date(l.reviewed_at).getHours();
    hourly[h].count++;
    if (l.rating > 1) hourly[h].correct++;
  }
  const buttons: Stats["buttons"] = [
    { group: "Öğrenme", counts: [0, 0, 0, 0] },
    { group: "Genç", counts: [0, 0, 0, 0] },
    { group: "Olgun", counts: [0, 0, 0, 0] },
  ];
  for (const l of inRange) {
    const g = l.kind === 1 ? ((l.interval_before ?? 0) >= MATURE_DAYS ? 2 : 1) : 0;
    buttons[g].counts[l.rating - 1]++;
  }
  const addedMap = new Map<number, number>();
  for (const c of cards) {
    const off = dayOffset(c.created_at, day);
    if (off > -rangeDays) addedMap.set(off, (addedMap.get(off) ?? 0) + 1);
  }
  const added = Array.from({ length: rangeDays }, (_, i) => ({ offset: i - rangeDays + 1, count: addedMap.get(i - rangeDays + 1) ?? 0 }));

  // --- gerçek hatırlama oranı (tekrar kartlarında "Tekrar" dışı cevap oranı)
  const periods: [string, number, number][] = [
    ["Bugün", 0, 0],
    ["Dün", -1, -1],
    ["Son 7 gün", -6, 0],
    ["Son 30 gün", -29, 0],
    ["Son 1 yıl", -364, 0],
  ];
  const retention = periods.map(([period, from, to]) => {
    const young: [number, number] = [0, 0];
    const mature: [number, number] = [0, 0];
    for (const l of answers) {
      if (l.kind !== 1) continue;
      const off = dayOffset(l.reviewed_at, day);
      if (off < from || off > to) continue;
      const bucket = (l.interval_before ?? 0) >= MATURE_DAYS ? mature : young;
      bucket[1]++;
      if (l.rating > 1) bucket[0]++;
    }
    return { period, young, mature };
  });

  return {
    today,
    heatmap,
    future,
    daily,
    counts,
    intervals,
    difficulty,
    stability,
    retrievability: retrievability_,
    ease,
    hourly: hourly.map((h) => ({ hour: h.hour, count: h.count, correctPct: h.count ? Math.round((h.correct / h.count) * 100) : null })),
    buttons,
    added,
    retention,
    totals,
  };
}
