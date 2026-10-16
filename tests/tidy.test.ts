// Kartları düzenle: Word/karışık ön yüzleri kelime + okunuş + örnek cümle olarak ayırma
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { openLocalDB } from "@/lib/db/database";
import { insertRow, insertRows } from "@/lib/db/mutations";
import { renderCard } from "@/lib/template/render";
import { defaultDeckId, ensureDefaults } from "@/lib/notetypes/builtins";
import { cleanBack, findTidyCandidates, parseWordFront, tidyNoteType } from "@/lib/tidy";

const WORD = `<p class="MsoNormal"><span style="font-size:15.0pt;line-height:107%;font-family:\n&quot;Arial&quot;;color:red">handle </span><span style="font-size:\n15.0pt">(HÆN-dıl<span style="display:none;mso-hide:all">HH</span>) fiil, geçişli<o:p></o:p></span></p>\n\n<p class="MsoNormal"><span style="font-size:15.0pt"><o:p>&nbsp;</o:p></span></p>\n\n<p class="MsoNormal"><span style="font-size:15.0pt;color:black;mso-themecolor:text1">Our staff <span style="color:red">handle </span>discipline\nproblems effectively.<o:p></o:p></span></p>`;
const SIMPLE = `<font color="#ff0000">peer </font>(piyı) isim, sayılabilen<div><br></div><div>American children did less well than their <font color="#ff0000">peers </font>in Japan.<br></div><div><br></div><div>Everyone wants to be successful.<br></div>`;

describe("parseWordFront", () => {
  it("Word HTML", () => {
    expect(parseWordFront(WORD)).toEqual({ word: "handle", pron: "(HÆN-dıl) fiil, geçişli", examples: ["Our staff handle discipline problems effectively."] });
  });
  it("basit HTML, birden çok cümle", () => {
    expect(parseWordFront(SIMPLE)).toEqual({
      word: "peer",
      pron: "(piyı) isim, sayılabilen",
      examples: ["American children did less well than their peers in Japan.", "Everyone wants to be successful."],
    });
  });
  it("kırmızı yoksa parantezden ayır, baştaki numara atılır", () => {
    expect(parseWordFront("1. arrogant (Æ-rı-gınt) sıfat<div><br></div><div>He was arrogant.</div>")).toMatchObject({ word: "arrogant", pron: "(Æ-rı-gınt) sıfat" });
  });
  it("sadece ifade", () => {
    expect(parseWordFront("Don't let me down.")).toEqual({ word: "Don't let me down.", pron: "", examples: [] });
  });
  it("arka yüz temizliği", () => {
    expect(cleanBack("kaba, nezaketsiz.<div><br></div><div>Eş Anlamlıları: rude</div>")).toBe("<div>kaba, nezaketsiz.</div><div>Eş Anlamlıları: rude</div>");
  });
});

it("not tipini ve notları düzenler", async () => {
  const uid = "00000000-0000-4000-8000-0000000000ab";
  const db = await openLocalDB(uid, { dexie: { indexedDB: new IDBFactory(), IDBKeyRange }, now: () => Date.UTC(2026, 9, 15) });
  await ensureDefaults(db);
  const nt = await insertRow(db, "note_types", {
    name: "Temel",
    kind: "standard",
    fields: [{ id: "anki0", name: "Ön" }, { id: "anki1", name: "Geri" }],
    templates: [{ id: "t0", name: "Kart 1", front: "{{Ön}}", back: "{{FrontSide}}<hr id=answer>{{Geri}}" }],
    css: "",
    sort_field: "anki0",
    word_field: "anki0",
  });
  const notes = await insertRows(
    db,
    "notes",
    Array.from({ length: 10 }, (_, i) => ({ note_type_id: nt.id, guid: `g${i}`, fields: { anki0: i % 2 ? WORD : SIMPLE, anki1: "anlam" }, tags: [] })),
  );
  await insertRows(db, "cards", notes.map((n) => ({ note_id: n.id, deck_id: defaultDeckId(uid), ord: 0 })));
  const [c] = await findTidyCandidates(db);
  expect(c.messy).toBe(10);
  expect(await tidyNoteType(db, c)).toEqual({ notes: 10, examples: 15 });
  expect(await findTidyCandidates(db)).toEqual([]);
  const type = (await db.note_types.get(nt.id))!;
  const note = (await db.notes.get(notes[0].id))!;
  const ex = (await db.note_examples.where("note_id").equals(note.id).toArray()).sort((a, b) => a.position - b.position);
  const r = renderCard({ noteType: type, note, cardOrd: 0, deckName: "YDS", examples: ex });
  expect(note.sort_field).toBe("peer");
  expect(type.fields.map((f) => f.name)).toEqual(["Kelime", "Anlam", "Okunuş"]);
  expect(type.templates[0].back).toBe("{{FrontSide}}<hr id=answer>{{Anlam}}");
  expect(r.question).toContain('<div class="kk-pron">(piyı) isim, sayılabilen</div>');
  expect(r.question).toContain('<b class="kk-hl">peers</b> in Japan.');
  expect(r.question).not.toContain("Everyone");
  expect(r.answer).toMatch(/peers<\/b> in Japan[\s\S]*<hr id=answer>[\s\S]*anlam/);
});
