// İÇE AKTARMA — YAZMA: ayrıştırılmış Anki paketini cihaz veritabanına yazar.
// Yazılanlar outbox'a da girer; internet olunca sunucuya eşlenir.
import type { LocalDB } from "@/lib/db/database";
import { deterministicId, insertRows, updateRow } from "@/lib/db/mutations";
import type { CardRow, NoteExampleRow, NoteRow, NoteTypeRow, ReviewLogRow } from "@/lib/db/types";
import { createDeckPath } from "@/lib/decks";
import { saveExamples, sortFieldText } from "@/lib/notes";
import { MAX_MEDIA_BYTES, addMediaFile, extensionFor } from "@/lib/sync/media";
import { newGuid, normalizeTags } from "@/lib/text";
import type { AnkiCard, AnkiNoteType, AnkiPackage, AnkiRevlog } from "./anki-package";
import { IO_BACK, IO_FRONT } from "@/lib/notetypes/builtins";
import { splitExamples } from "./examples";
import { MEDIA_PREFIX, isImageFile, isSoundOrVideoFile, mimeForImage, rewriteImageSources, stripSoundAndVideo } from "./html";

const DAY = 86_400_000;
const CHUNK = 300;

export interface NoteTypeExampleChoice {
  /** Kelimenin bulunduğu alanın sırası (Anki ord) */
  wordFieldOrd: number | null;
  /** Örnek cümlelerin bulunduğu alanın sırası (yoksa null) */
  exampleFieldOrd: number | null;
  /** Şablonlarda örnek cümle alanı yerine {{Example}} kullanılsın mı */
  useExampleTag: boolean;
}

export interface AnkiImportOptions {
  /** Çalışma geçmişi ve kart durumları da gelsin mi (yoksa tüm kartlar yeni) */
  includeScheduling: boolean;
  /** Aynı not (GUID) zaten varsa: güncelle / atla / kopya oluştur */
  duplicateMode: "update" | "skip" | "duplicate";
  /** Not tipi (Anki id) → örnek cümle sihirbazı seçimleri */
  examples: Record<number, NoteTypeExampleChoice>;
}

export interface ImportProgress {
  label: string;
  done: number;
  total: number;
}

export interface ImportSummary {
  noteTypesAdded: number;
  decksUsed: number;
  notesAdded: number;
  notesUpdated: number;
  notesSkipped: number;
  cardsAdded: number;
  reviewLogsAdded: number;
  imagesAdded: number;
  soundsSkipped: number;
  /** 10 MB'tan büyük olduğu için alınmayan resimler */
  imagesTooLarge: number;
  otherMediaSkipped: number;
  examplesAdded: number;
}

const tick = () => new Promise((r) => setTimeout(r, 0)); // arayüz donmasın

function fieldId(ord: number) {
  return `anki${ord}`;
}

/** Not tipini, örnek cümle seçimine göre uyarlar ({{Example}} kullanımı) */
function adaptTemplates(nt: AnkiNoteType, choice: NoteTypeExampleChoice | undefined) {
  const fields = nt.fields.map((f) => ({ id: fieldId(f.ord), name: f.name, sticky: f.sticky }));
  let templates = nt.templates.map((t) => ({ id: fieldId(t.ord), name: t.name, front: t.front, back: t.back }));
  if (!choice?.useExampleTag || choice.exampleFieldOrd === null) return { fields, templates };

  // "Example"/"Examples" adlı alanlar özelliğimizle çakışmasın diye yeniden adlandırılır.
  // Örnek alanının kendisi bu adı taşıyorsa şablondaki {{Example}} artık özelliğimizi gösterir.
  const exampleField = nt.fields.find((f) => f.ord === choice.exampleFieldOrd);
  for (const f of fields) {
    if (/^examples?$/i.test(f.name)) f.name = `${f.name} (orijinal)`;
  }
  if (exampleField && !/^examples?$/i.test(exampleField.name)) {
    const ref = new RegExp(`\\{\\{\\s*${exampleField.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}\\}`, "g");
    let replaced = false;
    templates = templates.map((t) => {
      const back = t.back.replace(ref, () => {
        replaced = true;
        return "{{Example}}";
      });
      return { ...t, front: t.front.replace(ref, "{{Example}}"), back };
    });
    if (!replaced) {
      templates = templates.map((t) => ({ ...t, back: `${t.back}\n\n<div class="kk-example-box">{{Example}}</div>` }));
    }
  }
  return { fields, templates };
}

/** Anki kartının zamanlamasını bizim kart alanlarına çevirir */
export function convertScheduling(card: AnkiCard, crt: number, logs: AnkiRevlog[]): Partial<CardRow> {
  const dayDue = (crt + card.due * 86400) * 1000;
  const learningDue = card.queue === 1 ? card.due * 1000 : dayDue; // queue 1: saniye, queue 3: gün
  let memory: { s?: number; d?: number } = {};
  try {
    memory = card.data ? (JSON.parse(card.data) as { s?: number; d?: number }) : {};
  } catch {
    memory = {};
  }
  const lastLog = logs.length ? logs[logs.length - 1].id : null;
  const factor = card.factor > 0 ? card.factor : 2500;
  // FSRS durumu yoksa SM-2 değerlerinden kaba bir tahmin
  const difficulty = memory.d ?? Math.min(10, Math.max(1, 10 - ((factor - 1300) / 2600) * 9));
  const ivl = Math.max(0, card.ivl);
  const base = {
    suspended: card.queue === -1,
    flags: card.flags,
    reps: card.reps,
    lapses: card.lapses,
    ease: factor,
  };
  if (card.type === 0) return { ...base, state: 0, position: card.due };
  if (card.type === 2) {
    return {
      ...base,
      state: 2,
      due: dayDue,
      interval_days: ivl,
      scheduled_days: ivl,
      stability: memory.s ?? Math.max(ivl, 0.5),
      difficulty,
      last_review: lastLog ?? dayDue - ivl * DAY,
    };
  }
  // 1: öğrenme, 3: yeniden öğrenme
  return {
    ...base,
    state: card.type === 3 ? 3 : 1,
    step: 0,
    due: learningDue,
    interval_days: ivl,
    scheduled_days: card.queue === 3 ? 1 : 0,
    stability: memory.s ?? Math.max(ivl, 0.5),
    difficulty,
    last_review: lastLog ?? learningDue,
  };
}

/** Anki revlog → bizim review_logs satırları (kart başına sıralı) */
function convertRevlog(logs: AnkiRevlog[], cardId: string, noteId: string, deckId: string, uid: string): Partial<ReviewLogRow>[] {
  let seenFirst = false;
  return logs.map((l) => {
    let state: number | null;
    if (l.type === 0) {
      state = seenFirst ? 1 : 0;
    } else if (l.type === 1 || l.type === 3) state = 2;
    else if (l.type === 2) state = 3;
    else state = null;
    seenFirst = true;
    return {
      id: deterministicId(`anki-revlog:${l.id}:${l.cardId}`, uid),
      created_at: l.id,
      card_id: cardId,
      note_id: noteId,
      deck_id: deckId,
      reviewed_at: l.id,
      rating: l.ease >= 1 && l.ease <= 4 ? l.ease : 0,
      kind: l.type >= 4 ? 4 : l.type,
      state,
      interval_before: Math.max(0, l.lastIvl),
      interval_after: Math.max(0, l.ivl),
      ease: l.factor || null,
      duration_ms: Math.max(0, l.time),
    };
  });
}

export async function importAnkiPackage(
  db: LocalDB,
  pkg: AnkiPackage,
  readMediaFiles: (names: string[]) => Map<string, Uint8Array> | Promise<Map<string, Uint8Array>>,
  options: AnkiImportOptions,
  onProgress: (p: ImportProgress) => void = () => {},
): Promise<ImportSummary> {
  const uid = db.userId;
  const summary: ImportSummary = {
    noteTypesAdded: 0,
    decksUsed: 0,
    notesAdded: 0,
    notesUpdated: 0,
    notesSkipped: 0,
    cardsAdded: 0,
    reviewLogsAdded: 0,
    imagesAdded: 0,
    soundsSkipped: 0,
    imagesTooLarge: 0,
    otherMediaSkipped: 0,
    examplesAdded: 0,
  };

  // 1) Not tipleri (sadece kullanılanlar)
  onProgress({ label: "Not tipleri", done: 0, total: 1 });
  const usedTypes = new Set(pkg.notes.map((n) => n.noteTypeId));
  const ntMap = new Map<number, NoteTypeRow>();
  for (const nt of pkg.noteTypes) {
    if (!usedTypes.has(nt.ankiId)) continue;
    const choice = options.examples[nt.ankiId];
    const id = deterministicId(`anki-notetype:${nt.ankiId}:${nt.fields.map((f) => f.name).join("\u001f")}`, uid);
    const wordField = choice?.wordFieldOrd != null ? fieldId(choice.wordFieldOrd) : null;
    const existing = await db.note_types.get(id);
    if (existing && existing.deleted_at === null) {
      if (wordField && existing.word_field !== wordField) await updateRow(db, "note_types", id, { word_field: wordField });
      ntMap.set(nt.ankiId, { ...existing, word_field: wordField ?? existing.word_field });
      continue;
    }
    let { fields, templates } = adaptTemplates(nt, choice);
    // Anki'nin resim maskeleme tipi (kendi JS'iyle çizer) → bizim maske şablonlarımız
    const isIo = nt.templates.some((t) => /image-occlusion/.test(t.front)) && nt.fields.some((f) => f.name === "Occlusion");
    if (isIo) templates = [{ id: fieldId(0), name: nt.templates[0]?.name ?? "Image Occlusion", front: IO_FRONT, back: IO_BACK }];
    const [row] = await insertRows(db, "note_types", [
      {
        id,
        name: nt.name,
        kind: isIo ? "image_occlusion" : nt.kind,
        fields,
        templates,
        css: nt.css,
        sort_field: fieldId(nt.fields[nt.sortFieldIdx]?.ord ?? 0),
        word_field: wordField,
      },
    ]);
    ntMap.set(nt.ankiId, row);
    summary.noteTypesAdded++;
  }

  // 2) Desteler (kartların kullandıkları; filtrelenmiş destedeki kart asıl destesine)
  const deckByAnkiId = new Map(pkg.decks.map((d) => [d.ankiId, d]));
  const deckMap = new Map<number, string>();
  const deckOf = (c: AnkiCard) => (c.originalDeckId ? c.originalDeckId : c.deckId);
  for (const ankiDeckId of new Set(pkg.cards.map(deckOf))) {
    const d = deckByAnkiId.get(ankiDeckId);
    const deck = await createDeckPath(db, d && !d.filtered ? d.name : "İçe aktarılan");
    deckMap.set(ankiDeckId, deck.id);
  }
  summary.decksUsed = new Set(deckMap.values()).size;

  // 3) Resimler (sesler ve videolar atlanır)
  const mediaRefs = new Map<string, string>();
  const images = pkg.media.filter((m) => isImageFile(m.name));
  summary.soundsSkipped = pkg.media.filter((m) => isSoundOrVideoFile(m.name)).length;
  summary.otherMediaSkipped = pkg.media.length - images.length - summary.soundsSkipped;
  for (let i = 0; i < images.length; i += 20) {
    onProgress({ label: "Resimler", done: i, total: images.length });
    const batch = images.slice(i, i + 20);
    const data = await readMediaFiles(batch.map((m) => m.name));
    for (const m of batch) {
      const bytes = data.get(m.name);
      if (!bytes) continue;
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const mime = mimeForImage(m.name);
      if (buf.byteLength > MAX_MEDIA_BYTES) {
        summary.imagesTooLarge++;
        continue;
      }
      const row = await addMediaFile(db, buf, m.name, mime);
      mediaRefs.set(m.name, `${MEDIA_PREFIX}${row.hash}.${extensionFor(mime, m.name)}`);
      summary.imagesAdded++;
    }
    await tick();
  }

  // 4) Notlar
  const createdNotes = new Map<number, NoteRow>(); // Anki not id → yeni oluşturulan not
  const existingByGuid = new Map<string, NoteRow>();
  const guids = [...new Set(pkg.notes.map((n) => n.guid))];
  for (let i = 0; i < guids.length; i += 500) {
    for (const n of await db.notes.where("guid").anyOf(guids.slice(i, i + 500)).toArray()) {
      if (n.deleted_at === null) existingByGuid.set(n.guid, n);
    }
  }
  const examplesByNote = new Map<string, string[]>();

  for (let i = 0; i < pkg.notes.length; i += CHUNK) {
    onProgress({ label: "Notlar", done: i, total: pkg.notes.length });
    const toInsert: Partial<NoteRow>[] = [];
    const ankiIds: number[] = [];
    for (const n of pkg.notes.slice(i, i + CHUNK)) {
      const nt = ntMap.get(n.noteTypeId);
      if (!nt) {
        summary.notesSkipped++;
        continue;
      }
      const choice = options.examples[n.noteTypeId];
      const known = new Set(nt.fields.map((f) => f.id));
      const fields: Record<string, string> = {};
      n.fields.forEach((value, ord) => {
        if (!known.has(fieldId(ord))) return;
        fields[fieldId(ord)] = rewriteImageSources(stripSoundAndVideo(value).html, mediaRefs);
      });
      const examples =
        choice?.exampleFieldOrd != null ? splitExamples(stripSoundAndVideo(n.fields[choice.exampleFieldOrd] ?? "").html) : [];
      const tags = normalizeTags(n.tags);
      const existing = existingByGuid.get(n.guid);

      if (existing && options.duplicateMode !== "duplicate") {
        if (options.duplicateMode === "skip" || existing.note_type_id !== nt.id) {
          summary.notesSkipped++;
          continue;
        }
        await updateRow(db, "notes", existing.id, { fields, tags, sort_field: sortFieldText(nt, fields) });
        if (choice?.exampleFieldOrd != null) examplesByNote.set(existing.id, examples);
        summary.notesUpdated++;
        continue;
      }
      const id = crypto.randomUUID();
      toInsert.push({
        id,
        note_type_id: nt.id,
        guid: existing ? newGuid() : n.guid,
        fields,
        tags,
        sort_field: sortFieldText(nt, fields),
      });
      ankiIds.push(n.ankiId);
      if (examples.length) examplesByNote.set(id, examples);
    }
    const rows = await insertRows(db, "notes", toInsert);
    rows.forEach((row, k) => createdNotes.set(ankiIds[k], row));
    summary.notesAdded += rows.length;
    await tick();
  }

  // 5) Kartlar (+ isteğe bağlı çalışma geçmişi) — sadece yeni oluşturulan notlar için
  const logsByCard = new Map<number, AnkiRevlog[]>();
  if (options.includeScheduling) {
    for (const l of [...pkg.revlog].sort((a, b) => a.id - b.id)) {
      logsByCard.set(l.cardId, [...(logsByCard.get(l.cardId) ?? []), l]);
    }
  }
  const cards = pkg.cards
    .filter((c) => createdNotes.has(c.noteId))
    .sort((a, b) => (a.type === 0 && b.type === 0 ? a.due - b.due : 0) || a.ankiId - b.ankiId);
  for (let i = 0; i < cards.length; i += CHUNK) {
    onProgress({ label: "Kartlar", done: i, total: cards.length });
    const cardRows: Partial<CardRow>[] = [];
    const logRows: Partial<ReviewLogRow>[] = [];
    cards.slice(i, i + CHUNK).forEach((c, k) => {
      const note = createdNotes.get(c.noteId)!;
      const deckId = deckMap.get(deckOf(c))!;
      const id = crypto.randomUUID();
      const sched = options.includeScheduling
        ? convertScheduling(c, pkg.collectionCreated, logsByCard.get(c.ankiId) ?? [])
        : { state: 0, position: i + k };
      cardRows.push({ id, note_id: note.id, deck_id: deckId, ord: c.ord, ...sched });
      if (options.includeScheduling) logRows.push(...convertRevlog(logsByCard.get(c.ankiId) ?? [], id, note.id, deckId, uid));
    });
    summary.cardsAdded += (await insertRows(db, "cards", cardRows)).length;
    if (logRows.length) summary.reviewLogsAdded += (await insertRows(db, "review_logs", logRows)).length;
    await tick();
  }

  // 6) Örnek cümleler (güncellenen notlarda desteden gelen eski cümleler yenileriyle değişir)
  const createdIds = new Set([...createdNotes.values()].map((n) => n.id));
  let done = 0;
  const pending: Partial<NoteExampleRow>[] = [];
  for (const [noteId, texts] of examplesByNote) {
    onProgress({ label: "Örnek cümleler", done: done++, total: examplesByNote.size });
    let offset = 0;
    if (!createdIds.has(noteId)) {
      const kept = (await db.note_examples.where("note_id").equals(noteId).toArray())
        .filter((e) => e.deleted_at === null && e.source !== "deck")
        .sort((a, b) => a.position - b.position);
      await saveExamples(db, noteId, kept.map((e) => ({ id: e.id, text: e.text, translation: e.translation })));
      offset = kept.length;
    }
    texts.forEach((text, i) =>
      pending.push({ note_id: noteId, text, translation: null, source: "deck", approved: true, position: offset + i }),
    );
    if (pending.length >= CHUNK) summary.examplesAdded += (await insertRows(db, "note_examples", pending.splice(0))).length;
  }
  if (pending.length) summary.examplesAdded += (await insertRows(db, "note_examples", pending)).length;

  onProgress({ label: "Bitti", done: 1, total: 1 });
  return summary;
}
