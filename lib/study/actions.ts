// ÇALIŞMA EYLEMLERİ: cevapla, göm, askıya al, bayrak, işaretle.
// Geri alma bunların içinde değil: çağıran taraf işlemi lib/undo.ts'teki
// undo.run(...) içinde çalıştırır, değişiklikler orada kaydedilir.
import type { LocalDB } from "@/lib/db/database";
import { insertRow, updateRow, updateRows } from "@/lib/db/mutations";
import type { CardRow, NoteExampleRow } from "@/lib/db/types";
import type { DeckOptions } from "@/lib/scheduler/config";
import { type Answer, answerCard, type ScheduleContext } from "@/lib/scheduler/fsrs";

export const MARKED_TAG = "marked";

const CARD_TABLES = (db: LocalDB) => [db.cards, db.review_logs, db.notes, db.outbox, db.sync_state];

export const LEECH_TAG = "leech";

export interface AnswerExtra {
  durationMs: number;
  exampleId?: string | null;
  /** Yük dengeleme ve gün sınırları */
  ctx?: ScheduleContext;
  /** Kardeş kartlar bu ana kadar gömülür (ertesi günün başı) */
  nextDayStart?: number;
  /** Kart filtreli destedeyse: cevaplar zamanlamayı değiştirsin mi */
  filteredReschedule?: boolean;
}

/**
 * Cevabı kaydeder: kartın zamanlaması güncellenir + cevap geçmişine eklenir.
 *  - Sülük: unutma sayısı eşiğe ulaşınca (ve sonra eşiğin yarısında bir) notu
 *    "leech" etiketiyle işaretler ya da kartı askıya alır.
 *  - Kardeş kartlar: ayarlara göre aynı notun diğer kartları yarına gömülür.
 *  - Filtreli deste: kart tekrar kartına dönünce (ya da yeniden zamanlama
 *    kapalıysa hemen) kendi destesine geri döner.
 */
export async function recordAnswer(
  db: LocalDB,
  card: CardRow,
  answer: Answer,
  opts: DeckOptions,
  extra: AnswerExtra,
): Promise<{ leech: boolean }> {
  const now = db.now();
  const inFiltered = card.original_deck_id !== null;
  const reschedule = !inFiltered || extra.filteredReschedule !== false;
  const { patch, log } = answerCard(card, answer, opts, now, { durationMs: extra.durationMs, filtered: inFiltered }, extra.ctx);
  let leech = false;
  return db.transaction("rw", CARD_TABLES(db), async () => {
    const update: Partial<CardRow> = reschedule ? { ...patch } : {};
    update.last_example_id = extra.exampleId ?? card.last_example_id;
    // Sülük kontrolü (sadece tekrar kartı unutulduğunda)
    if (reschedule && card.state === 2 && answer === 1) {
      const t = opts.leechThreshold;
      if (patch.lapses >= t && (patch.lapses - t) % Math.max(1, Math.ceil(t / 2)) === 0) {
        leech = true;
        if (opts.leechAction === "suspend") update.suspended = true;
        const note = await db.notes.get(card.note_id);
        if (note && !note.tags.some((x) => x.toLowerCase() === LEECH_TAG)) {
          await updateRow(db, "notes", note.id, { tags: [...note.tags, LEECH_TAG] });
        }
      }
    }
    // Filtreli desteden dönüş
    if (inFiltered && (!reschedule || patch.state === 2)) {
      update.deck_id = card.original_deck_id!;
      update.original_deck_id = null;
      update.original_due = null;
    }
    await updateRow(db, "cards", card.id, update);
    await insertRow(db, "review_logs", log);

    // Kardeş kartları göm
    const buryAny = opts.buryNewSiblings || opts.buryReviewSiblings || opts.buryInterdaySiblings;
    if (buryAny && extra.nextDayStart) {
      const siblings = (await db.cards.where("note_id").equals(card.note_id).toArray()).filter(
        (c) => c.id !== card.id && c.deleted_at === null && !c.suspended && !(c.buried_until && c.buried_until > now),
      );
      const toBury = siblings.filter(
        (c) =>
          (opts.buryNewSiblings && c.state === 0) ||
          (opts.buryReviewSiblings && c.state === 2 && c.due < extra.nextDayStart!) ||
          (opts.buryInterdaySiblings && (c.state === 1 || c.state === 3) && c.scheduled_days >= 1 && c.due < extra.nextDayStart!),
      );
      await updateRows(db, "cards", toBury.map((c) => ({ id: c.id, patch: { buried_until: extra.nextDayStart! } })));
    }
    return { leech };
  });
}

async function changeCards(db: LocalDB, cardIds: string[], change: (c: CardRow) => Partial<CardRow>): Promise<void> {
  const cards = (await db.cards.bulkGet(cardIds)).filter((c): c is CardRow => !!c && c.deleted_at === null);
  await updateRows(db, "cards", cards.map((c) => ({ id: c.id, patch: change(c) })));
}

/** Kartları verilen zamana kadar gömer (bugün gösterilmez) */
export function buryCards(db: LocalDB, cardIds: string[], until: number) {
  return changeCards(db, cardIds, () => ({ buried_until: until }));
}

/** Gömülü kartları geri getirir */
export function unburyCards(db: LocalDB, cardIds: string[]) {
  return changeCards(db, cardIds, () => ({ buried_until: null }));
}

export function setSuspended(db: LocalDB, cardIds: string[], suspended: boolean) {
  return changeCards(db, cardIds, () => ({ suspended }));
}

/** Bayrak: aynı bayrağa tekrar basılırsa kaldırılır (Anki'deki gibi) */
export function toggleFlag(db: LocalDB, cardIds: string[], flag: number) {
  return changeCards(db, cardIds, (c) => ({ flags: c.flags === flag ? 0 : flag }));
}

/** Bayrağı doğrudan ayarlar (toplu işlemler için; 0 = kaldır) */
export function setFlag(db: LocalDB, cardIds: string[], flag: number) {
  return changeCards(db, cardIds, () => ({ flags: flag }));
}

/** Notu işaretle / işareti kaldır ("marked" etiketi). İşaretlendiyse true döner. */
export async function toggleMark(db: LocalDB, noteId: string): Promise<boolean> {
  const note = await db.notes.get(noteId);
  if (!note) throw new Error("Not bulunamadı");
  const has = note.tags.some((t) => t.toLowerCase() === MARKED_TAG);
  const tags = has ? note.tags.filter((t) => t.toLowerCase() !== MARKED_TAG) : [...note.tags, MARKED_TAG];
  await updateRow(db, "notes", noteId, { tags });
  return !has;
}

/** Notun kartları (silinmemiş) — "notu göm / askıya al" için */
export async function noteCardIds(db: LocalDB, noteId: string): Promise<string[]> {
  return (await db.cards.where("note_id").equals(noteId).toArray()).filter((c) => c.deleted_at === null).map((c) => c.id);
}

/** {{Example}} için cümle seç: rastgele, mümkünse bir öncekinden farklı */
export function chooseExample(examples: NoteExampleRow[], lastId: string | null, rand = Math.random): string | null {
  if (!examples.length) return null;
  const pool = examples.length > 1 ? examples.filter((e) => e.id !== lastId) : examples;
  return pool[Math.floor(rand() * pool.length)].id;
}
