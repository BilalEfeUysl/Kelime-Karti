// Arama için cihazdaki verileri tek seferde okur (filtreli deste, özel çalışma için)
import type { LocalDB } from "@/lib/db/database";
import type { DayInfo } from "@/lib/scheduler/day";
import type { SearchData } from "./evaluate";

export async function loadSearchData(db: LocalDB, day: DayInfo, now: number): Promise<SearchData> {
  const [cards, notes, noteTypes, decks, examples, logs] = await Promise.all([
    db.cards.toArray(),
    db.notes.toArray(),
    db.note_types.toArray(),
    db.decks.toArray(),
    db.note_examples.toArray(),
    db.review_logs.toArray(),
  ]);
  const exampleCounts = new Map<string, number>();
  for (const e of examples) if (e.deleted_at === null && e.approved) exampleCounts.set(e.note_id, (exampleCounts.get(e.note_id) ?? 0) + 1);
  return {
    cards,
    notes,
    noteTypes: noteTypes.filter((t) => t.deleted_at === null),
    decks: decks.filter((d) => d.deleted_at === null),
    exampleCounts,
    logs,
    now,
    day,
  };
}
