// Faz 4: klasik algoritma, yük dengeleme, sınırlar, filtreli deste, sülük, kardeşler, istatistik
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { type LocalDB, openLocalDB } from "@/lib/db/database";
import { updateRow } from "@/lib/db/mutations";
import type { CardRow, DeckRow } from "@/lib/db/types";
import { createDeckPath } from "@/lib/decks";
import { buildFilteredDeck, createFilteredDeck, emptyFilteredDeck } from "@/lib/filtered";
import { addNote } from "@/lib/notes";
import { builtinNoteTypeId, defaultDeckId, ensureDefaults } from "@/lib/notetypes/builtins";
import { DEFAULT_DECK_OPTIONS, type DeckOptions } from "@/lib/scheduler/config";
import { getDayInfo } from "@/lib/scheduler/day";
import { fuzzRange, nextStates, pickDays } from "@/lib/scheduler/fsrs";
import { buildStudyQueue } from "@/lib/scheduler/queue";
import { loadSearchData } from "@/lib/search/load";
import { computeStats } from "@/lib/stats";
import { recordAnswer } from "@/lib/study/actions";

const DAY = 86_400_000;
const uid = "00000000-0000-4000-8000-0000000000dd";
let now = Date.UTC(2026, 9, 15, 9, 0);
let db: LocalDB;
const day = () => getDayInfo(now, "Europe/Istanbul", 4);
const classic: DeckOptions = { ...DEFAULT_DECK_OPTIONS, fsrs: false, loadBalance: false };

const card = (patch: Partial<CardRow> = {}): CardRow =>
  ({
    id: "c1", note_id: "n1", deck_id: "d1", ord: 0, state: 0, step: 0, due: 0, stability: 0, difficulty: 0, elapsed_days: 0,
    scheduled_days: 0, reps: 0, lapses: 0, last_review: null, ease: 0, interval_days: 0, last_example_id: null, flags: 0,
    suspended: false, buried_until: null, original_deck_id: null, original_due: null, position: 0,
    user_id: "u", created_at: 0, updated_at: "0", sched_updated_at: "0", deleted_at: null, ...patch,
  }) as CardRow;

beforeEach(async () => {
  now = Date.UTC(2026, 9, 15, 9, 0);
  db = await openLocalDB(uid, { dexie: { indexedDB: new IDBFactory(), IDBKeyRange }, now: () => now });
  await ensureDefaults(db);
});

describe("klasik algoritma (SM-2)", () => {
  it("yeni kart: adımlar, mezuniyet, kolay", () => {
    const s = nextStates(card(), classic, now);
    expect(s[1].due - now).toBe(60_000); // 1m
    expect(s[3]).toMatchObject({ state: 1, step: 1 });
    expect(s[3].due - now).toBe(600_000); // 10m
    expect(s[4]).toMatchObject({ state: 2, interval_days: 4, ease: 2500 });
    const second = nextStates(card({ state: 1, step: 1 }), classic, now);
    expect(second[3]).toMatchObject({ state: 2, interval_days: 1 });
  });

  it("tekrar kartı: iyi = aralık × kolaylık, unutma = kolaylık −0,2 ve yeniden öğrenme", () => {
    const rev = card({ state: 2, interval_days: 10, ease: 2500, last_review: now - 10 * DAY, due: now });
    const s = nextStates(rev, classic, now);
    expect(s[3].interval_days).toBeGreaterThanOrEqual(23); // 25 ± bulanıklık
    expect(s[3].interval_days).toBeLessThanOrEqual(27);
    expect(s[2].ease).toBe(2350);
    expect(s[4].ease).toBe(2650);
    expect(s[1]).toMatchObject({ state: 3, ease: 2300, lapses: 1, interval_days: 1 });
  });
});

describe("yük dengeleme", () => {
  it("bulanık aralıkta en boş günü seçer, boş günden kaçınır", () => {
    expect(fuzzRange(20, 36500)).toEqual([19, 21]);
    expect(fuzzRange(5, 36500)).toEqual([4, 6]);
    const ctx = { day: day(), dueOnDay: (d: number) => (d === 19 ? 0 : 50) };
    expect(pickDays(20, card(), { ...DEFAULT_DECK_OPTIONS }, ctx)).toBe(19);
    // 19. gün "boş gün" ise başka bir gün seçilir
    const wd = (((day().today + 19 + 3) % 7) + 7) % 7;
    const easy = DEFAULT_DECK_OPTIONS.easyDays.map((x, i) => (i === wd ? 0 : x));
    expect(pickDays(20, card(), { ...DEFAULT_DECK_OPTIONS, easyDays: easy }, ctx)).not.toBe(19);
  });
});

describe("çalışma kuyruğu", () => {
  const deck = (id: string, parent: string | null, extra: Partial<DeckRow> = {}) =>
    ({ id, name: id, parent_id: parent, config_id: null, description: "", collapsed: false, is_filtered: false, filter: null, deleted_at: null, ...extra }) as DeckRow;

  it("sınırlar yol üzerindeki her destede uygulanır; bugünlük artış eklenir", () => {
    const decks = [deck("P", null), deck("A", "P"), deck("B", "P")];
    const cards = [...Array(5)].flatMap((_, i) => [card({ id: `a${i}`, deck_id: "A", position: i }), card({ id: `b${i}`, deck_id: "B", position: i })]);
    const opts = (id: string) => ({ ...DEFAULT_DECK_OPTIONS, newPerDay: id === "P" ? 3 : 5 });
    const input = { decks, cards, todayLogs: [], optionsFor: opts, now, day: day() };
    expect(buildStudyQueue(input, "P").counts.new).toBe(3);
    expect(buildStudyQueue(input, "A").counts.new).toBe(5);
    expect(buildStudyQueue({ ...input, boosts: new Map([["P", { new: 4, review: 0 }]]) }, "P").counts.new).toBe(7);
  });

  it("yeni/tekrar karışımı: önce yeniler", () => {
    const decks = [deck("D", null)];
    const cards = [card({ id: "n", deck_id: "D" }), card({ id: "r", deck_id: "D", state: 2, due: now - DAY, interval_days: 3 })];
    const q = buildStudyQueue({ decks, cards, todayLogs: [], optionsFor: () => ({ ...DEFAULT_DECK_OPTIONS, newReviewMix: "newFirst" }), now, day: day() }, "D");
    expect(q.queue.map((x) => x.card.id)).toEqual(["n", "r"]);
  });
});

describe("filtreli deste, sülük, kardeşler", () => {
  async function basicNote(front: string, deckId = defaultDeckId(uid), key: "basic" | "basic-reversed" = "basic") {
    const nt = (await db.note_types.get(builtinNoteTypeId(key, uid)))!;
    return addNote(db, { noteType: nt, deckId, fields: { front, back: "x" } });
  }

  it("filtreli deste toplar, boşaltır; alıştırma modunda cevap zamanlamayı değiştirmez ve kart evine döner", async () => {
    const home = await createDeckPath(db, "YDS");
    const a = await basicNote("abandon", home.id);
    now += 5000;
    await basicNote("acquire", home.id);
    const { deck, count } = await createFilteredDeck(db, "Çalış", { search: "deck:YDS", limit: 1, order: "added", reschedule: false, second: null }, await loadSearchData(db, day(), now));
    expect(count).toBe(1);
    const moved = (await db.cards.get(a.cards[0].id))!;
    expect([moved.deck_id, moved.original_deck_id]).toEqual([deck.id, home.id]);

    await recordAnswer(db, moved, 3, DEFAULT_DECK_OPTIONS, { durationMs: 1000, filteredReschedule: false });
    const after = (await db.cards.get(a.cards[0].id))!;
    expect([after.deck_id, after.original_deck_id, after.state]).toEqual([home.id, null, 0]);

    await buildFilteredDeck(db, (await db.decks.get(deck.id))!, await loadSearchData(db, day(), now));
    expect(await emptyFilteredDeck(db, deck.id)).toBe(1);
  });

  it("sülük: eşiğe ulaşan unutma etiketler ve askıya alır", async () => {
    const { cards, note } = await basicNote("deter");
    await updateRow(db, "cards", cards[0].id, { state: 2, interval_days: 5, lapses: 7, ease: 2500, last_review: now - 5 * DAY, due: now });
    const c = (await db.cards.get(cards[0].id))!;
    const r = await recordAnswer(db, c, 1, { ...DEFAULT_DECK_OPTIONS, leechThreshold: 8, leechAction: "suspend" }, { durationMs: 1000 });
    expect(r.leech).toBe(true);
    expect((await db.cards.get(c.id))!.suspended).toBe(true);
    expect((await db.notes.get(note.id))!.tags).toContain("leech");
  });

  it("kardeş kartlar gömülür", async () => {
    const { cards } = await basicNote("benefit", defaultDeckId(uid), "basic-reversed");
    const until = day().nextDayStart;
    await recordAnswer(db, cards[0], 3, { ...DEFAULT_DECK_OPTIONS, buryNewSiblings: true }, { durationMs: 1000, nextDayStart: until });
    expect((await db.cards.get(cards[1].id))!.buried_until).toBe(until);
  });
});

describe("istatistik", () => {
  it("bugünün özeti ve doğru cevap oranı", () => {
    const log = (rating: number, kind: number, ago: number, ivl = 5) =>
      ({ id: `${rating}${kind}${ago}`, card_id: "c1", rating, kind, reviewed_at: now - ago, duration_ms: 4000, interval_before: ivl, deleted_at: null }) as never;
    const s = computeStats({
      cards: [card({ state: 2, interval_days: 30, due: now + 2 * DAY })],
      logs: [log(3, 1, 1000), log(1, 1, 2000), log(3, 0, 3000), log(3, 1, 3 * DAY, 30)],
      day: day(),
      now,
      rangeDays: 30,
      optionsFor: () => DEFAULT_DECK_OPTIONS,
    });
    expect(s.today).toMatchObject({ count: 3, again: 1, learn: 1, review: 2, correctPct: 50 });
    expect(s.counts.mature).toBe(1);
    expect(s.future[2].count).toBe(1);
    expect(s.retention.find((r) => r.period === "Son 7 gün")).toMatchObject({ young: [1, 2], mature: [1, 1] });
  });
});
