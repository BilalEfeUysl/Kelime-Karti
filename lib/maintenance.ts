// BAKIM ARAÇLARI: veritabanı kontrolü, boş kartlar, kullanılmayan resimler,
// eski silinmiş kayıtların temizliği. Hepsi önce rapor verir, onaylanınca düzeltir.
import { cardOrdsForNote } from "@/lib/cards/generate";
import type { LocalDB } from "@/lib/db/database";
import { softDeleteRows, updateRows } from "@/lib/db/mutations";
import type { CardRow, MediaRow, NoteRow } from "@/lib/db/types";
import { deleteNotes, nextNewPosition } from "@/lib/notes";
import { defaultDeckId } from "@/lib/notetypes/builtins";
import { insertRows } from "@/lib/db/mutations";

export interface CheckReport {
  orphanCards: CardRow[]; // notu yok/silinmiş
  lostDeckCards: CardRow[]; // destesi yok/silinmiş
  badOrdCards: CardRow[]; // şablonu olmayan sıra
  duplicateCards: CardRow[]; // aynı not + aynı sıra (fazlalar)
  typelessNotes: NoteRow[]; // not tipi yok/silinmiş
  cardlessNotes: NoteRow[]; // hiç kartı olmayan notlar
  orphanExamples: number; // notu silinmiş örnek cümleler
}

export function issueCount(r: CheckReport): number {
  return (
    r.orphanCards.length + r.lostDeckCards.length + r.badOrdCards.length + r.duplicateCards.length + r.typelessNotes.length + r.cardlessNotes.length + r.orphanExamples
  );
}

export async function checkDatabase(db: LocalDB): Promise<CheckReport> {
  const [cards, notes, types, decks, examples] = await Promise.all([
    db.cards.toArray(),
    db.notes.toArray(),
    db.note_types.toArray(),
    db.decks.toArray(),
    db.note_examples.toArray(),
  ]);
  const liveNotes = new Map(notes.filter((n) => n.deleted_at === null).map((n) => [n.id, n]));
  const liveTypes = new Map(types.filter((t) => t.deleted_at === null).map((t) => [t.id, t]));
  const liveDecks = new Map(decks.filter((d) => d.deleted_at === null).map((d) => [d.id, d]));
  const live = cards.filter((c) => c.deleted_at === null);

  const orphanCards = live.filter((c) => !liveNotes.has(c.note_id));
  const lostDeckCards = live.filter((c) => liveNotes.has(c.note_id) && (!liveDecks.has(c.deck_id) || (c.original_deck_id !== null && !liveDecks.has(c.original_deck_id))));
  const badOrdCards = live.filter((c) => {
    const n = liveNotes.get(c.note_id);
    const t = n && liveTypes.get(n.note_type_id);
    return !!t && t.kind === "standard" && c.ord >= t.templates.length;
  });
  const seen = new Map<string, CardRow>();
  const duplicateCards: CardRow[] = [];
  for (const c of [...live].sort((a, b) => b.reps - a.reps)) {
    if (!liveNotes.has(c.note_id)) continue;
    const key = `${c.note_id}:${c.ord}`;
    if (seen.has(key)) duplicateCards.push(c);
    else seen.set(key, c);
  }
  const typelessNotes = [...liveNotes.values()].filter((n) => !liveTypes.has(n.note_type_id));
  const withCards = new Set(live.map((c) => c.note_id));
  const cardlessNotes = [...liveNotes.values()].filter((n) => liveTypes.has(n.note_type_id) && !withCards.has(n.id));
  const orphanExamples = examples.filter((e) => e.deleted_at === null && !liveNotes.has(e.note_id)).length;
  return { orphanCards, lostDeckCards, badOrdCards, duplicateCards, typelessNotes, cardlessNotes, orphanExamples };
}

/** Raporu düzeltir. Kartsız notlara kart üretilir; üretilemiyorsa not silinir. */
export async function fixDatabase(db: LocalDB, r: CheckReport): Promise<void> {
  const def = defaultDeckId(db.userId);
  await softDeleteRows(db, "cards", [...r.orphanCards, ...r.badOrdCards, ...r.duplicateCards].map((c) => c.id));
  await updateRows(db, "cards", r.lostDeckCards.map((c) => ({ id: c.id, patch: { deck_id: def, original_deck_id: null, original_due: null } })));
  if (r.typelessNotes.length) await deleteNotes(db, r.typelessNotes.map((n) => n.id));
  if (r.orphanExamples) {
    const notes = new Set((await db.notes.toArray()).filter((n) => n.deleted_at === null).map((n) => n.id));
    const ex = (await db.note_examples.toArray()).filter((e) => e.deleted_at === null && !notes.has(e.note_id));
    await softDeleteRows(db, "note_examples", ex.map((e) => e.id));
  }
  const types = new Map((await db.note_types.toArray()).map((t) => [t.id, t]));
  const position = nextNewPosition(db.now());
  const fresh: Partial<CardRow>[] = [];
  const unusable: string[] = [];
  for (const n of r.cardlessNotes) {
    const ords = cardOrdsForNote(types.get(n.note_type_id)!, n.fields);
    if (!ords.length) unusable.push(n.id);
    for (const ord of ords) fresh.push({ note_id: n.id, deck_id: def, ord, position });
  }
  if (fresh.length) await insertRows(db, "cards", fresh);
  if (unusable.length) await deleteNotes(db, unusable);
}

/** Boş kartlar: şablonun ön yüzü artık boş kalan (ya da cloze numarası kalmayan) kartlar */
export async function findEmptyCards(db: LocalDB): Promise<{ card: CardRow; note: NoteRow }[]> {
  const [cards, notes, types] = await Promise.all([db.cards.toArray(), db.notes.toArray(), db.note_types.toArray()]);
  const noteById = new Map(notes.filter((n) => n.deleted_at === null).map((n) => [n.id, n]));
  const typeById = new Map(types.filter((t) => t.deleted_at === null).map((t) => [t.id, t]));
  const ordsCache = new Map<string, Set<number>>();
  const out: { card: CardRow; note: NoteRow }[] = [];
  for (const c of cards) {
    if (c.deleted_at !== null) continue;
    const n = noteById.get(c.note_id);
    const t = n && typeById.get(n.note_type_id);
    if (!n || !t) continue;
    let ords = ordsCache.get(n.id);
    if (!ords) {
      ords = new Set(cardOrdsForNote(t, n.fields));
      ordsCache.set(n.id, ords);
    }
    if (!ords.has(c.ord)) out.push({ card: c, note: n });
  }
  return out;
}

/** Hiçbir notta geçmeyen resimler */
export async function findUnusedMedia(db: LocalDB): Promise<MediaRow[]> {
  const notes = (await db.notes.toArray()).filter((n) => n.deleted_at === null);
  const used = new Set<string>();
  for (const n of notes) for (const v of Object.values(n.fields)) for (const m of v.matchAll(/kk-media\/([a-f0-9]{64})\./gi)) used.add(m[1].toLowerCase());
  return (await db.media.toArray()).filter((m) => m.deleted_at === null && !used.has(m.hash.toLowerCase()));
}

/** Kullanılmayan resimleri siler: kayıt (eşlenir) + cihazdaki içerik. Sunucudaki dosya yolları döner. */
export async function deleteUnusedMedia(db: LocalDB, media: MediaRow[]): Promise<string[]> {
  await softDeleteRows(db, "media", media.map((m) => m.id));
  await db.media_blobs.bulkDelete(media.map((m) => m.hash));
  return media.filter((m) => m.uploaded_at && m.storage_path).map((m) => m.storage_path!);
}

/**
 * Cihazdaki eski silinmiş kayıtları temizler (sadece zaten sunucuya gönderilmiş
 * olanlar). Sunucudaki karşılıkları ayrıca purge_tombstones ile silinir.
 */
export async function purgeLocalTombstones(db: LocalDB, olderThanDays: number): Promise<number> {
  const cutoff = db.now() - olderThanDays * 86_400_000;
  const pending = new Set((await db.outbox.toArray()).map((o) => o.key));
  let total = 0;
  for (const t of ["note_examples", "cards", "notes", "note_types", "decks", "deck_configs", "media", "app_settings"] as const) {
    const rows = (await db.syncTable(t).toArray()).filter((r) => r.deleted_at !== null && r.deleted_at < cutoff && !pending.has(`${t}:${r.id}`));
    if (rows.length) await db.syncTable(t).bulkDelete(rows.map((r) => r.id));
    total += rows.length;
  }
  return total;
}
