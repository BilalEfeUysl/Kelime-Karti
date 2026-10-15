// Faz 6: Anki'ye dışa aktarma (tam tur), metin, yedek/geri yükleme, bakım
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBackup, readBackup, restoreBackup } from "@/lib/backup";
import { type LocalDB, openLocalDB } from "@/lib/db/database";
import { insertRow, updateRow } from "@/lib/db/mutations";
import { exportAnki } from "@/lib/export/anki";
import { exportText } from "@/lib/export/text";
import { parseAnkiPackage, readMedia } from "@/lib/import/anki-package";
import { checkDatabase, findEmptyCards, findUnusedMedia, fixDatabase, issueCount } from "@/lib/maintenance";
import { addNote } from "@/lib/notes";
import { builtinNoteTypeId, defaultDeckId, ensureDefaults } from "@/lib/notetypes/builtins";
import { addMediaFile } from "@/lib/sync/media";

const uid = "00000000-0000-4000-8000-0000000000ee";
const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 15, 9, 0);
let db: LocalDB;
let SQL: SqlJsStatic;

beforeAll(async () => {
  SQL = await initSqlJs();
});
beforeEach(async () => {
  db = await openLocalDB(uid, { dexie: { indexedDB: new IDBFactory(), IDBKeyRange }, now: () => now });
  await ensureDefaults(db);
});

const nt = (k: Parameters<typeof builtinNoteTypeId>[0]) => db.note_types.get(builtinNoteTypeId(k, uid)).then((x) => x!);

async function sample() {
  const png = new TextEncoder().encode("sahte-png").buffer as ArrayBuffer;
  const media = await addMediaFile(db, png, "kedi.png", "image/png");
  const a = await addNote(db, {
    noteType: await nt("basic"),
    deckId: defaultDeckId(uid),
    fields: { front: "abandon", back: `terk etmek <img src="kk-media/${media.hash}.png">` },
    tags: ["yds"],
    examples: [{ text: "They abandoned the car.", translation: "Arabayı terk ettiler." }],
  });
  await updateRow(db, "cards", a.cards[0].id, { state: 2, interval_days: 12, due: now + 3 * DAY, ease: 2300, reps: 4, stability: 15, difficulty: 5.5, last_review: now - 9 * DAY });
  await insertRow(db, "review_logs", { card_id: a.cards[0].id, note_id: a.note.id, reviewed_at: now - 9 * DAY, rating: 3, kind: 1, interval_before: 4, interval_after: 12, ease: 2300, duration_ms: 5000 });
  const c = await addNote(db, { noteType: await nt("cloze"), deckId: defaultDeckId(uid), fields: { text: "{{c1::Water}} {{c2::scarcity}}" } });
  return { a, c, media };
}

async function exportIt(includeScheduling: boolean, examplesField: string | null) {
  return exportAnki(SQL, {
    noteTypes: await db.note_types.toArray(),
    notes: await db.notes.toArray(),
    cards: await db.cards.toArray(),
    decks: await db.decks.toArray(),
    examples: await db.note_examples.toArray(),
    logs: await db.review_logs.toArray(),
    includeScheduling,
    examplesField,
    getMedia: async (name) => {
      const blob = await db.media_blobs.get(name.split(".")[0]);
      return blob ? new Uint8Array(blob.data) : null;
    },
    now,
    dayZero: now - 100 * DAY,
  });
}

describe("Anki'ye dışa aktarma", () => {
  it("tam tur: notlar, kartlar, zamanlama, geçmiş, resim, örnek cümle alanı", async () => {
    const { media } = await sample();
    const out = await exportIt(true, "Examples");
    expect(out).toMatchObject({ notes: 2, cards: 3, media: 1, missingMedia: 0 });
    const pkg = parseAnkiPackage(SQL, out.bytes);
    expect(pkg.format).toBe("anki2");
    const basic = pkg.noteTypes.find((t) => t.name === "Basic")!;
    expect(basic.fields.map((f) => f.name)).toEqual(["Front", "Back", "Examples"]);
    expect(basic.templates[0].back).toContain("{{Examples}}");
    expect(basic.templates[0].back).not.toContain("{{Example}}");
    const n = pkg.notes.find((x) => x.fields[0] === "abandon")!;
    expect(n.fields[1]).toBe(`terk etmek <img src="${media.hash}.png">`);
    expect(n.fields[2]).toContain("They abandoned the car.");
    expect(n.tags).toEqual(["yds"]);
    const card = pkg.cards.find((c) => c.noteId === n.ankiId)!;
    expect(card).toMatchObject({ type: 2, queue: 2, ivl: 12, factor: 2300, reps: 4, due: 103 });
    expect(JSON.parse(card.data)).toEqual({ s: 15, d: 5.5 });
    expect(pkg.revlog).toHaveLength(1);
    expect(pkg.revlog[0]).toMatchObject({ ease: 3, ivl: 12, lastIvl: 4, type: 1 });
    expect(pkg.noteTypes.find((t) => t.name === "Cloze")!.kind).toBe("cloze");
    expect(pkg.media).toEqual([{ name: `${media.hash}.png`, entry: "0" }]);
    expect(new TextDecoder().decode((await readMedia(out.bytes, pkg.media)).get(`${media.hash}.png`)!)).toBe("sahte-png");
  });

  it("geçmiş hariç: hepsi yeni kart, sıra numarası 1'den; örnek yoksa şablondan kalkar", async () => {
    await sample();
    const out = await exportIt(false, null);
    const pkg = parseAnkiPackage(SQL, out.bytes);
    expect(pkg.cards.every((c) => c.type === 0 && c.queue === 0)).toBe(true);
    expect(pkg.cards.map((c) => c.due).sort()).toEqual([1, 2, 3]);
    expect(pkg.revlog).toHaveLength(0);
    expect(pkg.noteTypes.find((t) => t.name === "Basic")!.templates[0].back).not.toMatch(/Example/);
  });

  it("metin: Anki başlıkları ve tırnaklı alanlar", async () => {
    await sample();
    const { text, notes } = exportText({
      notes: await db.notes.toArray(),
      cards: await db.cards.toArray(),
      noteTypes: await db.note_types.toArray(),
      decks: await db.decks.toArray(),
      examples: await db.note_examples.toArray(),
      html: false,
      includeExamples: true,
    });
    expect(notes).toBe(2);
    const lines = text.trim().split("\n");
    expect(lines.slice(0, 5)).toEqual(["#separator:tab", "#html:false", "#notetype column:1", "#deck column:2", "#tags column:6"]);
    expect(lines).toContain("Basic\tVarsayılan\tabandon\tterk etmek\tThey abandoned the car. — Arabayı terk ettiler.\tyds");
  });
});

describe("yedek", () => {
  it("oluştur → sil → geri yükle", async () => {
    const { a } = await sample();
    const { bytes, summary } = await createBackup(db, { includeMedia: true });
    expect(summary).toMatchObject({ notes: 2, cards: 3, review_logs: 1, media: 1 });
    const fresh = await openLocalDB(uid, { dexie: { indexedDB: new IDBFactory(), IDBKeyRange }, now: () => now });
    const r = await restoreBackup(fresh, readBackup(bytes));
    expect(r).toMatchObject({ notes: 2, cards: 3, review_logs: 1, media: 1 });
    expect((await fresh.cards.get(a.cards[0].id))!.interval_days).toBe(12);
    expect(await fresh.outbox.count()).toBeGreaterThan(0); // eşlenecek
    expect(() => readBackup(new TextEncoder().encode("{}"))).toThrow();
  });
});

describe("bakım", () => {
  it("öksüz kart, kayıp deste, kartsız not, boş kart ve kullanılmayan resim bulunur ve düzeltilir", async () => {
    const { a, c } = await sample();
    const orphan = await insertRow(db, "cards", { note_id: crypto.randomUUID(), deck_id: defaultDeckId(uid) });
    await updateRow(db, "cards", a.cards[0].id, { deck_id: crypto.randomUUID() });
    await updateRow(db, "notes", c.note.id, { fields: { text: "{{c1::Water}} scarcity" } }); // c2 boşaldı
    const lonely = await insertRow(db, "notes", { note_type_id: builtinNoteTypeId("basic", uid), guid: "x", fields: { front: "yalnız", back: "" } });
    await addMediaFile(db, new TextEncoder().encode("kullanılmayan").buffer as ArrayBuffer, "x.png", "image/png");

    const report = await checkDatabase(db);
    expect(report.orphanCards.map((x) => x.id)).toEqual([orphan.id]);
    expect(report.lostDeckCards).toHaveLength(1);
    expect(report.cardlessNotes.map((n) => n.id)).toEqual([lonely.id]);
    expect((await findEmptyCards(db)).map((e) => e.card.ord)).toEqual([1]);
    expect(await findUnusedMedia(db)).toHaveLength(1);

    await fixDatabase(db, report);
    expect(issueCount(await checkDatabase(db))).toBe(0);
    expect((await db.cards.get(a.cards[0].id))!.deck_id).toBe(defaultDeckId(uid));
    expect(await db.cards.where("note_id").equals(lonely.id).count()).toBe(1);
  });
});
