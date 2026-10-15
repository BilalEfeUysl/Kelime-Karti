import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { openLocalDB } from "@/lib/db/database";
import type { DeckRow } from "@/lib/db/types";
import { buildDeckTree, createDeckPath, deleteDeckTree, flattenDeckTree, moveDeck } from "@/lib/decks";
import { insertRow } from "@/lib/db/mutations";

function deck(id: string, name: string, parent_id: string | null, extra: Partial<DeckRow> = {}): DeckRow {
  return {
    id,
    user_id: "u",
    created_at: 0,
    updated_at: "x",
    deleted_at: null,
    name,
    parent_id,
    config_id: null,
    description: "",
    collapsed: false,
    is_filtered: false,
    filter: null,
    ...extra,
  };
}

describe("deste ağacı", () => {
  it("tam adları üst destelerden hesaplar ve alfabetik sıralar", () => {
    const tree = buildDeckTree([deck("b", "Fiiller", "a"), deck("a", "YDS", null), deck("c", "Edatlar", "a")]);
    expect(flattenDeckTree(tree).map((n) => n.fullName)).toEqual(["YDS", "YDS::Edatlar", "YDS::Fiiller"]);
  });

  it("üstü silinmiş deste en üste çıkar, döngüler kırılır", () => {
    const tree = buildDeckTree([
      deck("a", "Silinmiş", null, { deleted_at: 1 }),
      deck("b", "Yetim", "a"),
      deck("x", "X", "y"),
      deck("y", "Y", "x"),
    ]);
    const names = flattenDeckTree(tree).map((n) => n.fullName);
    expect(names).toContain("Yetim");
    expect(names).toHaveLength(3); // X ve Y kaybolmaz
  });

  it("'Ana::Alt' yolundan eksik seviyeleri oluşturur, var olanı tekrar kullanır, alt destelerle siler", async () => {
    const db = await openLocalDB("u1", { dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
    const fiiller = await createDeckPath(db, "YDS::Fiiller");
    const isimler = await createDeckPath(db, "yds :: İsimler");
    expect(isimler.parent_id).toBe(fiiller.parent_id);
    expect(await db.decks.count()).toBe(3);
    const deleted = await deleteDeckTree(db, fiiller.parent_id!);
    expect(deleted.decks).toBe(3);
    expect((await db.decks.toArray()).every((d) => d.deleted_at !== null)).toBe(true);
  });
});

describe("deste oluşturma yarışı", () => {
  it("aynı anda gelen iki istek aynı üst desteyi iki kez oluşturmaz (çift tıklama)", async () => {
    const db = await openLocalDB("u2", { dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
    await Promise.all([
      createDeckPath(db, "YDS::Fiiller"),
      createDeckPath(db, "YDS::İsimler"),
      createDeckPath(db, "YDS::Fiiller"),
    ]);
    const names = (await db.decks.toArray()).map((d) => d.name).sort();
    expect(names).toEqual(["Fiiller", "İsimler", "YDS"].sort());
  });
});

describe("deste taşıma ve kartlarıyla silme", () => {
  it("kendi altına taşınamaz; silinince kartlar ve sahipsiz notlar da silinir", async () => {
    const db = await openLocalDB("u3", { dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
    const child = await createDeckPath(db, "A::B");
    const other = await createDeckPath(db, "C");
    await expect(moveDeck(db, child.parent_id!, child.id)).rejects.toThrow();
    await moveDeck(db, child.id, other.id);
    expect((await db.decks.get(child.id))?.parent_id).toBe(other.id);

    const note = await insertRow(db, "notes", { note_type_id: "nt", guid: "g", fields: {} });
    const keep = await insertRow(db, "notes", { note_type_id: "nt", guid: "h", fields: {} });
    await insertRow(db, "cards", { note_id: note.id, deck_id: child.id });
    await insertRow(db, "cards", { note_id: keep.id, deck_id: child.id, ord: 0 });
    await insertRow(db, "cards", { note_id: keep.id, deck_id: child.parent_id!, ord: 1 });
    const r = await deleteDeckTree(db, other.id); // C ve altındaki B
    expect(r).toEqual({ decks: 2, cards: 2 });
    expect((await db.notes.get(note.id))?.deleted_at).not.toBeNull();
    expect((await db.notes.get(keep.id))?.deleted_at).toBeNull(); // başka destede kartı var
  });
});
