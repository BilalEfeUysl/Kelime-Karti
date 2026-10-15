// KART TARAYICI TOPLU İŞLEMLERİ
// Hepsi yerel veritabanına yazar (eşleme arka planda olur). Arayüz bunları
// undo.run(...) içinde çağırır; böylece hepsi geri alınabilir.
import { cardOrdsForNote } from "@/lib/cards/generate";
import type { LocalDB } from "@/lib/db/database";
import { insertRows, softDeleteRows, updateRows } from "@/lib/db/mutations";
import type { CardRow, NoteRow, NoteTypeRow, ReviewLogRow } from "@/lib/db/types";
import { nextNewPosition, sortFieldText } from "@/lib/notes";
import type { DayInfo } from "@/lib/scheduler/day";
import { normalizeTags, stripHtml } from "@/lib/text";

const DAY = 86_400_000;

async function liveCards(db: LocalDB, ids: string[]): Promise<CardRow[]> {
  return (await db.cards.bulkGet(ids)).filter((c): c is CardRow => !!c && c.deleted_at === null);
}

async function liveNotes(db: LocalDB, ids: string[]): Promise<NoteRow[]> {
  return (await db.notes.bulkGet(ids)).filter((n): n is NoteRow => !!n && n.deleted_at === null);
}

/** Kartları başka bir desteye taşır */
export async function changeDeck(db: LocalDB, cardIds: string[], deckId: string): Promise<number> {
  const cards = (await liveCards(db, cardIds)).filter((c) => c.deck_id !== deckId);
  await updateRows(db, "cards", cards.map((c) => ({ id: c.id, patch: { deck_id: deckId } })));
  return cards.length;
}

// ---------------------------------------------------------------- etiketler

const tagKey = (t: string) => t.toLocaleLowerCase("tr");

export async function addTags(db: LocalDB, noteIds: string[], tags: string[]): Promise<number> {
  const add = normalizeTags(tags);
  if (!add.length) return 0;
  const notes = await liveNotes(db, noteIds);
  const patches = notes
    .map((n) => ({ n, tags: normalizeTags([...n.tags, ...add]) }))
    .filter(({ n, tags: t }) => t.length !== n.tags.length)
    .map(({ n, tags: t }) => ({ id: n.id, patch: { tags: t } }));
  await updateRows(db, "notes", patches);
  return patches.length;
}

export async function removeTags(db: LocalDB, noteIds: string[], tags: string[]): Promise<number> {
  const remove = new Set(normalizeTags(tags).map(tagKey));
  if (!remove.size) return 0;
  const notes = await liveNotes(db, noteIds);
  const patches = notes
    .map((n) => ({ n, tags: n.tags.filter((t) => !remove.has(tagKey(t))) }))
    .filter(({ n, tags: t }) => t.length !== n.tags.length)
    .map(({ n, tags: t }) => ({ id: n.id, patch: { tags: t } }));
  await updateRows(db, "notes", patches);
  return patches.length;
}

/** Etiket ve alt etiketleri (eski::x) ile birlikte yeniden adlandırır. Yeni ad varsa birleşir. */
export async function renameTag(db: LocalDB, from: string, to: string): Promise<number> {
  const target = to.trim();
  if (!target || /\s/.test(target)) throw new Error("Etiket adı boş olamaz ve boşluk içeremez.");
  const old = tagKey(from);
  const rename = (t: string) => {
    const k = tagKey(t);
    if (k === old) return target;
    if (k.startsWith(`${old}::`)) return target + t.slice(from.length);
    return t;
  };
  const notes = (await db.notes.toArray()).filter((n) => n.deleted_at === null && n.tags.some((t) => rename(t) !== t));
  await updateRows(db, "notes", notes.map((n) => ({ id: n.id, patch: { tags: normalizeTags(n.tags.map(rename)) } })));
  return notes.length;
}

/** Etiketi (ve alt etiketlerini) tüm notlardan kaldırır */
export async function deleteTag(db: LocalDB, tag: string): Promise<number> {
  const old = tagKey(tag);
  const keep = (t: string) => tagKey(t) !== old && !tagKey(t).startsWith(`${old}::`);
  const notes = (await db.notes.toArray()).filter((n) => n.deleted_at === null && !n.tags.every(keep));
  await updateRows(db, "notes", notes.map((n) => ({ id: n.id, patch: { tags: n.tags.filter(keep) } })));
  return notes.length;
}

export interface TagInfo {
  name: string;
  count: number;
}

/** Kullanılan etiketler ve not sayıları (silinmemiş notlardan) */
export function listTags(notes: NoteRow[]): TagInfo[] {
  const counts = new Map<string, TagInfo>();
  for (const n of notes) {
    if (n.deleted_at !== null) continue;
    for (const t of n.tags) {
      const k = tagKey(t);
      const cur = counts.get(k);
      if (cur) cur.count++;
      else counts.set(k, { name: t, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

// ------------------------------------------------------------ bul-değiştir

export interface FindReplaceOptions {
  find: string;
  replace: string;
  /** Sadece bu alanda (alan ADI); null = tüm alanlar */
  fieldName: string | null;
  regex: boolean;
  matchCase: boolean;
}

/** Notların alanlarında bul-değiştir. Değişen not sayısını döndürür. */
export async function findReplace(db: LocalDB, noteIds: string[], opts: FindReplaceOptions): Promise<number> {
  if (!opts.find) throw new Error("Aranacak metni yaz.");
  let re: RegExp;
  try {
    re = new RegExp(opts.regex ? opts.find : opts.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), opts.matchCase ? "g" : "gi");
  } catch {
    throw new Error("Düzenli ifade geçersiz.");
  }
  const notes = await liveNotes(db, noteIds);
  const types = new Map((await db.note_types.toArray()).map((t) => [t.id, t]));
  const patches: { id: string; patch: Partial<NoteRow> }[] = [];
  const changedNotes: NoteRow[] = [];
  for (const n of notes) {
    const nt = types.get(n.note_type_id);
    if (!nt) continue;
    const fields = { ...n.fields };
    let changed = false;
    for (const f of nt.fields) {
      if (opts.fieldName && f.name !== opts.fieldName) continue;
      const before = fields[f.id] ?? "";
      const after = before.replace(re, opts.regex ? opts.replace : opts.replace.replace(/\$/g, "$$$$"));
      if (after !== before) {
        fields[f.id] = after;
        changed = true;
      }
    }
    if (changed) {
      patches.push({ id: n.id, patch: { fields, sort_field: sortFieldText(nt, fields) } });
      changedNotes.push({ ...n, fields });
    }
  }
  await updateRows(db, "notes", patches);
  await generateMissingCards(db, changedNotes);
  return patches.length;
}

// ------------------------------------------------------- zamanlama işlemleri

export interface RepositionOptions {
  start: number;
  step: number;
  randomize: boolean;
  /** Başlangıç noktasından sonraki diğer yeni kartları kaydır */
  shift: boolean;
}

/** Yeni kartların sırasını değiştirir (sadece yeni kartlar). Değişen kart sayısı. */
export async function repositionNew(db: LocalDB, cardIds: string[], opts: RepositionOptions, rand = Math.random): Promise<number> {
  const cards = (await liveCards(db, cardIds)).filter((c) => c.state === 0);
  if (!cards.length) return 0;
  const step = Math.max(1, Math.floor(opts.step));
  const start = Math.floor(opts.start);
  // Not başına tek sıra (kardeş kartlar yan yana kalsın)
  const noteOrder = [...new Set(cards.sort((a, b) => a.position - b.position || a.created_at - b.created_at || a.ord - b.ord).map((c) => c.note_id))];
  if (opts.randomize) {
    for (let i = noteOrder.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [noteOrder[i], noteOrder[j]] = [noteOrder[j], noteOrder[i]];
    }
  }
  const posOf = new Map(noteOrder.map((id, i) => [id, start + i * step]));
  const patches: { id: string; patch: Partial<CardRow> }[] = cards.map((c) => ({ id: c.id, patch: { position: posOf.get(c.note_id)! } }));
  if (opts.shift) {
    const selected = new Set(cards.map((c) => c.id));
    const by = noteOrder.length * step;
    const others = (await db.cards.toArray()).filter((c) => c.deleted_at === null && c.state === 0 && !selected.has(c.id) && c.position >= start);
    for (const c of others) patches.push({ id: c.id, patch: { position: c.position + by } });
  }
  await updateRows(db, "cards", patches);
  return cards.length;
}

/** "0", "3", "1-7", "3!" , "0-2!" gibi tarih ifadesini çözer */
export function parseDueSpec(spec: string): { min: number; max: number; setInterval: boolean } | null {
  const m = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*(!)?\s*$/.exec(spec);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] !== undefined ? Number(m[2]) : a;
  if (a > 36500 || b > 36500) return null;
  return { min: Math.min(a, b), max: Math.max(a, b), setInterval: !!m[3] };
}

function manualLog(c: CardRow, now: number, after: Partial<CardRow>): Partial<ReviewLogRow> {
  return {
    card_id: c.id,
    note_id: c.note_id,
    deck_id: c.deck_id,
    reviewed_at: now,
    rating: 0,
    kind: 4, // elle
    state: null,
    due: after.due ?? null,
    stability: after.stability ?? c.stability,
    difficulty: after.difficulty ?? c.difficulty,
    elapsed_days: null,
    last_elapsed_days: null,
    scheduled_days: after.scheduled_days ?? null,
    interval_before: c.interval_days,
    interval_after: after.interval_days ?? c.interval_days,
    ease: c.ease,
    duration_ms: 0,
  };
}

/**
 * Tarih ata: kartlar bugünden n gün sonra (aralıktan rastgele) tekrar kartı olarak gelir.
 * "!" ile aralık da o gün sayısına ayarlanır. Yeni kartlar tekrar kartına dönüşür.
 */
export async function setDueDate(db: LocalDB, cardIds: string[], spec: string, day: DayInfo, rand = Math.random): Promise<number> {
  const parsed = parseDueSpec(spec);
  if (!parsed) throw new Error('Geçersiz değer. Örnekler: "0" bugün, "1" yarın, "1-7" bir hafta içinde, "3!" aralığı da 3 gün yap.');
  const cards = await liveCards(db, cardIds);
  const now = db.now();
  const patches: { id: string; patch: Partial<CardRow> }[] = [];
  const logs: Partial<ReviewLogRow>[] = [];
  for (const c of cards) {
    const days = parsed.min + Math.floor(rand() * (parsed.max - parsed.min + 1));
    const due = day.dayStart + days * DAY;
    const patch: Partial<CardRow> = { due, buried_until: null };
    const wasNew = c.state === 0;
    if (c.state !== 2) {
      patch.state = 2;
      patch.step = 0;
    }
    if (parsed.setInterval || wasNew || c.interval_days < 1) {
      const ivl = Math.max(1, days);
      patch.interval_days = ivl;
      patch.scheduled_days = ivl;
      if (wasNew || c.stability <= 0) patch.stability = ivl;
      if (wasNew || c.difficulty <= 0) patch.difficulty = 5;
      patch.last_review = due - ivl * DAY;
    }
    patches.push({ id: c.id, patch });
    logs.push(manualLog(c, now, patch));
  }
  await updateRows(db, "cards", patches);
  if (logs.length) await insertRows(db, "review_logs", logs);
  return cards.length;
}

/** Unut: kartları yeni karta çevirir. */
export async function forgetCards(
  db: LocalDB,
  cardIds: string[],
  opts: { restorePosition: boolean; resetCounts: boolean },
): Promise<number> {
  const cards = (await liveCards(db, cardIds)).filter((c) => c.state !== 0 || opts.resetCounts);
  const now = db.now();
  const endPos = nextNewPosition(now);
  const patches = cards.map((c) => {
    const patch: Partial<CardRow> = {
      state: 0,
      step: 0,
      due: 0,
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      interval_days: 0,
      last_review: null,
      buried_until: null,
      position: opts.restorePosition ? c.position : endPos,
    };
    if (opts.resetCounts) {
      patch.reps = 0;
      patch.lapses = 0;
    }
    return { id: c.id, patch };
  });
  await updateRows(db, "cards", patches);
  if (cards.length) await insertRows(db, "review_logs", cards.map((c) => manualLog(c, now, { due: 0, interval_days: 0 })));
  return cards.length;
}

// --------------------------------------------------------- not tipi değiştir

export interface ChangeNoteTypeMapping {
  /** Yeni alan id → eski alan id (null: boş kalır) */
  fields: Record<string, string | null>;
  /** Eski kart sırası → yeni kart sırası (null: kart silinir). Cloze'a geçerken kullanılmaz. */
  templates: Record<number, number | null>;
}

/**
 * Notları başka bir not tipine çevirir. Notların hepsi AYNI not tipinden olmalı.
 * Kart geçmişi korunur (kartlar yeni şablona eşlenir). Eksik kartlar üretilir.
 */
export async function changeNoteType(db: LocalDB, noteIds: string[], target: NoteTypeRow, map: ChangeNoteTypeMapping): Promise<number> {
  const notes = await liveNotes(db, noteIds);
  if (!notes.length) return 0;
  const sourceIds = new Set(notes.map((n) => n.note_type_id));
  if (sourceIds.size > 1) throw new Error("Seçili notlar aynı not tipinden olmalı.");
  const source = await db.note_types.get([...sourceIds][0]);
  if (!source) throw new Error("Not tipi bulunamadı");

  const notePatches: { id: string; patch: Partial<NoteRow> }[] = [];
  const updated: NoteRow[] = [];
  for (const n of notes) {
    const fields: Record<string, string> = {};
    for (const f of target.fields) {
      const from = map.fields[f.id];
      fields[f.id] = from ? (n.fields[from] ?? "") : "";
    }
    notePatches.push({ id: n.id, patch: { note_type_id: target.id, fields, sort_field: sortFieldText(target, fields) } });
    updated.push({ ...n, note_type_id: target.id, fields });
  }
  await updateRows(db, "notes", notePatches);

  const cards = (await db.cards.where("note_id").anyOf(notes.map((n) => n.id)).toArray()).filter((c) => c.deleted_at === null);
  const cardPatches: { id: string; patch: Partial<CardRow> }[] = [];
  const remove: string[] = [];
  const toCloze = target.kind === "cloze";
  const fromCloze = source.kind === "cloze";
  const taken = new Set<string>();
  for (const c of cards.sort((a, b) => a.ord - b.ord)) {
    // Cloze → cloze: sıralar aynı kalır. Diğer durumlarda eşleme kullanılır.
    const next = toCloze && fromCloze ? c.ord : (map.templates[c.ord] ?? null);
    const key = `${c.note_id}:${next}`;
    if (next === null || taken.has(key)) {
      remove.push(c.id);
      continue;
    }
    taken.add(key);
    if (next !== c.ord) cardPatches.push({ id: c.id, patch: { ord: next } });
  }
  await updateRows(db, "cards", cardPatches);
  await softDeleteRows(db, "cards", remove);
  await generateMissingCards(db, updated, target);
  return notes.length;
}

/** Notlar için olması gereken ama olmayan kartları üretir (notun mevcut destesine) */
export async function generateMissingCards(db: LocalDB, notes: NoteRow[], noteType?: NoteTypeRow): Promise<number> {
  if (!notes.length) return 0;
  const types = new Map((await db.note_types.toArray()).map((t) => [t.id, t]));
  if (noteType) types.set(noteType.id, noteType);
  const cards = (await db.cards.where("note_id").anyOf(notes.map((n) => n.id)).toArray()).filter((c) => c.deleted_at === null);
  const byNote = new Map<string, CardRow[]>();
  for (const c of cards) byNote.set(c.note_id, [...(byNote.get(c.note_id) ?? []), c]);
  const position = nextNewPosition(db.now());
  const fresh: Partial<CardRow>[] = [];
  for (const n of notes) {
    const nt = types.get(n.note_type_id);
    const existing = byNote.get(n.id) ?? [];
    if (!nt || !existing.length) continue;
    const have = new Set(existing.map((c) => c.ord));
    for (const ord of cardOrdsForNote(nt, n.fields)) {
      if (!have.has(ord)) fresh.push({ note_id: n.id, deck_id: existing[0].deck_id, ord, position });
    }
  }
  if (fresh.length) await insertRows(db, "cards", fresh);
  return fresh.length;
}

// ------------------------------------------------------------- kopyaları bul

export interface DuplicateGroup {
  text: string;
  noteIds: string[];
}

/** Bir not tipinin bir alanında aynı içeriğe sahip notlar (HTML'siz, büyük/küçük harf duyarsız) */
export function findDuplicates(notes: NoteRow[], noteTypeId: string, fieldId: string): DuplicateGroup[] {
  const groups = new Map<string, DuplicateGroup>();
  // Eski not önce (grup adı en eski notun yazımıyla gösterilir)
  const ordered = [...notes].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
  for (const n of ordered) {
    if (n.deleted_at !== null || n.note_type_id !== noteTypeId) continue;
    const text = stripHtml(n.fields[fieldId] ?? "").trim();
    if (!text) continue;
    const key = text.toLocaleLowerCase("tr");
    const g = groups.get(key);
    if (g) g.noteIds.push(n.id);
    else groups.set(key, { text, noteIds: [n.id] });
  }
  return [...groups.values()].filter((g) => g.noteIds.length > 1).sort((a, b) => b.noteIds.length - a.noteIds.length || a.text.localeCompare(b.text, "tr"));
}
