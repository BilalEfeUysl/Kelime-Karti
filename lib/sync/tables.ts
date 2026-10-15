// Eşlenen tabloların listesi ve çakışma kuralları için ortak tanımlar.
// Sunucudaki SQL (supabase/migrations) ile AYNI olmalıdır.
import type { CardRow, TableRowMap } from "@/lib/db/types";

export type SyncTable = keyof TableRowMap;

/** Gönderim sırası: önce "üst" kayıtlar (deste ayarı → deste → not tipi → not → kart ...) */
export const SYNC_TABLES: readonly SyncTable[] = [
  "deck_configs",
  "decks",
  "note_types",
  "notes",
  "note_examples",
  "cards",
  "review_logs",
  "media",
  "app_settings",
] as const;

/** Sadece eklenen, asla değiştirilmeyen tablolar */
export const APPEND_ONLY_TABLES: ReadonlySet<SyncTable> = new Set<SyncTable>(["review_logs"]);

/** Kartların zamanlama grubu: "son tekrarı daha yeni olan kazanır"
 *  (sched_updated_at ile karşılaştırılır). Geri kalan alanlar updated_at ile. */
export const CARD_SCHED_FIELDS = [
  "state",
  "step",
  "due",
  "stability",
  "difficulty",
  "elapsed_days",
  "scheduled_days",
  "reps",
  "lapses",
  "last_review",
  "ease",
  "interval_days",
  "last_example_id",
] as const satisfies readonly (keyof CardRow)[];

const CARD_SCHED_SET: ReadonlySet<string> = new Set<string>(CARD_SCHED_FIELDS);

export function isCardSchedField(field: string): boolean {
  return CARD_SCHED_SET.has(field);
}

export function isSyncTable(name: string): name is SyncTable {
  return (SYNC_TABLES as readonly string[]).includes(name);
}
