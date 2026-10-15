// FİLTRELİ DESTELER: bir aramaya uyan kartları geçici olarak bir desteye toplar.
// Kartın asıl destesi original_deck_id'de saklanır; boşaltınca ya da kart
// çalışılınca (tekrar kartına dönünce) asıl destesine geri döner.
//   - "Cevaplarıma göre yeniden zamanla" kapalıysa çalışma sadece alıştırmadır:
//     kartın zamanlaması değişmez, cevaplanınca asıl destesine döner.
//   - İkinci filtre: ilk filtreden sonra kalan yere ikinci bir arama eklenir.
import type { LocalDB } from "@/lib/db/database";
import { insertRow, softDeleteRows, updateRow, updateRows } from "@/lib/db/mutations";
import type { CardRow, DeckRow } from "@/lib/db/types";
import { type SearchData, searchCards } from "@/lib/search/evaluate";

export type FilterOrder = "due" | "random" | "intervalAsc" | "intervalDesc" | "lapsesDesc" | "added" | "addedDesc" | "repsAsc";

export const FILTER_ORDERS: { value: FilterOrder; label: string }[] = [
  { value: "due", label: "Vadesi en eski önce" },
  { value: "random", label: "Rastgele" },
  { value: "intervalAsc", label: "Aralığı kısa olan önce" },
  { value: "intervalDesc", label: "Aralığı uzun olan önce" },
  { value: "lapsesDesc", label: "En çok unutulan önce" },
  { value: "added", label: "İlk eklenen önce" },
  { value: "addedDesc", label: "Son eklenen önce" },
  { value: "repsAsc", label: "En az tekrar edilen önce" },
];

export interface FilterTerm {
  search: string;
  limit: number;
  order: FilterOrder;
}

export interface FilterConfig extends FilterTerm {
  reschedule: boolean;
  second: FilterTerm | null;
}

export function filterOf(deck: DeckRow): FilterConfig {
  const f = (deck.filter ?? {}) as Partial<FilterConfig>;
  return {
    search: f.search ?? "",
    limit: f.limit ?? 100,
    order: f.order ?? "due",
    reschedule: f.reschedule !== false,
    second: f.second ?? null,
  };
}

function hash(id: string, salt: number): number {
  let h = salt | 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h ^ id.charCodeAt(i), 2654435761) >>> 0) | 0;
  return (h >>> 0) / 4294967296;
}

/** Sıralama anahtarı (küçük önce) */
export function filteredSortKey(c: CardRow, order: FilterOrder, salt: number): number {
  switch (order) {
    case "random":
      return hash(c.id, salt);
    case "intervalAsc":
      return c.interval_days;
    case "intervalDesc":
      return -c.interval_days;
    case "lapsesDesc":
      return -c.lapses;
    case "added":
      return c.created_at;
    case "addedDesc":
      return -c.created_at;
    case "repsAsc":
      return c.reps;
    default:
      return c.state === 0 ? 1e15 + c.position : c.due;
  }
}

/** Filtreli destedeki kartları asıl destelerine döndürür */
export async function emptyFilteredDeck(db: LocalDB, deckId: string): Promise<number> {
  const cards = (await db.cards.where("deck_id").equals(deckId).toArray()).filter((c) => c.deleted_at === null && c.original_deck_id);
  await updateRows(db, "cards", cards.map((c) => ({ id: c.id, patch: { deck_id: c.original_deck_id!, original_deck_id: null, original_due: null } })));
  return cards.length;
}

/** Aramaya uyan kartları filtreli desteye toplar (önce boşaltır). Toplanan sayısını döndürür. */
export async function buildFilteredDeck(db: LocalDB, deck: DeckRow, data: SearchData): Promise<number> {
  await emptyFilteredDeck(db, deck.id);
  const cards = await db.cards.toArray();
  const decks = await db.decks.toArray();
  const filteredIds = new Set(decks.filter((d) => d.is_filtered).map((d) => d.id));
  const fresh: SearchData = { ...data, cards, decks };
  const f = filterOf(deck);
  const salt = data.day.today;
  const taken = new Set<string>();
  const pick = (term: FilterTerm) => {
    if (!term.search.trim() || term.limit <= 0) return [];
    const found = searchCards(term.search, fresh).filter(
      (c) => !c.suspended && !(c.buried_until && c.buried_until > data.now) && !c.original_deck_id && !filteredIds.has(c.deck_id) && !taken.has(c.id),
    );
    const chosen = found.sort((a, b) => filteredSortKey(a, term.order, salt) - filteredSortKey(b, term.order, salt)).slice(0, term.limit);
    chosen.forEach((c) => taken.add(c.id));
    return chosen;
  };
  const chosen = [...pick(f), ...(f.second ? pick(f.second) : [])];
  await updateRows(db, "cards", chosen.map((c) => ({ id: c.id, patch: { original_deck_id: c.deck_id, deck_id: deck.id, original_due: c.due } })));
  return chosen.length;
}

/** Yeni filtreli deste oluşturur ve doldurur */
export async function createFilteredDeck(db: LocalDB, name: string, filter: FilterConfig, data: SearchData): Promise<{ deck: DeckRow; count: number }> {
  const clean = name.trim();
  if (!clean) throw new Error("Deste adı boş olamaz.");
  if (!filter.search.trim()) throw new Error("Arama boş olamaz.");
  const deck = await insertRow(db, "decks", { name: clean, parent_id: null, is_filtered: true, filter: { ...filter } });
  const count = await buildFilteredDeck(db, deck, data);
  return { deck, count };
}

/** Filtreli destenin ayarlarını kaydeder ve yeniden oluşturur */
export async function updateFilteredDeck(db: LocalDB, deck: DeckRow, name: string, filter: FilterConfig, data: SearchData): Promise<number> {
  const updated = (await updateRow(db, "decks", deck.id, { name: name.trim() || deck.name, filter: { ...filter } }))!;
  return buildFilteredDeck(db, updated, data);
}

/** Filtreli desteyi siler (kartlar asıl destelerine döner) */
export async function deleteFilteredDeck(db: LocalDB, deckId: string): Promise<void> {
  await emptyFilteredDeck(db, deckId);
  await softDeleteRows(db, "decks", [deckId]);
}
