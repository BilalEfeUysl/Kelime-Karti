// Kart tarayıcı toplu işlemleri
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addTags,
  changeDeck,
  changeNoteType,
  deleteTag,
  findDuplicates,
  findReplace,
  forgetCards,
  listTags,
  parseDueSpec,
  removeTags,
  renameTag,
  repositionNew,
  setDueDate,
} from "@/lib/browse/ops";
import { type LocalDB, openLocalDB } from "@/lib/db/database";
import { updateRow } from "@/lib/db/mutations";
import type { NoteTypeRow } from "@/lib/db/types";
import { createDeckPath } from "@/lib/decks";
import { addNote } from "@/lib/notes";
import { builtinNoteTypeId, defaultDeckId, ensureDefaults } from "@/lib/notetypes/builtins";
import { getDayInfo } from "@/lib/scheduler/day";
import { UndoManager } from "@/lib/undo";

const uid = "00000000-0000-4000-8000-0000000000bb";
const DAY = 86_400_000;
let now = Date.UTC(2026, 9, 15, 9, 0);
let db: LocalDB;
const day = () => getDayInfo(now, "Europe/Istanbul", 4);
const nt = (key: Parameters<typeof builtinNoteTypeId>[0]) => db.note_types.get(builtinNoteTypeId(key, uid)).then((n) => n!);

async function note(front: string, back = "x", tags: string[] = [], key: Parameters<typeof builtinNoteTypeId>[0] = "basic") {
  const t = await nt(key);
  return addNote(db, { noteType: t, deckId: defaultDeckId(uid), fields: { front, back }, tags });
}

beforeEach(async () => {
  now = Date.UTC(2026, 9, 15, 9, 0);
  db = await openLocalDB(uid, { dexie: { indexedDB: new IDBFactory(), IDBKeyRange }, now: () => now });
  await ensureDefaults(db);
});

describe("deste ve etiketler", () => {
  it("deste değiştir", async () => {
    const a = await note("a");
    const deck = await createDeckPath(db, "YDS::Fiiller");
    expect(await changeDeck(db, [a.cards[0].id], deck.id)).toBe(1);
    expect((await db.cards.get(a.cards[0].id))!.deck_id).toBe(deck.id);
    expect(await changeDeck(db, [a.cards[0].id], deck.id)).toBe(0); // zaten orada
  });

  it("etiket ekle / çıkar (büyük-küçük harf duyarsız, tekrarsız)", async () => {
    const a = await note("a", "x", ["yds"]);
    const b = await note("b");
    expect(await addTags(db, [a.note.id, b.note.id], ["YDS", "fiil"])).toBe(2);
    expect((await db.notes.get(a.note.id))!.tags).toEqual(["yds", "fiil"]);
    expect((await db.notes.get(b.note.id))!.tags).toEqual(["YDS", "fiil"]);
    expect(await removeTags(db, [a.note.id, b.note.id], ["Fiil"])).toBe(2);
    expect((await db.notes.get(b.note.id))!.tags).toEqual(["YDS"]);
  });

  it("etiket yeniden adlandır (alt etiketlerle), birleştir, sil, listele", async () => {
    const a = await note("a", "x", ["yds::fiil", "zor"]);
    const b = await note("b", "x", ["yds", "kolay"]);
    expect(await renameTag(db, "yds", "sinav")).toBe(2);
    expect((await db.notes.get(a.note.id))!.tags).toEqual(["sinav::fiil", "zor"]);
    expect((await db.notes.get(b.note.id))!.tags).toEqual(["sinav", "kolay"]);
    // Birleştirme: "kolay" → "zor" (b'de ikisi birden olmasın)
    await renameTag(db, "kolay", "zor");
    expect((await db.notes.get(b.note.id))!.tags).toEqual(["sinav", "zor"]);
    expect(listTags(await db.notes.toArray())).toEqual([
      { name: "sinav", count: 1 },
      { name: "sinav::fiil", count: 1 },
      { name: "zor", count: 2 },
    ]);
    expect(await deleteTag(db, "sinav")).toBe(2);
    expect((await db.notes.get(a.note.id))!.tags).toEqual(["zor"]);
    await expect(renameTag(db, "zor", "iki kelime")).rejects.toThrow();
  });
});

describe("bul-değiştir", () => {
  it("düz metin, alan seçimi, büyük/küçük harf, sıralama alanı güncellenir", async () => {
    const a = await note("Cat <b>cat</b>", "kedi");
    const n = await findReplace(db, [a.note.id], { find: "cat", replace: "dog", fieldName: "Front", regex: false, matchCase: false });
    expect(n).toBe(1);
    const after = (await db.notes.get(a.note.id))!;
    expect(after.fields.front).toBe("dog <b>dog</b>");
    expect(after.sort_field).toBe("dog dog");
    // Başka alanda arama: değişmez
    expect(await findReplace(db, [a.note.id], { find: "dog", replace: "x", fieldName: "Back", regex: false, matchCase: false })).toBe(0);
  });

  it("düzenli ifade ve $1; düz metinde $ olduğu gibi kalır", async () => {
    const a = await note("2026-10-15", "fiyat");
    await findReplace(db, [a.note.id], { find: "(\\d+)-(\\d+)-(\\d+)", replace: "$3.$2.$1", fieldName: null, regex: true, matchCase: true });
    expect((await db.notes.get(a.note.id))!.fields.front).toBe("15.10.2026");
    await findReplace(db, [a.note.id], { find: "fiyat", replace: "$5", fieldName: null, regex: false, matchCase: true });
    expect((await db.notes.get(a.note.id))!.fields.back).toBe("$5");
    await expect(findReplace(db, [a.note.id], { find: "(", replace: "", fieldName: null, regex: true, matchCase: true })).rejects.toThrow();
  });

  it("isteğe bağlı ters kart: Add Reverse doldurulunca kart üretilir", async () => {
    const t = await nt("basic-optional-reversed");
    const { note: n } = await addNote(db, { noteType: t, deckId: defaultDeckId(uid), fields: { front: "a", back: "b", "add-reverse": "" } });
    await findReplace(db, [n.id], { find: "^$", replace: "y", fieldName: "Add Reverse", regex: true, matchCase: true });
    expect(await db.cards.where("note_id").equals(n.id).count()).toBe(2);
  });
});

describe("zamanlama", () => {
  it("yeni kartları yeniden sırala: not başına sıra, kaydırma", async () => {
    const a = await note("a");
    now += 2000;
    const b = await note("b");
    now += 2000;
    const c = await note("c");
    await repositionNew(db, [b.cards[0].id, a.cards[0].id], { start: 0, step: 1, randomize: false, shift: true });
    const pos = async (x: typeof a) => (await db.cards.get(x.cards[0].id))!.position;
    expect([await pos(a), await pos(b)]).toEqual([0, 1]);
    expect(await pos(c)).toBe(c.cards[0].position + 2); // kaydırıldı
  });

  it("tarih ata: '0' bugün, '3!' aralık da 3, '1-7' aralıkta; geçmişe 'elle' kaydı", async () => {
    const a = await note("a");
    const b = await note("b");
    await setDueDate(db, [a.cards[0].id], "0", day());
    let c = (await db.cards.get(a.cards[0].id))!;
    expect(c.state).toBe(2);
    expect(c.due).toBe(day().dayStart);
    expect(c.interval_days).toBe(1);
    expect(c.stability).toBeGreaterThan(0);

    await setDueDate(db, [a.cards[0].id], "3!", day());
    c = (await db.cards.get(a.cards[0].id))!;
    expect(c.due).toBe(day().dayStart + 3 * DAY);
    expect(c.interval_days).toBe(3);

    await setDueDate(db, [b.cards[0].id], "1-7", day(), () => 0.99);
    expect((await db.cards.get(b.cards[0].id))!.due).toBe(day().dayStart + 7 * DAY);

    const logs = await db.review_logs.toArray();
    expect(logs).toHaveLength(3);
    expect(logs.every((l) => l.rating === 0 && l.kind === 4)).toBe(true);
    expect(parseDueSpec("abc")).toBeNull();
    expect(parseDueSpec("7-1")).toEqual({ min: 1, max: 7, setInterval: false });
    await expect(setDueDate(db, [a.cards[0].id], "x", day())).rejects.toThrow();
  });

  it("unut: yeni karta döner; sayaçlar istenirse sıfırlanır", async () => {
    const a = await note("a");
    await updateRow(db, "cards", a.cards[0].id, { state: 2, reps: 5, lapses: 1, interval_days: 10, stability: 12, due: now + DAY });
    await forgetCards(db, [a.cards[0].id], { restorePosition: true, resetCounts: false });
    let c = (await db.cards.get(a.cards[0].id))!;
    expect([c.state, c.interval_days, c.stability, c.reps, c.position]).toEqual([0, 0, 0, 5, a.cards[0].position]);
    await forgetCards(db, [a.cards[0].id], { restorePosition: false, resetCounts: true });
    c = (await db.cards.get(a.cards[0].id))!;
    expect([c.reps, c.lapses]).toEqual([0, 0]);
  });
});

describe("not tipi değiştir", () => {
  it("Basic → Basic (and reversed): alanlar eşlenir, kart korunur, ters kart üretilir", async () => {
    const a = await note("front-a", "back-a");
    await updateRow(db, "cards", a.cards[0].id, { state: 2, reps: 3 });
    const target = await nt("basic-reversed");
    await changeNoteType(db, [a.note.id], target, { fields: { front: "front", back: "back" }, templates: { 0: 0 } });
    const n = (await db.notes.get(a.note.id))!;
    expect(n.note_type_id).toBe(target.id);
    const cards = (await db.cards.where("note_id").equals(a.note.id).toArray()).filter((c) => c.deleted_at === null);
    expect(cards.map((c) => c.ord).sort()).toEqual([0, 1]);
    expect(cards.find((c) => c.ord === 0)!.reps).toBe(3); // geçmiş korundu
  });

  it("alanlar yer değiştirir; eşlenmeyen şablonun kartı silinir", async () => {
    const t = await nt("basic-reversed");
    const { note: n } = await addNote(db, { noteType: t, deckId: defaultDeckId(uid), fields: { front: "F", back: "B" } });
    const basic = await nt("basic");
    await changeNoteType(db, [n.id], basic, { fields: { front: "back", back: "front" }, templates: { 0: null, 1: 0 } });
    const after = (await db.notes.get(n.id))!;
    expect(after.fields).toEqual({ front: "B", back: "F" });
    const cards = (await db.cards.where("note_id").equals(n.id).toArray()).filter((c) => c.deleted_at === null);
    expect(cards).toHaveLength(1);
    expect(cards[0].ord).toBe(0);
  });

  it("farklı not tiplerinden notlar birlikte çevrilemez", async () => {
    const a = await note("a");
    const t = await nt("cloze");
    const { note: c } = await addNote(db, { noteType: t, deckId: defaultDeckId(uid), fields: { text: "{{c1::x}}" } });
    await expect(changeNoteType(db, [a.note.id, c.id], t as NoteTypeRow, { fields: {}, templates: {} })).rejects.toThrow();
  });
});

describe("kopyalar ve geri alma", () => {
  it("kopyaları bul: HTML'siz, büyük/küçük harf duyarsız", async () => {
    const a = await note("<b>Abandon</b>");
    const b = await note("abandon");
    await note("acquire");
    const basic = await nt("basic");
    const groups = findDuplicates(await db.notes.toArray(), basic.id, "front");
    expect(groups).toHaveLength(1);
    expect(groups[0].text.toLowerCase()).toBe("abandon");
    expect(new Set(groups[0].noteIds)).toEqual(new Set([a.note.id, b.note.id]));
  });

  it("toplu işlemler tek adımda geri alınır", async () => {
    const a = await note("a", "x", ["yds"]);
    const b = await note("b", "x", ["yds"]);
    const undo = new UndoManager(db);
    await undo.run("Etiket ekleme", () => addTags(db, [a.note.id, b.note.id], ["zor"]));
    await undo.run("Tarih atama", () => setDueDate(db, [a.cards[0].id, b.cards[0].id], "2", day()));
    await undo.undo();
    expect((await db.cards.get(a.cards[0].id))!.state).toBe(0);
    expect((await db.review_logs.toArray()).every((l) => l.deleted_at !== null)).toBe(true);
    await undo.undo();
    expect((await db.notes.get(b.note.id))!.tags).toEqual(["yds"]);
  });
});
