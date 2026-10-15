// Arama sözdizimi: ayrıştırıcı + cihazdaki verilere uygulama
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeAll, describe, expect, it } from "vitest";
import { type LocalDB, openLocalDB } from "@/lib/db/database";
import { insertRow, updateRow } from "@/lib/db/mutations";
import type { CardRow } from "@/lib/db/types";
import { createDeckPath } from "@/lib/decks";
import { addNote } from "@/lib/notes";
import { builtinNoteTypeId, defaultDeckId, ensureDefaults } from "@/lib/notetypes/builtins";
import { getDayInfo } from "@/lib/scheduler/day";
import { type SearchData, foldAccents, needsLogs, searchCards } from "@/lib/search/evaluate";
import { parseSearch, quoteSearchValue, SearchError } from "@/lib/search/parser";

const uid = "00000000-0000-4000-8000-0000000000aa";
const DAY = 86_400_000;
let now = Date.UTC(2026, 9, 15, 9, 0); // İstanbul 12:00
let db: LocalDB;
const ids: Record<string, string> = {}; // kelime → not id

async function data(): Promise<SearchData> {
  const examples = await db.note_examples.toArray();
  const exampleCounts = new Map<string, number>();
  for (const e of examples) if (e.deleted_at === null && e.approved) exampleCounts.set(e.note_id, (exampleCounts.get(e.note_id) ?? 0) + 1);
  return {
    cards: await db.cards.toArray(),
    notes: await db.notes.toArray(),
    noteTypes: await db.note_types.toArray(),
    decks: await db.decks.toArray(),
    exampleCounts,
    logs: await db.review_logs.toArray(),
    now,
    day: getDayInfo(now, "Europe/Istanbul", 4),
  };
}

/** Aramanın bulduğu notların ilk alanları (sıralı) */
async function words(q: string): Promise<string[]> {
  const d = await data();
  const cards = searchCards(q, d);
  const byId = new Map(d.notes.map((n) => [n.id, n]));
  return [...new Set(cards.map((c) => byId.get(c.note_id)!.sort_field))].sort();
}

beforeAll(async () => {
  db = await openLocalDB(uid, { dexie: { indexedDB: new IDBFactory(), IDBKeyRange }, now: () => now });
  await ensureDefaults(db);
  const basic = (await db.note_types.get(builtinNoteTypeId("basic", uid)))!;
  const reversed = (await db.note_types.get(builtinNoteTypeId("basic-reversed", uid)))!;
  const cloze = (await db.note_types.get(builtinNoteTypeId("cloze", uid)))!;
  const fiiller = await createDeckPath(db, "YDS::Fiiller");
  const isimler = await createDeckPath(db, "YDS::İsimler");
  const okuma = await createDeckPath(db, "Okuma Metni");

  const add = async (nt: typeof basic, deck: string, front: string, back: string, tags: string[] = [], ex = 0) => {
    const { note } = await addNote(db, {
      noteType: nt,
      deckId: deck,
      fields: nt.kind === "cloze" ? { text: front, "back-extra": back } : { front, back },
      tags,
      examples: Array.from({ length: ex }, (_, i) => ({ text: `${front} örnek ${i}`, translation: null })),
    });
    ids[front] = note.id;
    return note;
  };
  await add(basic, fiiller.id, "abandon", "terk etmek", ["yds::fiil", "zor"], 2);
  await add(basic, fiiller.id, "acquire", "<b>edinmek</b>, elde etmek", ["yds::fiil"], 1);
  await add(reversed, isimler.id, "benefit", "fayda", ["yds::isim"]);
  await add(basic, okuma.id, "naïve café", "saf kafe", []);
  await add(basic, defaultDeckId(uid), "kitap_raf*", "kitaplık", ["marked"]);
  await add(cloze, okuma.id, "The {{c1::scarcity}} of {{c2::water}}", "", ["cloze"]);
  await add(basic, isimler.id, "Işık", "light", []);

  // Durumlar: abandon → tekrar kartı (ivl 12, 3 gün sonra), askıda; acquire → öğrenme, bayrak 2
  const card = async (word: string, ord = 0) =>
    (await db.cards.where("note_id").equals(ids[word]).toArray()).find((c) => c.ord === ord)!;
  const ab = await card("abandon");
  await updateRow(db, "cards", ab.id, {
    state: 2,
    due: now + 3 * DAY,
    interval_days: 12,
    stability: 15,
    difficulty: 5.5,
    reps: 6,
    lapses: 2,
    ease: 2300,
    last_review: now - 9 * DAY,
    suspended: true,
  });
  const ac = await card("acquire");
  await updateRow(db, "cards", ac.id, { state: 1, due: now - 60_000, reps: 1, flags: 2, last_review: now - 60_000, stability: 1, difficulty: 6 });
  const be = await card("benefit", 1);
  await updateRow(db, "cards", be.id, { buried_until: now + DAY });
  // Geçmiş: acquire bugün "İyi"; abandon 3 gün önce "Tekrar" (ilk tekrarı 20 gün önce)
  await insertRow(db, "review_logs", { card_id: ac.id, note_id: ids.acquire, reviewed_at: now - 60_000, rating: 3 });
  await insertRow(db, "review_logs", { card_id: ab.id, note_id: ids.abandon, reviewed_at: now - 3 * DAY, rating: 1 });
  await insertRow(db, "review_logs", { card_id: ab.id, note_id: ids.abandon, reviewed_at: now - 20 * DAY, rating: 3 });
  // Işık eski bir not (eklenme 10 gün önce)
  const isik = await card("Işık");
  await db.cards.update(isik.id, { created_at: now - 10 * DAY } as Partial<CardRow>);
});

describe("ayrıştırıcı", () => {
  it("ve / veya / değil / parantez", () => {
    expect(parseSearch("a b")).toEqual({
      type: "and",
      children: [
        { type: "term", term: { kind: "text", pattern: "a" } },
        { type: "term", term: { kind: "text", pattern: "b" } },
      ],
    });
    const n = parseSearch("-(a or b) and c");
    expect(n.type).toBe("and");
    expect(parseSearch("a OR b").type).toBe("or");
    expect(parseSearch("-a")).toEqual({ type: "not", child: { type: "term", term: { kind: "text", pattern: "a" } } });
    expect(parseSearch("")).toEqual({ type: "all" });
  });

  it("tırnak ve kaçışlar", () => {
    expect(parseSearch('"deck:a b"')).toEqual({ type: "term", term: { kind: "deck", pattern: "a b" } });
    expect(parseSearch('deck:"a b"')).toEqual({ type: "term", term: { kind: "deck", pattern: "a b" } });
    expect(parseSearch('"a \\"b\\""')).toEqual({ type: "term", term: { kind: "text", pattern: 'a "b"' } });
    expect(parseSearch("a\\:b")).toEqual({ type: "term", term: { kind: "text", pattern: "a:b" } });
    expect(parseSearch('"or"')).toEqual({ type: "term", term: { kind: "text", pattern: "or" } });
  });

  it("anahtarlar", () => {
    expect(parseSearch("prop:ivl>=10")).toEqual({ type: "term", term: { kind: "prop", prop: "ivl", op: ">=", value: 10 } });
    expect(parseSearch("rated:7:1")).toEqual({ type: "term", term: { kind: "rated", days: 7, ease: 1 } });
    expect(parseSearch("examples<3")).toEqual({ type: "term", term: { kind: "examples", op: "<", value: 3 } });
    expect(parseSearch("examples:0")).toEqual({ type: "term", term: { kind: "examples", op: "=", value: 0 } });
    expect(parseSearch("front:re:^a")).toEqual({ type: "term", term: { kind: "field", field: "front", pattern: "^a", regex: true } });
    expect(parseSearch("dupe:Basic,abandon")).toEqual({ type: "term", term: { kind: "dupe", noteType: "Basic", text: "abandon" } });
  });

  it("hatalar anlaşılır Türkçe mesajla", () => {
    for (const bad of ["(a", "a)", '"a', "is:foo", "flag:9", "prop:xyz>1", "rated:abc", "a or", "()"]) {
      expect(() => parseSearch(bad), bad).toThrow(SearchError);
    }
  });

  it("geçmiş gerekiyor mu", () => {
    expect(needsLogs(parseSearch("a -rated:1"))).toBe(true);
    expect(needsLogs(parseSearch("a deck:b"))).toBe(false);
  });

  it("değer tırnaklama", () => {
    expect(quoteSearchValue("YDS::Fiiller")).toBe("YDS::Fiiller");
    expect(quoteSearchValue("Okuma Metni")).toBe('"Okuma Metni"');
    expect(parseSearch(`deck:${quoteSearchValue("a_b*")}`)).toEqual({ type: "term", term: { kind: "deck", pattern: "a\\_b\\*" } });
  });

  it("aksan sadeleştirme", () => {
    expect(foldAccents("Işık naïve ŞEKER")).toBe("isik naive seker");
  });
});

describe("arama sonuçları", () => {
  it("düz metin, tam ifade, joker, HTML'siz", async () => {
    expect(await words("abandon")).toEqual(["abandon"]);
    expect(await words("ABANDON")).toEqual(["abandon"]);
    expect(await words("edinmek")).toEqual(["acquire"]); // <b> içinde
    expect(await words('"elde etmek"')).toEqual(["acquire"]);
    expect(await words("a*on")).toEqual(["abandon"]);
    expect(await words("fay_a")).toEqual(["benefit"]);
    expect(await words("kitap\\_raf\\*")).toEqual(["kitap_raf*"]);
    expect(await words("kitap_raf*")).toEqual(["kitap_raf*"]);
  });

  it("olumsuzlama, or, parantez", async () => {
    expect(await words("deck:YDS -tag:zor")).toEqual(["Işık", "acquire", "benefit"]);
    expect(await words("abandon or benefit")).toEqual(["abandon", "benefit"]);
    expect(await words("(abandon or benefit) tag:yds::isim")).toEqual(["benefit"]);
    expect(await words("-(deck:YDS or deck:Okuma*)")).toEqual(["kitap_raf*"]);
  });

  it("deck: alt desteleri kapsar, joker ve tırnak", async () => {
    expect(await words("deck:YDS")).toEqual(["Işık", "abandon", "acquire", "benefit"]);
    expect(await words("deck:YDS::Fiiller")).toEqual(["abandon", "acquire"]);
    expect(await words("deck:yds::fii*")).toEqual(["abandon", "acquire"]);
    expect(await words('deck:"Okuma Metni"')).toEqual(["The {{c1::scarcity}} of {{c2::water}}", "naïve café"]);
    expect(await words("deck:Varsayılan")).toEqual(["kitap_raf*"]);
  });

  it("tag: hiyerarşik, joker, none", async () => {
    expect(await words("tag:yds")).toEqual(["abandon", "acquire", "benefit"]);
    expect(await words("tag:yds::fiil")).toEqual(["abandon", "acquire"]);
    expect(await words("tag:YDS::İ*")).toEqual(["benefit"]);
    expect(await words("tag:none")).toEqual(["Işık", "naïve café"]);
    expect(await words("tag:marked")).toEqual(["kitap_raf*"]);
  });

  it("note:, card:, alan:değer", async () => {
    expect(await words("note:Cloze")).toEqual(["The {{c1::scarcity}} of {{c2::water}}"]);
    expect(await words("note:basic*")).toHaveLength(6);
    const d = await data();
    expect(searchCards("card:2", d)).toHaveLength(2); // ters kart + c2
    expect(searchCards("card:Card*2 note:*reversed*", d)).toHaveLength(1);
    expect(await words("back:fayda")).toEqual(["benefit"]);
    expect(await words("back:fay")).toEqual([]); // alan araması tam eşleşme
    expect(await words("back:*etmek*")).toEqual(["abandon", "acquire"]);
    expect(await words("front:re:^ac")).toEqual(["acquire"]);
    expect(await words("b*k:fayda")).toEqual(["benefit"]); // alan adında joker
  });

  it("is:, flag:", async () => {
    expect(await words("is:suspended")).toEqual(["abandon"]);
    expect(await words("is:learn")).toEqual(["acquire"]);
    expect(await words("is:review")).toEqual(["abandon"]);
    expect(await words("is:due")).toEqual(["acquire"]); // abandon 3 gün sonra + askıda
    expect(await words("flag:2")).toEqual(["acquire"]);
    const d = await data();
    expect(searchCards("is:buried", d)).toHaveLength(1);
    expect(searchCards("is:new", d).length).toBeGreaterThan(5);
  });

  it("prop:", async () => {
    expect(await words("prop:ivl>=10")).toEqual(["abandon"]);
    expect(await words("prop:ivl<10")).toEqual(["acquire"]); // yeni kartlar hariç
    expect(await words("prop:due=3")).toEqual(["abandon"]);
    expect(await words("prop:lapses>1")).toEqual(["abandon"]);
    expect(await words("prop:reps=1")).toEqual(["acquire"]);
    expect(await words("prop:ease<2.4")).toEqual(["abandon"]);
    expect(await words("prop:s>10")).toEqual(["abandon"]);
    expect(await words("prop:d=0.5")).toEqual(["abandon"]);
    expect(await words("prop:r<0.99")).toEqual(["abandon"]);
    expect(await words("prop:r>0.99")).toEqual(["acquire"]);
  });

  it("rated:, introduced:, added:, edited:", async () => {
    expect(await words("rated:1")).toEqual(["acquire"]);
    expect(await words("rated:4")).toEqual(["abandon", "acquire"]);
    expect(await words("rated:7:1")).toEqual(["abandon"]);
    expect(await words("introduced:1")).toEqual(["acquire"]);
    expect(await words("introduced:30")).toEqual(["abandon", "acquire"]);
    expect(await words("-added:5")).toEqual(["Işık"]);
    expect((await words("edited:1")).length).toBe(7);
  });

  it("re:, nc:, dupe:, examples, nid:", async () => {
    expect(await words("re:^ter")).toEqual(["abandon"]);
    expect(await words("nc:naive")).toEqual(["naïve café"]);
    expect(await words("nc:isik")).toEqual(["Işık"]);
    expect(await words("naive")).toEqual([]);
    expect(await words("dupe:Basic,ABANDON")).toEqual(["abandon"]);
    expect(await words("examples:0")).toHaveLength(5);
    expect(await words("examples>=1")).toEqual(["abandon", "acquire"]);
    expect(await words("examples<2 tag:yds")).toEqual(["acquire", "benefit"]);
    expect(await words(`nid:${ids.benefit},${ids.abandon}`)).toEqual(["abandon", "benefit"]);
  });

  it("geçersiz düzenli ifade hata verir", async () => {
    const d = await data();
    expect(() => searchCards("re:(", d)).toThrow(SearchError);
  });
});
