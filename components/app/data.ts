"use client";
// Ekranların ortak kullandığı canlı veri kancaları (IndexedDB değişince
// otomatik yenilenir — eşlemeden gelen değişiklikler dahil).
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import type { DeckConfigRow, DeckRow, NoteTypeRow } from "@/lib/db/types";
import { listTags } from "@/lib/browse/ops";
import { getSetting } from "@/lib/db/mutations";
import { buildDeckTree, flattenDeckTree } from "@/lib/decks";
import { defaultDeckConfigId } from "@/lib/notetypes/builtins";
import { type DeckOptions, resolveDeckOptions } from "@/lib/scheduler/config";
import { type DayInfo, getDayInfo } from "@/lib/scheduler/day";
import { DEFAULT_DAY_START_HOUR, DEFAULT_TIMEZONE } from "@/lib/config";
import { useApp } from "./AppProvider";
import { useNow } from "./hooks";

export function useDecks(): DeckRow[] | undefined {
  const { db } = useApp();
  return useLiveQuery(async () => (db ? (await db.decks.toArray()).filter((d) => d.deleted_at === null) : []), [db]);
}

/** Desteler, tam adlarıyla ve ağaç sırasıyla */
export function useDeckList() {
  const decks = useDecks();
  return useMemo(() => {
    if (!decks) return undefined;
    return flattenDeckTree(buildDeckTree(decks), true).map((n) => ({ id: n.deck.id, name: n.fullName, depth: n.depth }));
  }, [decks]);
}

export function useNoteTypes(): NoteTypeRow[] | undefined {
  const { db } = useApp();
  return useLiveQuery(
    async () =>
      db ? (await db.note_types.toArray()).filter((n) => n.deleted_at === null).sort((a, b) => a.name.localeCompare(b.name)) : [],
    [db],
  );
}

export function useDeckConfigs(): DeckConfigRow[] | undefined {
  const { db } = useApp();
  return useLiveQuery(async () => (db ? (await db.deck_configs.toArray()).filter((c) => c.deleted_at === null) : []), [db]);
}

export const DECK_LIMITS_SETTING = "deckLimits";
/** Deste başına sınır (ayar grubunun yerine geçer): deste id → { new, review } */
export type DeckLimits = Record<string, { new: number; review: number }>;

export function useDeckLimits(): DeckLimits | undefined {
  const { db } = useApp();
  return useLiveQuery(async () => (db ? getSetting<DeckLimits>(db, DECK_LIMITS_SETTING, {}) : {}), [db]);
}

/** Bir destenin ayarlarını çözen fonksiyon (desteye özel sınır varsa onu uygular) */
export function useOptionsResolver(decks: DeckRow[] | undefined): ((deckId: string) => DeckOptions) | undefined {
  const { db } = useApp();
  const configs = useDeckConfigs();
  const limits = useDeckLimits();
  return useMemo(() => {
    if (!decks || !configs || !db || !limits) return undefined;
    const byId = new Map(configs.map((c) => [c.id, c]));
    const deckById = new Map(decks.map((d) => [d.id, d]));
    const def = defaultDeckConfigId(db.userId);
    return (deckId: string) => {
      const o = resolveDeckOptions(deckById.get(deckId), byId, def);
      const own = limits[deckId];
      return own ? { ...o, newPerDay: own.new, reviewsPerDay: own.review } : o;
    };
  }, [decks, configs, db, limits]);
}

export interface StudySettings {
  dayStartHour: number;
  timeZone: string;
}

export function useStudySettings(): StudySettings {
  const { db } = useApp();
  return (
    useLiveQuery(
      async () =>
        db
          ? {
              dayStartHour: await getSetting(db, "dayStartHour", DEFAULT_DAY_START_HOUR),
              timeZone: await getSetting(db, "timeZone", DEFAULT_TIMEZONE),
            }
          : undefined,
      [db],
    ) ?? { dayStartHour: DEFAULT_DAY_START_HOUR, timeZone: DEFAULT_TIMEZONE }
  );
}

/** Bugünün sınırları (her 30 sn'de bir yenilenir; gün dönümünü yakalar) */
export function useDayInfo(): { day: DayInfo; now: number } {
  const settings = useStudySettings();
  const now = useNow(30_000);
  const day = useMemo(() => getDayInfo(now, settings.timeZone, settings.dayStartHour), [now, settings]);
  return { day, now };
}

/** Kullanılan etiketler (otomatik tamamlama için; silinmiş notlardakiler hariç) */
export function useAllTags(): string[] {
  const { db } = useApp();
  return (
    useLiveQuery(async () => (db ? listTags(await db.notes.toArray()).map((t) => t.name) : []), [db]) ?? []
  );
}
