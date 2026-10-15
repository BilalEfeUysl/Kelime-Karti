// Deste yardımcıları: ağaç oluşturma, "Ana::Alt" yolundan deste oluşturma,
// alt desteleriyle birlikte silme. Desteler parent_id ile bağlanır;
// tam ad ("YDS::Fiiller") üst destelerden hesaplanır. Böylece bir üst deste
// yeniden adlandırılınca tek satır değişir (eşleme için daha az çakışma).
import type { LocalDB } from "@/lib/db/database";
import { insertRow, softDeleteRows, updateRow, updateRows } from "@/lib/db/mutations";
import { deleteNotes } from "@/lib/notes";
import type { DeckRow } from "@/lib/db/types";

export const DECK_SEPARATOR = "::";

export interface DeckNode {
  deck: DeckRow;
  fullName: string;
  depth: number;
  children: DeckNode[];
}

/** Silinmemiş destelerden ağaç kurar. Üstü silinmiş/bulunamayan deste en üste
 *  çıkar; iki cihazın çakışan taşımalarından doğabilecek döngüler kırılır. */
export function buildDeckTree(all: DeckRow[]): DeckNode[] {
  const alive = all.filter((d) => d.deleted_at === null);
  const byId = new Map(alive.map((d) => [d.id, d]));

  const effectiveParent = (deck: DeckRow): string | null => {
    const seen = new Set([deck.id]);
    let parentId = deck.parent_id;
    while (parentId) {
      if (seen.has(parentId)) return null; // döngü: en üste al
      const parent = byId.get(parentId);
      if (!parent) return null; // üst deste silinmiş
      seen.add(parentId);
      parentId = parent.parent_id;
    }
    return deck.parent_id && byId.has(deck.parent_id) ? deck.parent_id : null;
  };

  const childrenOf = new Map<string | null, DeckRow[]>();
  for (const d of alive) {
    const p = effectiveParent(d);
    childrenOf.set(p, [...(childrenOf.get(p) ?? []), d]);
  }

  const build = (parentId: string | null, prefix: string, depth: number): DeckNode[] =>
    (childrenOf.get(parentId) ?? [])
      .sort((a, b) => a.name.localeCompare(b.name, "tr"))
      .map((deck) => {
        const fullName = prefix ? `${prefix}${DECK_SEPARATOR}${deck.name}` : deck.name;
        return { deck, fullName, depth, children: build(deck.id, fullName, depth + 1) };
      });

  return build(null, "", 0);
}

/** Ağacı düz listeye çevirir (daraltılmış destelerin altları atlanır). */
export function flattenDeckTree(nodes: DeckNode[], includeCollapsed = false): DeckNode[] {
  const out: DeckNode[] = [];
  const walk = (list: DeckNode[]) => {
    for (const n of list) {
      out.push(n);
      if (includeCollapsed || !n.deck.collapsed) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function splitDeckPath(path: string): string[] {
  return path
    .split(DECK_SEPARATOR)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** "YDS::Fiiller::Phrasal" gibi bir yoldan desteyi bulur ya da eksik seviyeleri oluşturur. */
export async function createDeckPath(db: LocalDB, path: string): Promise<DeckRow> {
  const parts = splitDeckPath(path);
  if (parts.length === 0) throw new Error("Deste adı boş olamaz");
  // Tek transaction: aynı anda iki istek gelse bile (ör. çift tıklama) ikincisi
  // birincinin oluşturduğu desteyi görür, aynı deste iki kez oluşmaz.
  return db.transaction("rw", [db.decks, db.outbox, db.sync_state], async () => {
    const alive = (await db.decks.toArray()).filter((d) => d.deleted_at === null);
    let parentId: string | null = null;
    let current: DeckRow | undefined;
    for (const name of parts) {
      current = alive.find(
        (d) => d.parent_id === parentId && d.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"),
      );
      if (!current) {
        current = await insertRow(db, "decks", { name, parent_id: parentId });
        alive.push(current);
      }
      parentId = current.id;
    }
    return current!;
  });
}

export async function renameDeck(db: LocalDB, id: string, name: string) {
  const clean = name.trim();
  if (!clean) throw new Error("Deste adı boş olamaz");
  if (clean.includes(DECK_SEPARATOR)) throw new Error(`Ad "${DECK_SEPARATOR}" içeremez`);
  await updateRow(db, "decks", id, { name: clean });
}

/** Bir destenin ve tüm alt destelerinin kimlikleri */
export function subtreeIds(all: DeckRow[], id: string): string[] {
  const alive = all.filter((d) => d.deleted_at === null);
  const ids = [id];
  for (let i = 0; i < ids.length; i++) ids.push(...alive.filter((d) => d.parent_id === ids[i]).map((d) => d.id));
  return ids;
}

/** Desteyi, alt destelerini ve içlerindeki kartları siler (tombstone).
 *  Kartlarının hepsi silinen notlar da silinir (Anki'deki gibi). */
export async function deleteDeckTree(db: LocalDB, id: string): Promise<{ decks: number; cards: number }> {
  const ids = subtreeIds(await db.decks.toArray(), id);
  let cardCount = 0;
  await db.transaction("rw", [db.decks, db.notes, db.cards, db.note_examples, db.outbox, db.sync_state], async () => {
    const all = (await db.cards.where("deck_id").anyOf(ids).toArray()).filter((c) => c.deleted_at === null);
    const idSet = new Set(ids);
    // Filtreli destedeki kartlar kendi destesine döner (silinmez) — ev destesi de siliniyorsa silinir
    const returning = all.filter((c) => c.original_deck_id && !idSet.has(c.original_deck_id));
    await updateRows(db, "cards", returning.map((c) => ({ id: c.id, patch: { deck_id: c.original_deck_id!, original_deck_id: null, original_due: null } })));
    // Bu destelerden filtreli destelere ödünç verilmiş kartlar da silinir
    const lent = (await db.cards.toArray()).filter((c) => c.deleted_at === null && c.original_deck_id && idSet.has(c.original_deck_id) && !idSet.has(c.deck_id));
    const cards = [...all.filter((c) => !returning.includes(c)), ...lent];
    cardCount = cards.length;
    await softDeleteRows(db, "cards", cards.map((c) => c.id));
    const noteIds = [...new Set(cards.map((c) => c.note_id))];
    const orphaned: string[] = [];
    for (const noteId of noteIds) {
      const rest = (await db.cards.where("note_id").equals(noteId).toArray()).filter((c) => c.deleted_at === null);
      if (!rest.length) orphaned.push(noteId);
    }
    if (orphaned.length) await deleteNotes(db, orphaned);
    await softDeleteRows(db, "decks", ids);
  });
  return { decks: ids.length, cards: cardCount };
}

/** Desteyi başka bir destenin altına (ya da en üste: null) taşır */
export async function moveDeck(db: LocalDB, id: string, newParentId: string | null): Promise<void> {
  if (newParentId) {
    const all = await db.decks.toArray();
    if (subtreeIds(all, id).includes(newParentId)) throw new Error("Bir deste kendi alt destesinin içine taşınamaz.");
  }
  await updateRow(db, "decks", id, { parent_id: newParentId });
}
