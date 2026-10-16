// Yöneticinin desteleri herkeste: yönetici kart ekleyince üyelere kopyası
// gelir, herkes kendi ilerlemesiyle çalışır, yöneticinin sonraki
// düzeltmeleri ve silmeleri de kopyalara gider.
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { insertRow, updateRow } from "@/lib/db/mutations";
import { createDeckPath } from "@/lib/decks";
import { addNote, deleteNotes, updateNote } from "@/lib/notes";
import { builtinNoteTypeId, ensureDefaults } from "@/lib/notetypes/builtins";
import { createTestClient, syncAll, TestTime } from "./helpers/client";
import { TestServer } from "./helpers/server";

let server: TestServer;
let time: TestTime;
let adminId: string;
let userId: string;

beforeAll(async () => {
  server = await TestServer.create();
});
afterAll(async () => {
  await server.pg.close();
});
beforeEach(async () => {
  await server.reset();
  time = new TestTime();
  adminId = await server.addUser("bilal@example.com", { role: "admin" });
  userId = await server.addUser("emre@example.com");
});

async function setup() {
  const admin = await createTestClient(server, adminId, time, { name: "bilal" });
  const user = await createTestClient(server, userId, time, { name: "emre" });
  await ensureDefaults(admin.db);
  await ensureDefaults(user.db);
  const basic = (await admin.db.note_types.get(builtinNoteTypeId("basic", adminId)))!;
  const deck = await createDeckPath(admin.db, "YDS::Fiiller");
  return { admin, user, basic, deck };
}

const alive = <T extends { deleted_at: number | null }>(rows: T[]) => rows.filter((r) => r.deleted_at === null);

it("yöneticinin destesi, kartları ve örnek cümleleri üyeye gelir; boş Varsayılan deste gelmez", async () => {
  const { admin, user, basic, deck } = await setup();
  await addNote(admin.db, {
    noteType: basic,
    deckId: deck.id,
    fields: { front: "abandon", back: "terk etmek" },
    examples: [{ text: "They abandoned the car.", translation: null }],
  });
  await syncAll(admin, user);

  const decks = alive(await user.db.decks.toArray()).map((d) => d.name).sort();
  expect(decks).toEqual(["Fiiller", "Varsayılan", "YDS"]); // Varsayılan üyenin kendi destesi
  const fiiller = alive(await user.db.decks.toArray()).find((d) => d.name === "Fiiller")!;
  const yds = alive(await user.db.decks.toArray()).find((d) => d.name === "YDS")!;
  expect(fiiller.parent_id).toBe(yds.id);

  const [note] = alive(await user.db.notes.toArray());
  expect(note.fields).toEqual({ front: "abandon", back: "terk etmek" });
  expect(await user.db.note_types.get(note.note_type_id)).toBeTruthy();
  const [card] = alive(await user.db.cards.toArray());
  expect(card).toMatchObject({ note_id: note.id, deck_id: fiiller.id, state: 0 });
  expect(alive(await user.db.note_examples.toArray()).map((e) => e.text)).toEqual(["They abandoned the car."]);

  // Yöneticide hiçbir şey kopyalanmaz
  expect(alive(await admin.db.notes.toArray())).toHaveLength(1);
});

it("herkes kendi ilerlemesiyle çalışır; yöneticinin düzeltmesi ve silmesi kopyaya gider", async () => {
  const { admin, user, basic, deck } = await setup();
  const { note } = await addNote(admin.db, { noteType: basic, deckId: deck.id, fields: { front: "abandon", back: "terk etmek" } });
  await syncAll(admin, user);

  // Üye kartını çalışır: zamanlaması yöneticininkinden bağımsız
  const [ucard] = alive(await user.db.cards.toArray());
  time.advance(60_000);
  await updateRow(user.db, "cards", ucard.id, { state: 2, reps: 1, due: user.db.now() + 86_400_000 });
  await syncAll(user, admin);
  const [acard] = alive(await admin.db.cards.toArray());
  expect(acard.state).toBe(0);

  // Yönetici anlamı düzeltir → üyeye gelir, üyenin ilerlemesi korunur
  time.advance(60_000);
  await updateNote(admin.db, note.id, { fields: { front: "abandon", back: "terk etmek, bırakmak" } });
  await syncAll(admin, user);
  expect(alive(await user.db.notes.toArray())[0].fields.back).toBe("terk etmek, bırakmak");
  expect((await user.db.cards.get(ucard.id))!).toMatchObject({ state: 2, reps: 1 });

  // Yönetici notu siler → üyede de silinir
  time.advance(60_000);
  await deleteNotes(admin.db, [note.id]);
  await syncAll(admin, user);
  expect(alive(await user.db.notes.toArray())).toHaveLength(0);
  expect(alive(await user.db.cards.toArray())).toHaveLength(0);
});

it("üyenin kendi destesi ve notları yöneticiye gitmez", async () => {
  const { admin, user } = await setup();
  await insertRow(user.db, "decks", { name: "Emre'nin destesi" });
  await syncAll(user, admin);
  expect(alive(await admin.db.decks.toArray()).map((d) => d.name)).not.toContain("Emre'nin destesi");
});

it("yönetici içerik gönderince üyeye haber gider (sync_heads); sadece cevap verince gitmez", async () => {
  const { admin, basic, deck } = await setup();
  const head = async () =>
    (await server.pg.query<{ n: number }>("select count(*)::int as n from public.sync_heads where user_id = $1", [userId])).rows[0].n;
  await server.pg.query("delete from public.sync_heads");
  const { cards } = await addNote(admin.db, { noteType: basic, deckId: deck.id, fields: { front: "abandon", back: "terk etmek" } });
  await admin.sync();
  expect(await head()).toBe(1);

  await server.pg.query("delete from public.sync_heads");
  time.advance(60_000);
  await updateRow(admin.db, "cards", cards[0].id, { state: 2, reps: 1 });
  await admin.sync();
  expect(await head()).toBe(0);
});
