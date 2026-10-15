// FSRS KİŞİSELLEŞTİRME (istemci tarafı):
//  - Cevap geçmişini kart başına [puan, önceki tekrardan bu yana gün] dizisine çevirir
//    (sunucudaki /api/fsrs/optimize bunlarla eğitim yapar).
//  - İstenen hatırlama oranına göre günlük tekrar yükünü tahmin eder.
import type { CardRow, ReviewLogRow } from "@/lib/db/types";
import { getDayInfo } from "./day";

const DAY = 86_400_000;

/** Kart başına geçmişler. "Unut" (elle sıfırlama) sonrası geçmiş yeniden başlar. */
export function buildHistories(logs: ReviewLogRow[], cardIds: Set<string>, timeZone: string, dayStartHour: number): [number, number][][] {
  const byCard = new Map<string, ReviewLogRow[]>();
  for (const l of logs) {
    if (l.deleted_at !== null || !cardIds.has(l.card_id)) continue;
    byCard.set(l.card_id, [...(byCard.get(l.card_id) ?? []), l]);
  }
  const dayOf = new Map<number, number>();
  const dayNumber = (t: number) => {
    const hourKey = Math.floor(t / 3_600_000); // aynı saatteki tekrarlar için tekrar hesaplama
    let d = dayOf.get(hourKey);
    if (d === undefined) {
      d = getDayInfo(t, timeZone, dayStartHour).today;
      dayOf.set(hourKey, d);
    }
    return d;
  };
  const out: [number, number][][] = [];
  for (const list of byCard.values()) {
    list.sort((a, b) => a.reviewed_at - b.reviewed_at);
    let cur: [number, number][] = [];
    let lastDay: number | null = null;
    for (const l of list) {
      if (l.kind === 4) {
        // Elle işlem: "unut" ise geçmiş sıfırlanır; tarih atama atlanır
        if (!l.interval_after) {
          if (cur.length > 1) out.push(cur);
          cur = [];
          lastDay = null;
        }
        continue;
      }
      if (l.rating < 1 || l.rating > 4 || l.kind === 3) continue; // filtreli (alıştırma) hariç
      const d = dayNumber(l.reviewed_at);
      cur.push([l.rating, lastDay === null ? 0 : Math.max(0, d - lastDay)]);
      lastDay = d;
    }
    if (cur.length > 1) out.push(cur);
  }
  return out;
}

/** Bir hatırlama oranında, verilen kararlılıkla aralık (gün) — FSRS-6 unutma eğrisi */
export function intervalFor(stability: number, retention: number, params: number[] | null): number {
  const decay = -(params && params.length >= 21 ? params[20] : 0.1542);
  const factor = Math.pow(0.9, 1 / decay) - 1;
  return Math.max(1, (stability / factor) * (Math.pow(retention, 1 / decay) - 1));
}

/** Günlük tekrar yükü tahmini (yeni kartlar hariç): Σ 1/aralık */
export function estimateWorkload(cards: CardRow[], retention: number, params: number[] | null): number {
  let load = 0;
  for (const c of cards) {
    if (c.deleted_at !== null || c.suspended || c.state === 0) continue;
    const s = c.stability > 0 ? c.stability : Math.max(0.5, c.interval_days);
    load += 1 / intervalFor(s, retention, params);
  }
  return load;
}

export { DAY };
