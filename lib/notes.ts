// NOT İŞLEMLERİ: not ekle (kartlarıyla birlikte), düzenle, örnek cümleleri
// kaydet, sil. Hepsi yerel veritabanına yazar; eşleme arka planda olur.
import { cardOrdsForNote } from "@/lib/cards/generate";
import type { LocalDB } from "@/lib/db/database";
import { insertRows, newId, softDeleteRows, updateRow } from "@/lib/db/mutations";
import type { CardRow, NoteExampleRow, NoteRow, NoteTypeRow } from "@/lib/db/types";
import { newGuid, normalizeTags, stripHtml } from "@/lib/text";

export interface ExampleDraft {
  id?: string;
  text: string;
  translation: string | null;
}

const NOTE_TABLES = (db: LocalDB) => [db.notes, db.cards, db.note_examples, db.outbox, db.sync_state];

export function sortFieldText(noteType: Pick<NoteTypeRow, "fields" | "sort_field">, fields: Record<string, string>): string {
  const id = noteType.sort_field ?? noteType.fields[0]?.id;
  return id ? stripHtml(fields[id] ?? "").slice(0, 200) : "";
}

/** Yeni kartların sırası: eklenme zamanı (saniye). İçe aktarılan destelerin
 *  küçük sıra numaraları bunların önüne düşer. */
export function nextNewPosition(now: number): number {
  return Math.floor(now / 1000);
}

export async function addNote(
  db: LocalDB,
  input: {
    noteType: NoteTypeRow;
    deckId: string;
    fields: Record<string, string>;
    tags?: string[];
    examples?: ExampleDraft[];
  },
): Promise<{ note: NoteRow; cards: CardRow[] }> {
  const { noteType, deckId } = input;
  const ords = cardOrdsForNote(noteType, input.fields);
  if (ords.length === 0) {
    throw new Error(
      noteType.kind === "image_occlusion"
        ? "Resmin üzerine en az bir maske çiz."
        : "Bu notla hiç kart oluşmuyor: kartın ön yüzünde gösterilecek alan boş.",
    );
  }
  return db.transaction("rw", NOTE_TABLES(db), async () => {
    const [note] = await insertRows(db, "notes", [
      {
        note_type_id: noteType.id,
        guid: newGuid(),
        fields: input.fields,
        tags: normalizeTags(input.tags ?? []),
        sort_field: sortFieldText(noteType, input.fields),
      },
    ]);
    const position = nextNewPosition(db.now());
    const cards = await insertRows(
      db,
      "cards",
      ords.map((ord) => ({ note_id: note.id, deck_id: deckId, ord, position })),
    );
    await saveExamples(db, note.id, input.examples ?? []);
    return { note, cards };
  });
}

/** Notun alanlarını/etiketlerini günceller; yeni dolan şablonlar için kart üretir. */
export async function updateNote(
  db: LocalDB,
  noteId: string,
  changes: { fields?: Record<string, string>; tags?: string[] },
): Promise<{ newCards: number }> {
  return db.transaction("rw", [...NOTE_TABLES(db), db.note_types], async () => {
    const note = await db.notes.get(noteId);
    if (!note) throw new Error("Not bulunamadı");
    const noteType = await db.note_types.get(note.note_type_id);
    if (!noteType) throw new Error("Not tipi bulunamadı");
    const fields = changes.fields ?? note.fields;
    await updateRow(db, "notes", noteId, {
      fields,
      tags: changes.tags ? normalizeTags(changes.tags) : note.tags,
      sort_field: sortFieldText(noteType, fields),
    });
    const existing = (await db.cards.where("note_id").equals(noteId).toArray()).filter((c) => c.deleted_at === null);
    const have = new Set(existing.map((c) => c.ord));
    const missing = cardOrdsForNote(noteType, fields).filter((o) => !have.has(o));
    if (missing.length && existing.length) {
      const deckId = existing[0].deck_id;
      const position = nextNewPosition(db.now());
      await insertRows(db, "cards", missing.map((ord) => ({ note_id: noteId, deck_id: deckId, ord, position })));
    }
    return { newCards: missing.length };
  });
}

/** Örnek cümleleri kaydeder: değişenleri günceller, yenileri ekler, çıkarılanları siler. */
export async function saveExamples(db: LocalDB, noteId: string, drafts: ExampleDraft[]): Promise<void> {
  await db.transaction("rw", [db.note_examples, db.outbox, db.sync_state], async () => {
    const current = (await db.note_examples.where("note_id").equals(noteId).toArray()).filter((e) => e.deleted_at === null);
    const byId = new Map(current.map((e) => [e.id, e]));
    const keep = new Set<string>();
    const toInsert: Partial<NoteExampleRow>[] = [];
    for (const [i, d] of drafts.entries()) {
      const text = d.text.trim();
      if (!text) continue;
      const translation = d.translation?.trim() || null;
      const old = d.id ? byId.get(d.id) : undefined;
      if (old) {
        keep.add(old.id);
        if (old.text !== text || old.translation !== translation || old.position !== i) {
          await updateRow(db, "note_examples", old.id, { text, translation, position: i });
        }
      } else {
        toInsert.push({ note_id: noteId, text, translation, source: "user", approved: true, position: i });
      }
    }
    if (toInsert.length) await insertRows(db, "note_examples", toInsert);
    const removed = current.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (removed.length) await softDeleteRows(db, "note_examples", removed);
  });
}

/** Notları, kartlarını ve örnek cümlelerini siler (tombstone). */
export async function deleteNotes(db: LocalDB, noteIds: string[]): Promise<void> {
  await db.transaction("rw", NOTE_TABLES(db), async () => {
    for (const noteId of noteIds) {
      const cards = await db.cards.where("note_id").equals(noteId).toArray();
      const examples = await db.note_examples.where("note_id").equals(noteId).toArray();
      await softDeleteRows(db, "cards", cards.filter((c) => c.deleted_at === null).map((c) => c.id));
      await softDeleteRows(db, "note_examples", examples.filter((e) => e.deleted_at === null).map((e) => e.id));
    }
    await softDeleteRows(db, "notes", noteIds);
  });
}

/** Bir notun gösterilecek (onaylı, silinmemiş) örnek cümleleri, sırasıyla */
export async function approvedExamples(db: LocalDB, noteId: string): Promise<NoteExampleRow[]> {
  const rows = await db.note_examples.where("note_id").equals(noteId).toArray();
  return rows.filter((e) => e.deleted_at === null && e.approved).sort((a, b) => a.position - b.position);
}

export function newExampleId(): string {
  return newId();
}
