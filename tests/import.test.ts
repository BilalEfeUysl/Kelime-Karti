import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApkg, SAMPLE, SAMPLE_CSV } from "../scripts/apkg-builder.mjs";
import { type LocalDB, openLocalDB } from "@/lib/db/database";
import { buildDeckTree, flattenDeckTree } from "@/lib/decks";
import { type AnkiImportOptions, convertScheduling, importAnkiPackage } from "@/lib/import/anki-writer";
import { parseAnkiPackage, readMedia } from "@/lib/import/anki-package";
import { detectDelimiter, importCsvRows, parseDelimited, readHeaders } from "@/lib/import/csv";
import { guessExampleField, guessWordField, splitExamples } from "@/lib/import/examples";
import { rewriteImageSources, stripSoundAndVideo } from "@/lib/import/html";
import { builtinNoteTypeId, defaultDeckId, ensureDefaults } from "@/lib/notetypes/builtins";
import { approvedExamples } from "@/lib/notes";
import { renderCard } from "@/lib/template/render";

let SQL: SqlJsStatic;
let legacy: Uint8Array;
let latest: Uint8Array;
let db: LocalDB;
const uid = "00000000-0000-4000-8000-000000000002";

beforeAll(async () => {
  SQL = await initSqlJs();
  legacy = await buildApkg("legacy");
  latest = await buildApkg("latest");
});

beforeEach(async () => {
  db = await openLocalDB(uid, { dexie: { indexedDB: new IDBFactory(), IDBKeyRange }, now: () => Date.UTC(2026, 9, 13, 9, 0) });
  await ensureDefaults(db);
});

const YDS_ID = SAMPLE.noteTypes[0].id;
const CLOZE_ID = SAMPLE.noteTypes[1].id;
const opts = (over: Partial<AnkiImportOptions> = {}): AnkiImportOptions => ({
  includeScheduling: true,
  duplicateMode: "update",
  examples: {
    [YDS_ID]: { wordFieldOrd: 0, exampleFieldOrd: 2, useExampleTag: true },
    [CLOZE_ID]: { wordFieldOrd: null, exampleFieldOrd: null, useExampleTag: false },
  },
  ...over,
});

async function run(file: Uint8Array, o = opts()) {
  const pkg = parseAnkiPackage(SQL, file);
  return importAnkiPackage(db, pkg, (names) => readMedia(file, pkg.media.filter((m) => names.includes(m.name))), o);
}

describe(".apkg ayrıştırma", () => {
  for (const [label, get] of [
    ["eski format (collection.anki2, şema 11)", () => legacy],
    ["yeni format (sahte anki2 + zstd'li anki21b, şema 18)", () => latest],
  ] as const) {
    it(label, () => {
      const pkg = parseAnkiPackage(SQL, get());
      expect(pkg.notes).toHaveLength(4); // sahte "lütfen güncelleyin" notu değil, asıl veri
      expect(pkg.cards).toHaveLength(5);
      expect(pkg.revlog).toHaveLength(4);
      const yds = pkg.noteTypes.find((n) => n.ankiId === YDS_ID)!;
      expect(yds.fields.map((f) => f.name)).toEqual(["Word", "Meaning", "Example", "Picture"]);
      expect(yds.templates[0].front).toBe("{{Word}}");
      expect(pkg.noteTypes.find((n) => n.ankiId === CLOZE_ID)?.kind).toBe("cloze");
      expect(pkg.decks.map((d) => d.name)).toContain("YDS::İsimler");
      expect(pkg.media.map((m) => m.name).sort()).toEqual(["abandon.mp3", "kedi.png"]);
      const media = readMedia(get(), pkg.media);
      expect(media.get("kedi.png")?.[1]).toBe(0x50); // PNG imzası ("P")
    });
  }
});

describe(".apkg içe aktarma", () => {
  it("geçmişle birlikte: notlar, kartlar, desteler, resimler, örnek cümleler", async () => {
    const s = await run(latest);
    expect(s).toMatchObject({
      notesAdded: 4,
      cardsAdded: 5,
      reviewLogsAdded: 4,
      imagesAdded: 1,
      soundsSkipped: 1,
      imagesTooLarge: 0,
      noteTypesAdded: 2,
      examplesAdded: 6,
    });
    const deckNames = flattenDeckTree(buildDeckTree(await db.decks.toArray()), true).map((n) => n.fullName);
    expect(deckNames).toEqual(expect.arrayContaining(["YDS", "YDS::Fiiller", "YDS::İsimler"]));

    const notes = await db.notes.toArray();
    const abandon = notes.find((n) => n.guid === "guid-abandon")!;
    expect(abandon.fields.anki0).toBe("abandon "); // [sound:…] temizlendi
    expect(abandon.fields.anki3).toMatch(/^<img src="kk-media\/[0-9a-f]{64}\.png">$/);
    expect(abandon.tags).toEqual(["yds", "fiil"]);
    expect((await approvedExamples(db, abandon.id)).map((e) => e.text)).toEqual(["They abandoned the car.", "Never abandon hope."]);
    const acquire = notes.find((n) => n.guid === "guid-acquire")!;
    expect((await approvedExamples(db, acquire.id)).map((e) => e.text)).toEqual(["She acquired a new skill.", "The company was acquired."]);

    const cards = await db.cards.toArray();
    const review = cards.find((c) => c.note_id === abandon.id)!;
    expect(review).toMatchObject({ state: 2, interval_days: 15, stability: 15.5, difficulty: 5.2, reps: 5, lapses: 1 });
    expect(cards.find((c) => c.suspended)?.ord).toBe(1);

    // Not tipi: "Example" alanı özelliğimizle çakışmasın diye yeniden adlandırıldı, kelime alanı seçildi
    const nt = (await db.note_types.toArray()).find((n) => n.name === "YDS Kelime")!;
    expect(nt.fields.map((f) => f.name)).toContain("Example (orijinal)");
    expect(nt.word_field).toBe("anki0");
    const rendered = renderCard({
      noteType: nt,
      note: abandon,
      cardOrd: 0,
      deckName: "YDS::Fiiller",
      examples: (await approvedExamples(db, abandon.id)).map((e) => ({ id: e.id, text: e.text, translation: e.translation })),
    });
    expect(rendered.answer).toContain("kk-example");
    expect(rendered.answer).toContain("Diğer örnekleri göster");
  });

  it("geçmiş olmadan: tüm kartlar yeni, geçmiş yok", async () => {
    const s = await run(legacy, opts({ includeScheduling: false }));
    expect(s.reviewLogsAdded).toBe(0);
    const cards = await db.cards.toArray();
    expect(cards.every((c) => c.state === 0 && !c.suspended)).toBe(true);
  });

  it("aynı paketi tekrar içe aktarma: atla / güncelle / kopya", async () => {
    await run(legacy);
    expect((await run(legacy, opts({ duplicateMode: "skip" }))).notesSkipped).toBe(4);
    expect(await db.notes.count()).toBe(4);

    const updated = await run(legacy, opts({ duplicateMode: "update" }));
    expect(updated.notesUpdated).toBe(4);
    expect(updated.cardsAdded).toBe(0);
    expect(await db.notes.count()).toBe(4);
    const abandon = (await db.notes.toArray()).find((n) => n.guid === "guid-abandon")!;
    expect(await approvedExamples(db, abandon.id)).toHaveLength(2); // çift eklenmedi

    const dup = await run(legacy, opts({ duplicateMode: "duplicate" }));
    expect(dup.notesAdded).toBe(4);
    expect(new Set((await db.notes.toArray()).map((n) => n.guid)).size).toBe(8);
    expect(await db.note_types.count()).toBe(8); // 6 hazır + 2 içe aktarılan (tekrar oluşmadı)
  });

  it("zamanlama dönüşümü: öğrenme (saniye) ve günlük öğrenme (gün)", () => {
    const crt = 1_767_229_200;
    const base = { ankiId: 1, noteId: 1, deckId: 1, ord: 0, ivl: 0, factor: 2500, reps: 1, lapses: 0, originalDeckId: 0, flags: 0, data: "" };
    const learn = convertScheduling({ ...base, type: 1, queue: 1, due: crt + 600 }, crt, []);
    expect(learn).toMatchObject({ state: 1, due: (crt + 600) * 1000, scheduled_days: 0 });
    const dayLearn = convertScheduling({ ...base, type: 3, queue: 3, due: 10 }, crt, []);
    expect(dayLearn).toMatchObject({ state: 3, due: (crt + 10 * 86400) * 1000, scheduled_days: 1 });
  });
});

describe("örnek cümle sihirbazı", () => {
  it("alan tahmini", () => {
    expect(guessWordField(["Front", "Back"])).toBe(0);
    expect(guessWordField(["Anlam", "Kelime", "Örnek"])).toBe(1);
    expect(guessExampleField(["Word", "Meaning", "Example Sentence"])).toBe(2);
    expect(guessExampleField(["Kelime", "Örnek Cümleler"])).toBe(1);
    expect(guessExampleField(["Front", "Back"])).toBeNull();
  });

  it("cümleleri böler: <br>, satır, numaralı, <li>", () => {
    expect(splitExamples("A first one.<br>Second one here.")).toEqual(["A first one.", "Second one here."]);
    expect(splitExamples("1) Bir cümle.\n2) İkinci cümle.")).toEqual(["Bir cümle.", "İkinci cümle."]);
    expect(splitExamples("<ol><li>One here</li><li>Two here</li></ol>")).toEqual(["One here", "Two here"]);
    expect(splitExamples("<div>Tek cümle var.</div>")).toEqual(["Tek cümle var."]);
    expect(splitExamples("")).toEqual([]);
  });

  it("HTML uyarlama: resim yolu, ses/video temizliği", () => {
    const map = new Map([["a b.png", "kk-media/x.png"]]);
    expect(rewriteImageSources('<img src="a%20b.png"> <img src=\'a b.png\' alt=x>', map)).toBe(
      '<img src="kk-media/x.png"> <img src="kk-media/x.png" alt=x>',
    );
    const s = stripSoundAndVideo('x [sound:a.mp3] <audio src="b.mp3"></audio><video controls><source src="c.mp4"></video> y');
    expect(s.html).toBe("x   y");
    expect(s.removed).toBe(3);
  });
});

describe("CSV / TXT", () => {
  it("başlıklar, ayırıcı tahmini, tırnaklı çok satırlı alan", () => {
    const { headers, body } = readHeaders(SAMPLE_CSV);
    expect(headers).toEqual({ delimiter: "\t", html: false, tagsColumn: 3 });
    expect(detectDelimiter(body)).toBe("\t");
    expect(detectDelimiter("a;b;c\nd;e;f")).toBe(";");
    const rows = parseDelimited(body, "\t");
    expect(rows).toHaveLength(4);
    expect(rows[1][2]).toBe("She acquired a new skill.\nThe company was acquired.");
    expect(parseDelimited('a,"b, c","d ""e"""', ",")).toEqual([["a", "b, c", 'd "e"']]);
  });

  it("satırları not olarak ekler: alanlar, etiketler, örnek + çeviri; boş satırı atlar", async () => {
    const { body } = readHeaders(SAMPLE_CSV);
    const noteType = (await db.note_types.get(builtinNoteTypeId("basic", uid)))!;
    const s = await importCsvRows(db, parseDelimited(body, "\t"), {
      noteType,
      deckId: defaultDeckId(uid),
      columns: [
        { kind: "field", fieldId: "front" },
        { kind: "field", fieldId: "back" },
        { kind: "example" },
        { kind: "tags" },
        { kind: "translation" },
      ],
      allowHtml: false,
      extraTags: ["csv"],
      skipFirstRow: false,
    });
    expect(s).toEqual({ notesAdded: 3, rowsSkipped: 1, cardsAdded: 3, examplesAdded: 3 });
    const abandon = (await db.notes.toArray()).find((n) => n.fields.front === "abandon")!;
    expect(abandon.tags).toEqual(["csv", "yds", "fiil"]);
    const [ex] = await approvedExamples(db, abandon.id);
    expect(ex).toMatchObject({ text: "They abandoned the car.", translation: "Arabayı terk ettiler." });
  });
});
