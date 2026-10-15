import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { type LocalDB, openLocalDB } from "@/lib/db/database";
import { softDeleteRows } from "@/lib/db/mutations";
import { addNote, approvedExamples, deleteNotes, saveExamples, updateNote } from "@/lib/notes";
import { builtinNoteTypeId, defaultDeckId, ensureDefaults } from "@/lib/notetypes/builtins";
import { DEFAULT_DECK_OPTIONS } from "@/lib/scheduler/config";
import { buryCards, chooseExample, recordAnswer, setSuspended, toggleFlag, toggleMark } from "@/lib/study/actions";
import { UndoManager } from "@/lib/undo";

let db: LocalDB;
let now = Date.UTC(2026, 9, 13, 9, 0);
const uid = "00000000-0000-4000-8000-000000000001";

beforeEach(async () => {
  now = Date.UTC(2026, 9, 13, 9, 0);
  db = await openLocalDB(uid, { dexie: { indexedDB: new IDBFactory(), IDBKeyRange }, now: () => now });
  await ensureDefaults(db);
});

const nt = (key: Parameters<typeof builtinNoteTypeId>[0]) => db.note_types.get(builtinNoteTypeId(key, uid)).then((n) => n!);

describe("varsayılanlar", () => {
  it("hazır not tipleri, varsayılan deste ve preset bir kez oluşturulur; silinen geri gelmez", async () => {
    expect(await db.note_types.count()).toBe(6);
    expect(await db.decks.get(defaultDeckId(uid))).toBeDefined();
    await ensureDefaults(db);
    expect(await db.note_types.count()).toBe(6);
    await softDeleteRows(db, "note_types", [builtinNoteTypeId("cloze", uid)]);
    await ensureDefaults(db);
    expect((await db.note_types.get(builtinNoteTypeId("cloze", uid)))?.deleted_at).not.toBeNull();
  });
});

describe("not ekleme / düzenleme / silme", () => {
  it("ters kartlı not 2 kart üretir; örnek cümleler kaydedilir", async () => {
    const { note, cards } = await addNote(db, {
      noteType: await nt("basic-reversed"),
      deckId: defaultDeckId(uid),
      fields: { front: "abandon", back: "terk etmek" },
      tags: ["yds", "fiil", "YDS"],
      examples: [{ text: "They abandoned the car.", translation: "Arabayı terk ettiler." }, { text: "  ", translation: null }],
    });
    expect(cards.map((c) => c.ord)).toEqual([0, 1]);
    expect(note.tags).toEqual(["yds", "fiil"]);
    expect(note.sort_field).toBe("abandon");
    expect((await approvedExamples(db, note.id)).map((e) => e.text)).toEqual(["They abandoned the car."]);
  });

  it("ön yüzü boş not reddedilir", async () => {
    await expect(addNote(db, { noteType: await nt("basic"), deckId: defaultDeckId(uid), fields: { front: "", back: "x" } })).rejects.toThrow(
      /kart oluşmuyor/,
    );
  });

  it("cloze notuna yeni c2 eklenince yeni kart üretilir", async () => {
    const { note } = await addNote(db, { noteType: await nt("cloze"), deckId: defaultDeckId(uid), fields: { text: "{{c1::a}} b", "back-extra": "" } });
    const r = await updateNote(db, note.id, { fields: { text: "{{c1::a}} {{c2::b}}", "back-extra": "" } });
    expect(r.newCards).toBe(1);
    const ords = (await db.cards.where("note_id").equals(note.id).toArray()).map((c) => c.ord).sort();
    expect(ords).toEqual([0, 1]);
  });

  it("örnek cümleler: düzenle, sırala, sil", async () => {
    const { note } = await addNote(db, {
      noteType: await nt("basic"),
      deckId: defaultDeckId(uid),
      fields: { front: "a", back: "b" },
      examples: [{ text: "bir", translation: null }, { text: "iki", translation: null }],
    });
    const [e1, e2] = await approvedExamples(db, note.id);
    await saveExamples(db, note.id, [{ id: e2.id, text: "iki (düzeltildi)", translation: "2" }, { text: "üç", translation: null }]);
    const after = await approvedExamples(db, note.id);
    expect(after.map((e) => e.text)).toEqual(["iki (düzeltildi)", "üç"]);
    expect((await db.note_examples.get(e1.id))?.deleted_at).not.toBeNull();
  });

  it("not silinince kartları ve örnekleri de silinir", async () => {
    const { note, cards } = await addNote(db, {
      noteType: await nt("basic"),
      deckId: defaultDeckId(uid),
      fields: { front: "a", back: "b" },
      examples: [{ text: "x", translation: null }],
    });
    await deleteNotes(db, [note.id]);
    expect((await db.notes.get(note.id))?.deleted_at).not.toBeNull();
    expect((await db.cards.get(cards[0].id))?.deleted_at).not.toBeNull();
    expect(await approvedExamples(db, note.id)).toEqual([]);
  });
});

describe("çalışma eylemleri ve geri al", () => {
  async function oneCard() {
    const { cards, note } = await addNote(db, { noteType: await nt("basic"), deckId: defaultDeckId(uid), fields: { front: "a", back: "b" } });
    return { card: cards[0], note };
  }

  it("cevap kartı günceller ve geçmişe yazar; geri al ikisini de geri çevirir, yinele tekrar uygular", async () => {
    const { card } = await oneCard();
    const undo = new UndoManager(db);
    now += 1000;
    await undo.run("Cevap", () => recordAnswer(db, card, 3, DEFAULT_DECK_OPTIONS, { durationMs: 4000, exampleId: null }), {
      cardId: card.id,
    });
    const answered = (await db.cards.get(card.id))!;
    expect(answered.state).toBe(1);
    expect(await db.review_logs.count()).toBe(1);
    expect(undo.undoLabel).toBe("Cevap");

    now += 1000;
    const step = await undo.undo();
    expect(step?.meta?.cardId).toBe(card.id);
    const restored = (await db.cards.get(card.id))!;
    expect(restored.state).toBe(0);
    expect(restored.reps).toBe(0);
    expect(restored.sched_updated_at > answered.sched_updated_at).toBe(true); // geri alma da eşlenir
    const log = (await db.review_logs.toArray())[0];
    expect(log.deleted_at).not.toBeNull();
    expect(log.rating).toBe(3);

    // Yinele: kart tekrar cevaplanmış hâle gelir, geçmişe aynı içerikli YENİ kayıt eklenir
    now += 1000;
    await undo.redo();
    expect((await db.cards.get(card.id))!.state).toBe(1);
    const live = (await db.review_logs.toArray()).filter((l) => l.deleted_at === null);
    expect(live).toHaveLength(1);
    expect(live[0].rating).toBe(3);
    expect(live[0].id).not.toBe(log.id);

    // Tekrar geri al: yeni kayıt da silindi işaretlenir
    await undo.undo();
    expect((await db.review_logs.toArray()).every((l) => l.deleted_at !== null)).toBe(true);
    expect((await db.cards.get(card.id))!.state).toBe(0);
  });

  it("göm, askıya al, bayrak, işaretle ve sırayla geri al", async () => {
    const { card, note } = await oneCard();
    const undo = new UndoManager(db);
    await undo.run("Gömme", () => buryCards(db, [card.id], now + 86_400_000));
    await undo.run("Askıya alma", () => setSuspended(db, [card.id], true));
    await undo.run("Bayrak", () => toggleFlag(db, [card.id], 2));
    let c = (await db.cards.get(card.id))!;
    expect([c.buried_until !== null, c.suspended, c.flags]).toEqual([true, true, 2]);

    await undo.run("İşaretleme", () => toggleMark(db, note.id));
    expect((await db.notes.get(note.id))!.tags).toContain("marked");
    expect((await undo.undo())?.label).toBe("İşaretleme");
    expect((await db.notes.get(note.id))!.tags).not.toContain("marked");

    for (const label of ["Bayrak", "Askıya alma", "Gömme"]) expect((await undo.undo())?.label).toBe(label);
    c = (await db.cards.get(card.id))!;
    expect([c.buried_until, c.suspended, c.flags]).toEqual([null, false, 0]);
    expect(undo.canUndo).toBe(false);
    expect(undo.redoLabel).toBe("Gömme");

    // Yeni bir işlem yinele yığınını temizler
    await undo.run("Bayrak", () => toggleFlag(db, [card.id], 1));
    expect(undo.canRedo).toBe(false);
  });

  it("not silme geri alınınca not, kartları ve örnekleri geri gelir; ekleme geri alınınca silinir", async () => {
    const undo = new UndoManager(db);
    const { note } = await undo.run("Not ekleme", () =>
      nt("basic").then((noteType) =>
        addNote(db, {
          noteType,
          deckId: defaultDeckId(uid),
          fields: { front: "x", back: "y" },
          examples: [{ text: "örnek bir", translation: null }],
        }),
      ),
    );
    await undo.run("Not silme", () => deleteNotes(db, [note.id]));
    expect((await db.notes.get(note.id))!.deleted_at).not.toBeNull();
    await undo.undo();
    expect((await db.notes.get(note.id))!.deleted_at).toBeNull();
    expect((await db.cards.where("note_id").equals(note.id).toArray()).every((c) => c.deleted_at === null)).toBe(true);
    expect(await approvedExamples(db, note.id)).toHaveLength(1);
    await undo.undo(); // eklemeyi geri al
    expect((await db.notes.get(note.id))!.deleted_at).not.toBeNull();
    expect((await db.cards.where("note_id").equals(note.id).toArray()).every((c) => c.deleted_at !== null)).toBe(true);
  });

  it("50'den fazla işlemde en eskiler düşer", async () => {
    const { card } = await oneCard();
    const undo = new UndoManager(db);
    for (let i = 0; i < 55; i++) await undo.run(`Bayrak ${i}`, () => toggleFlag(db, [card.id], 1));
    let n = 0;
    while (await undo.undo()) n++;
    expect(n).toBe(50);
  });

  it("örnek cümle seçimi bir öncekini tekrar etmez", () => {
    const ex = ["a", "b", "c"].map((id) => ({ id }) as never);
    for (let i = 0; i < 20; i++) expect(chooseExample(ex, "b")).not.toBe("b");
    expect(chooseExample([{ id: "a" } as never], "a")).toBe("a");
    expect(chooseExample([], null)).toBeNull();
  });
});
