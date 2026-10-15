// ÖZEL ÇALIŞMA (Anki'deki "Custom Study"):
//   - Bugünkü yeni / tekrar sınırını artır (sadece bugün geçerli, eşlenir)
//   - Unutulan kartlar, ileriyi tekrar et, yeni kartları önizle, etikete göre çalış
//     → "Özel çalışma oturumu" adlı filtreli desteye toplanır (her seferinde yeniden).
import type { LocalDB } from "@/lib/db/database";
import { getSetting, setSetting } from "@/lib/db/mutations";
import type { DeckRow } from "@/lib/db/types";
import { createFilteredDeck, type FilterConfig, updateFilteredDeck } from "@/lib/filtered";
import type { SearchData } from "@/lib/search/evaluate";
import { quoteSearchValue } from "@/lib/search/parser";

export const BOOSTS_SETTING = "studyBoosts";
export const CUSTOM_DECK_NAME = "Özel çalışma oturumu";

export interface Boosts {
  day: number;
  decks: Record<string, { new: number; review: number }>;
}

/** Bugünün sınır artışları (eski günün kaydı yok sayılır) */
export function boostsForToday(raw: Boosts | null, today: number): Map<string, { new: number; review: number }> {
  if (!raw || raw.day !== today) return new Map();
  return new Map(Object.entries(raw.decks ?? {}));
}

export async function increaseLimit(db: LocalDB, deckId: string, kind: "new" | "review", amount: number, today: number): Promise<void> {
  const raw = await getSetting<Boosts | null>(db, BOOSTS_SETTING, null);
  const decks = raw && raw.day === today ? { ...raw.decks } : {};
  const cur = decks[deckId] ?? { new: 0, review: 0 };
  decks[deckId] = { ...cur, [kind]: Math.max(0, cur[kind] + Math.round(amount)) };
  await setSetting(db, BOOSTS_SETTING, { day: today, decks });
}

export type CustomKind = "forgotten" | "ahead" | "previewNew" | "tag";

export interface CustomParams {
  kind: CustomKind;
  deckName: string;
  days?: number;
  tags?: string[];
  /** etikete göre: hangi kartlar */
  tagState?: "new" | "due" | "all";
  limit?: number;
}

/** Özel çalışma için filtre ayarı */
export function customFilter(p: CustomParams): FilterConfig {
  const deck = `deck:${quoteSearchValue(p.deckName)}`;
  const days = Math.max(1, Math.round(p.days ?? 1));
  switch (p.kind) {
    case "forgotten":
      return { search: `${deck} rated:${Math.min(days, 365)}:1`, limit: 9999, order: "random", reschedule: false, second: null };
    case "ahead":
      return { search: `${deck} is:review prop:due>0 prop:due<=${days}`, limit: 9999, order: "due", reschedule: true, second: null };
    case "previewNew":
      return { search: `${deck} is:new added:${days}`, limit: 9999, order: "added", reschedule: false, second: null };
    case "tag": {
      const tags = (p.tags ?? []).map((t) => `tag:${quoteSearchValue(t)}`);
      const tagPart = tags.length > 1 ? `(${tags.join(" or ")})` : (tags[0] ?? "");
      const state = p.tagState === "new" ? "is:new" : p.tagState === "due" ? "is:due" : "";
      return { search: [deck, tagPart, state].filter(Boolean).join(" "), limit: Math.max(1, p.limit ?? 100), order: "random", reschedule: true, second: null };
    }
  }
}

/** "Özel çalışma oturumu" destesini (varsa yeniden kullanarak) oluşturur ve doldurur */
export async function startCustomStudy(db: LocalDB, p: CustomParams, data: SearchData): Promise<{ deckId: string; count: number }> {
  const filter = customFilter(p);
  const existing = (await db.decks.toArray()).find((d: DeckRow) => d.deleted_at === null && d.is_filtered && d.name === CUSTOM_DECK_NAME);
  if (existing) {
    const count = await updateFilteredDeck(db, existing, CUSTOM_DECK_NAME, filter, data);
    return { deckId: existing.id, count };
  }
  const { deck, count } = await createFilteredDeck(db, CUSTOM_DECK_NAME, filter, data);
  return { deckId: deck.id, count };
}
