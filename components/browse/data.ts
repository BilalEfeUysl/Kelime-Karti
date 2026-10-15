"use client";
// KART TARAYICI VERİSİ: cihazdaki her şeyi okur, aramayı uygular, satırları
// (kart ya da not modunda) üretir ve sıralar.
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useDayInfo } from "@/components/app/data";
import type { CardRow, DeckRow, NoteRow, NoteTypeRow } from "@/lib/db/types";
import { buildDeckTree, flattenDeckTree } from "@/lib/decks";
import type { DayInfo } from "@/lib/scheduler/day";
import { needsLogs, type SearchData, searchCards } from "@/lib/search/evaluate";
import { parseSearch, SearchError, type SearchNode } from "@/lib/search/parser";

export type BrowseMode = "cards" | "notes";

export interface BrowseRow {
  /** Kart modunda kart id, not modunda not id */
  id: string;
  card: CardRow; // not modunda: notun ilk kartı
  cards: CardRow[]; // not modunda: notun (aramaya uyan) tüm kartları
  note: NoteRow;
  noteType: NoteTypeRow | undefined;
  deckName: string;
  examples: number;
}

export interface BrowseBase {
  cards: CardRow[];
  notes: NoteRow[];
  noteTypes: NoteTypeRow[];
  decks: DeckRow[];
  exampleCounts: Map<string, number>;
  deckNames: Map<string, string>;
}

/** Cihazdaki tüm veri (değişince otomatik yenilenir) */
export function useBrowseBase(): BrowseBase | undefined {
  const { db } = useApp();
  return useLiveQuery(async () => {
    if (!db) return undefined;
    const [cards, notes, noteTypes, decks, examples] = await Promise.all([
      db.cards.toArray(),
      db.notes.toArray(),
      db.note_types.toArray(),
      db.decks.toArray(),
      db.note_examples.toArray(),
    ]);
    const exampleCounts = new Map<string, number>();
    for (const e of examples) if (e.deleted_at === null && e.approved) exampleCounts.set(e.note_id, (exampleCounts.get(e.note_id) ?? 0) + 1);
    const deckNames = new Map<string, string>();
    for (const n of flattenDeckTree(buildDeckTree(decks), true)) deckNames.set(n.deck.id, n.fullName);
    return {
      cards,
      notes,
      noteTypes: noteTypes.filter((t) => t.deleted_at === null),
      decks: decks.filter((d) => d.deleted_at === null),
      exampleCounts,
      deckNames,
    };
  }, [db]);
}

/** Arama sadece rated:/introduced: içeriyorsa cevap geçmişini yükler */
function useLogsIfNeeded(ast: SearchNode | null) {
  const { db } = useApp();
  const need = ast ? needsLogs(ast) : false;
  return useLiveQuery(async () => (db && need ? db.review_logs.toArray() : []), [db, need]);
}

export interface BrowseResult {
  rows: BrowseRow[];
  error: string | null;
  loading: boolean;
}

export function useBrowseRows(base: BrowseBase | undefined, query: string, mode: BrowseMode, sort: SortState): BrowseResult {
  const { day, now } = useDayInfo();
  const parsed = useMemo((): { ast: SearchNode | null; error: string | null } => {
    try {
      return { ast: parseSearch(query), error: null };
    } catch (err) {
      return { ast: null, error: err instanceof SearchError ? err.message : String(err) };
    }
  }, [query]);
  const logs = useLogsIfNeeded(parsed.ast);

  return useMemo(() => {
    if (!base || !logs) return { rows: [], error: parsed.error, loading: true };
    if (!parsed.ast) return { rows: [], error: parsed.error, loading: false };
    let cards: CardRow[];
    try {
      const data: SearchData = { ...base, logs, now, day };
      cards = searchCards(parsed.ast, data);
    } catch (err) {
      return { rows: [], error: err instanceof SearchError ? err.message : String(err), loading: false };
    }
    const noteById = new Map(base.notes.map((n) => [n.id, n]));
    const typeById = new Map(base.noteTypes.map((t) => [t.id, t]));
    const make = (id: string, list: CardRow[]): BrowseRow => {
      const card = list[0];
      const note = noteById.get(card.note_id)!;
      return {
        id,
        card,
        cards: list,
        note,
        noteType: typeById.get(note.note_type_id),
        deckName: base.deckNames.get(card.deck_id) ?? "?",
        examples: base.exampleCounts.get(note.id) ?? 0,
      };
    };
    let rows: BrowseRow[];
    if (mode === "cards") {
      rows = cards.map((c) => make(c.id, [c]));
    } else {
      const byNote = new Map<string, CardRow[]>();
      for (const c of cards) byNote.set(c.note_id, [...(byNote.get(c.note_id) ?? []), c]);
      rows = [...byNote].map(([noteId, list]) => make(noteId, list.sort((a, b) => a.ord - b.ord)));
    }
    sortRows(rows, sort, mode, day);
    return { rows, error: null, loading: false };
  }, [base, logs, parsed, mode, sort, now, day]);
}

// ------------------------------------------------------------------ sütunlar

export type ColumnId =
  | "sortField"
  | "question"
  | "answer"
  | "deck"
  | "due"
  | "interval"
  | "difficulty"
  | "reps"
  | "lapses"
  | "created"
  | "modified"
  | "tags"
  | "noteType"
  | "examples"
  | "cardCount";

export interface ColumnDef {
  id: ColumnId;
  label: string;
  /** Sıralanabilir mi (soru/cevap sıralanamaz, Anki'deki gibi) */
  sortable: boolean;
  width: string; // CSS grid kolonu
  numeric?: boolean;
}

export const COLUMNS: ColumnDef[] = [
  { id: "sortField", label: "Kelime", sortable: true, width: "minmax(140px,2fr)" },
  { id: "question", label: "Soru", sortable: false, width: "minmax(140px,2fr)" },
  { id: "answer", label: "Cevap", sortable: false, width: "minmax(140px,2fr)" },
  { id: "deck", label: "Deste", sortable: true, width: "minmax(100px,1.2fr)" },
  { id: "due", label: "Zamanı", sortable: true, width: "minmax(90px,0.9fr)" },
  { id: "interval", label: "Aralık", sortable: true, width: "minmax(64px,0.6fr)", numeric: true },
  { id: "difficulty", label: "Zorluk", sortable: true, width: "minmax(64px,0.6fr)", numeric: true },
  { id: "reps", label: "Tekrar", sortable: true, width: "minmax(56px,0.5fr)", numeric: true },
  { id: "lapses", label: "Hata", sortable: true, width: "minmax(52px,0.5fr)", numeric: true },
  { id: "created", label: "Eklenme", sortable: true, width: "minmax(86px,0.8fr)" },
  { id: "modified", label: "Düzenlenme", sortable: true, width: "minmax(86px,0.8fr)" },
  { id: "tags", label: "Etiketler", sortable: true, width: "minmax(100px,1.2fr)" },
  { id: "noteType", label: "Not tipi", sortable: true, width: "minmax(100px,1fr)" },
  { id: "examples", label: "Örnek", sortable: true, width: "minmax(56px,0.5fr)", numeric: true },
  { id: "cardCount", label: "Kart", sortable: true, width: "minmax(48px,0.4fr)", numeric: true },
];

export const DEFAULT_COLUMNS: Record<BrowseMode, ColumnId[]> = {
  cards: ["sortField", "answer", "deck", "due", "interval", "tags"],
  notes: ["sortField", "noteType", "cardCount", "tags", "examples", "created"],
};

export interface SortState {
  column: ColumnId;
  desc: boolean;
}

const DAY = 86_400_000;

function hlcWall(hlc: string): number {
  return Number(hlc.slice(0, 15)) || 0;
}

/** Sıralama için sayısal/metin anahtar */
function sortKey(row: BrowseRow, col: ColumnId, mode: BrowseMode): number | string {
  const cards = mode === "notes" ? row.cards : [row.card];
  switch (col) {
    case "sortField":
      return row.note.sort_field.toLocaleLowerCase("tr");
    case "deck":
      return row.deckName.toLocaleLowerCase("tr");
    case "due": {
      // Yeni kartlar sıra numarasıyla en sona; askıdakiler daha da sona
      const c = cards.reduce((a, b) => (dueKey(b) < dueKey(a) ? b : a));
      return dueKey(c);
    }
    case "interval":
      return Math.max(...cards.map((c) => (c.state === 0 ? -1 : c.interval_days)));
    case "difficulty":
      return Math.max(...cards.map((c) => (c.state === 0 ? -1 : c.difficulty)));
    case "reps":
      return cards.reduce((s, c) => s + c.reps, 0);
    case "lapses":
      return cards.reduce((s, c) => s + c.lapses, 0);
    case "created":
      return mode === "notes" ? row.note.created_at : row.card.created_at;
    case "modified":
      return hlcWall(mode === "notes" ? row.note.updated_at : row.card.updated_at > row.note.updated_at ? row.card.updated_at : row.note.updated_at);
    case "tags":
      return row.note.tags.join(" ").toLocaleLowerCase("tr");
    case "noteType":
      return (row.noteType?.name ?? "").toLocaleLowerCase("tr");
    case "examples":
      return row.examples;
    case "cardCount":
      return row.cards.length;
    default:
      return 0;
  }
}

function dueKey(c: CardRow): number {
  if (c.suspended) return 4e15 + c.due;
  if (c.state === 0) return 3e15 + c.position;
  return c.due;
}

export function sortRows(rows: BrowseRow[], sort: SortState, mode: BrowseMode, _day: DayInfo) {
  void _day;
  const col = COLUMNS.find((c) => c.id === sort.column)?.sortable ? sort.column : "sortField";
  const keys = new Map(rows.map((r) => [r.id, sortKey(r, col, mode)]));
  const dir = sort.desc ? -1 : 1;
  rows.sort((a, b) => {
    const ka = keys.get(a.id)!;
    const kb = keys.get(b.id)!;
    const cmp = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb), "tr");
    return cmp * dir || a.note.sort_field.localeCompare(b.note.sort_field, "tr") || a.card.ord - b.card.ord;
  });
}

// --------------------------------------------------------------- biçimleme

const dateFmt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });

export function formatDate(ms: number): string {
  return ms ? dateFmt.format(ms) : "—";
}

/** "Zamanı" sütunu: yeni → "Yeni #12", öğrenme (bugün) → "14:30", tekrar → tarih */
export function formatDue(c: CardRow, day: DayInfo): string {
  let text: string;
  // Eklenme zamanından gelen büyük sıra numaraları gösterilmez
  if (c.state === 0) text = c.position < 1e6 ? `Yeni #${c.position}` : "Yeni";
  else if (c.due >= day.dayStart && c.due < day.nextDayStart && c.scheduled_days < 1) text = timeFmt.format(c.due);
  else text = formatDate(c.due);
  if (c.suspended) return `(${text})`;
  if (c.buried_until && c.buried_until > Date.now()) return `[${text}]`;
  return text;
}

export function formatIvl(days: number): string {
  if (days < 1) return "—";
  if (days < 30) return `${Math.round(days)} g`;
  if (days < 365) return `${(days / 30).toFixed(1).replace(".", ",")} ay`;
  return `${(days / 365).toFixed(1).replace(".", ",")} y`;
}

export { DAY, hlcWall };
