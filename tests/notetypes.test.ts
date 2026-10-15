// Not tipi yöneticisi: alan/şablon değişikliklerinin notlara ve kartlara etkisi
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { type LocalDB, openLocalDB } from "@/lib/db/database";
import { updateRow } from "@/lib/db/mutations";
import type { NoteTypeRow } from "@/lib/db/types";
import { addNote } from "@/lib/notes";
import { builtinNoteTypeId, defaultDeckId, ensureDefaults } from "@/lib/notetypes/builtins";
import {
  blankField,
  blankTemplate,
  createNoteType,
  deleteNoteType,
  noteTypeImpact,
  renameFieldInTemplate,
  saveNoteType,
  validateNoteType,
} from "@/lib/notetypes/manage";

const uid = "00000000-0000-4000-8000-0000000000cc";
let db: LocalDB;
let basic: NoteTypeRow;

beforeEach(async () => {
  db = await openLocalDB(uid, { dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
  await ensureDefaults(db);
  basic = (await db.note_types.get(builtinNoteTypeId("basic", uid)))!;
});

const liveCards = async (noteId: string) =>
  (await db.cards.where("note_id").equals(noteId).toArray()).filter((c) => c.deleted_at === null).sort((a, b) => a.ord - b.ord);

describe("şablon yardımcıları", () => {
  it("alan adını şablonda değiştirir (koşul, filtre dahil)", () => {
    const t = "{{Front}} {{#Front}}x{{/Front}} {{^Front}}y{{/Front}} {{text:Front}} {{type:Front}} {{Frontal}} {{ Front }}";
    expect(renameFieldInTemplate(t, "Front", "Kelime")).toBe(
      "{{Kelime}} {{#Kelime}}x{{/Kelime}} {{^Kelime}}y{{/Kelime}} {{text:Kelime}} {{type:Kelime}} {{Frontal}} {{Kelime}}",
    );
  });

  it("doğrulama", () => {
    const ok = { ...basic };
    expect(validateNoteType(ok)).toBeNull();
    expect(validateNoteType({ ...ok, name: " " })).toMatch(/adı boş/);
    expect(validateNoteType({ ...ok, fields: [...ok.fields, { id: "z", name: "front" }] })).toMatch(/iki alan/);
    expect(validateNoteType({ ...ok, fields: [{ id: "z", name: "Tags" }] })).toMatch(/özel/);
    expect(validateNoteType({ ...ok, templates: [{ ...ok.templates[0], front: "{{#Front}}" }] })).toMatch(/ön yüz/);
    expect(validateNoteType({ ...ok, templates: [{ ...ok.templates[0], front: "sabit yazı" }] })).toMatch(/en az bir alan/);
  });
});

describe("not tipi kaydetme", () => {
  it("kopya oluşturma ve silme (notlarıyla birlikte)", async () => {
    const copy = await createNoteType(db, basic, "Kelime");
    expect(copy.id).not.toBe(basic.id);
    const { note } = await addNote(db, { noteType: copy, deckId: defaultDeckId(uid), fields: { front: "a", back: "b" } });
    expect(await deleteNoteType(db, copy.id)).toBe(1);
    expect((await db.notes.get(note.id))!.deleted_at).not.toBeNull();
    expect((await liveCards(note.id)).length).toBe(0);
  });

  it("şablon ekleme kart üretir; sıra değişince ord güncellenir; silme kartı siler", async () => {
    const { note, cards } = await addNote(db, { noteType: basic, deckId: defaultDeckId(uid), fields: { front: "a", back: "b" } });
    await updateRow(db, "cards", cards[0].id, { reps: 4 });
    const t2 = { ...blankTemplate("Ters", basic.fields), front: "{{Back}}" };

    // 1) Yeni şablon → ikinci kart
    await saveNoteType(db, basic.id, { ...basic, templates: [...basic.templates, t2] });
    let list = await liveCards(note.id);
    expect(list.map((c) => c.ord)).toEqual([0, 1]);

    // 2) Sıra değişir → eski kart (reps 4) artık ord 1
    const cur = (await db.note_types.get(basic.id))!;
    await saveNoteType(db, basic.id, { ...cur, templates: [cur.templates[1], cur.templates[0]] });
    list = await liveCards(note.id);
    expect(list.find((c) => c.id === cards[0].id)!.ord).toBe(1);

    // 3) Etki önizlemesi ve silme
    const cur2 = (await db.note_types.get(basic.id))!;
    const draft = { ...cur2, templates: [cur2.templates[1]] }; // "Card 1" kalsın, "Ters" silinsin
    const impact = await noteTypeImpact(db, cur2, draft);
    expect(impact).toMatchObject({ notes: 1, cardsRemoved: 1, removedTemplates: ["Ters"] });
    await saveNoteType(db, basic.id, draft);
    list = await liveCards(note.id);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(cards[0].id);
    expect(list[0].ord).toBe(0);
  });

  it("alan ekleme / sıralama alanı değişince notların sıralama metni yenilenir", async () => {
    const { note } = await addNote(db, { noteType: basic, deckId: defaultDeckId(uid), fields: { front: "a", back: "<i>bee</i>" } });
    const extra = blankField("Not");
    await saveNoteType(db, basic.id, { ...basic, fields: [...basic.fields, extra], sort_field: "back" });
    const n = (await db.notes.get(note.id))!;
    expect(n.sort_field).toBe("bee");
    const saved = (await db.note_types.get(basic.id))!;
    expect(saved.fields.map((f) => f.name)).toEqual(["Front", "Back", "Not"]);
    // Sıralama alanı silinirse ilk alana döner
    await saveNoteType(db, basic.id, { ...saved, fields: saved.fields.filter((f) => f.id !== "back"), templates: [{ ...saved.templates[0], back: "{{FrontSide}}" }] });
    expect((await db.notes.get(note.id))!.sort_field).toBe("a");
  });

  it("geçersiz değişiklik kaydedilmez", async () => {
    await expect(saveNoteType(db, basic.id, { ...basic, fields: [] })).rejects.toThrow(/En az bir alan/);
    expect((await db.note_types.get(basic.id))!.fields).toHaveLength(2);
  });
});
