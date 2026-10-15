import { describe, expect, it } from "vitest";
import { cardOrdsForNote } from "@/lib/cards/generate";
import type { CardRow, DeckRow } from "@/lib/db/types";
import { BUILTIN_NOTE_TYPES } from "@/lib/notetypes/builtins";
import { DEFAULT_DECK_OPTIONS, type DeckOptions, normalizeOptions, parseSteps } from "@/lib/scheduler/config";
import { getDayInfo } from "@/lib/scheduler/day";
import { formatInterval } from "@/lib/scheduler/format";
import { answerCard, previewAnswers } from "@/lib/scheduler/fsrs";
import { buildStudyQueue, computeDeckCounts, type QueueInput } from "@/lib/scheduler/queue";

const MIN = 60_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 13, 9, 0); // 12:00 İstanbul

let seq = 0;
function card(extra: Partial<CardRow> = {}): CardRow {
  seq++;
  return {
    id: `c${seq}`,
    user_id: "u",
    created_at: seq,
    updated_at: "x",
    deleted_at: null,
    note_id: `n${seq}`,
    deck_id: "d1",
    ord: 0,
    state: 0,
    step: 0,
    due: 0,
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    last_review: null,
    ease: 2500,
    interval_days: 0,
    last_example_id: null,
    sched_updated_at: "x",
    flags: 0,
    suspended: false,
    buried_until: null,
    original_deck_id: null,
    original_due: null,
    position: seq,
    ...extra,
  };
}

function deck(id: string, name: string, parent_id: string | null = null): DeckRow {
  return { id, user_id: "u", created_at: 0, updated_at: "x", deleted_at: null, name, parent_id, config_id: null, description: "", collapsed: false, is_filtered: false, filter: null };
}

const day = getDayInfo(NOW, "Europe/Istanbul", 4);

function qInput(decks: DeckRow[], cards: CardRow[], opts: Record<string, Partial<DeckOptions>> = {}, todayLogs: QueueInput["todayLogs"] = []): QueueInput {
  return {
    decks,
    cards,
    todayLogs,
    optionsFor: (id) => ({ ...DEFAULT_DECK_OPTIONS, ...opts[id] }),
    now: NOW,
    day,
  };
}

describe("gün hesabı", () => {
  it("İstanbul, gün 04:00'te başlar: gece 03:30 hâlâ önceki gün", () => {
    const night = getDayInfo(Date.UTC(2026, 9, 13, 0, 30), "Europe/Istanbul", 4); // yerel 03:30
    const morning = getDayInfo(Date.UTC(2026, 9, 13, 2, 0), "Europe/Istanbul", 4); // yerel 05:00
    expect(morning.today - night.today).toBe(1);
    expect(night.dayStart).toBe(Date.UTC(2026, 9, 12, 1, 0)); // 12 Ekim 04:00 yerel
    expect(morning.dayStart).toBe(Date.UTC(2026, 9, 13, 1, 0));
    expect(morning.nextDayStart - morning.dayStart).toBe(DAY);
  });

  it("yaz saati değişen günde de doğru (Berlin, 29 Mart 2026)", () => {
    const d = getDayInfo(Date.UTC(2026, 2, 29, 10, 0), "Europe/Berlin", 4);
    expect(d.dayStart).toBe(Date.UTC(2026, 2, 29, 2, 0)); // 04:00 CEST = 02:00 UTC
    expect(d.nextDayStart).toBe(Date.UTC(2026, 2, 30, 2, 0));
  });
});

describe("biçimler ve ayarlar", () => {
  it("aralık önizlemesi", () => {
    expect(formatInterval(30_000)).toBe("<1dk");
    expect(formatInterval(10 * MIN)).toBe("<10dk");
    expect(formatInterval(3 * 60 * MIN)).toBe("<3sa");
    expect(formatInterval(3 * DAY)).toBe("3g");
    expect(formatInterval(36 * DAY)).toBe("1,2ay");
    expect(formatInterval(2.5 * 365 * DAY)).toBe("2,5y");
  });

  it("öğrenme adımları ve bozuk ayarlar", () => {
    expect(parseSteps("1m 10m 1d")).toEqual(["1m", "10m", "1d"]);
    expect(parseSteps("1m, 2x")).toBeNull();
    const o = normalizeOptions({ newPerDay: -5, desiredRetention: 2, learningSteps: ["bozuk"] });
    expect(o.newPerDay).toBe(0);
    expect(o.desiredRetention).toBe(0.99);
    expect(o.learningSteps).toEqual(DEFAULT_DECK_OPTIONS.learningSteps);
  });
});

describe("FSRS cevaplama", () => {
  it("yeni kart: Tekrar 1dk, Zor ~6dk, İyi 10dk (adım 2), Kolay birkaç gün", () => {
    const c = card();
    const p = previewAnswers(c, DEFAULT_DECK_OPTIONS, NOW);
    expect(p[1]).toBe("<1dk");
    expect(p[2]).toBe("<6dk");
    expect(p[3]).toBe("<10dk");
    expect(p[4]).toMatch(/^\d+g$/);

    const good = answerCard(c, 3, DEFAULT_DECK_OPTIONS, NOW, { durationMs: 5000 });
    expect(good.patch.state).toBe(1);
    expect(good.patch.step).toBe(1);
    expect(good.patch.due).toBe(NOW + 10 * MIN);
    expect(good.log).toMatchObject({ rating: 3, state: 0, kind: 0, duration_ms: 5000, card_id: c.id });
  });

  it("önizleme ile gerçek sonuç aynı (rastgelelik karta bağlı)", () => {
    const c = card({ state: 2, stability: 20, difficulty: 5, due: NOW, last_review: NOW - 20 * DAY, scheduled_days: 20, interval_days: 20, reps: 5 });
    const p = previewAnswers(c, DEFAULT_DECK_OPTIONS, NOW);
    for (const a of [2, 3, 4] as const) {
      const r = answerCard(c, a, DEFAULT_DECK_OPTIONS, NOW, { durationMs: 0 });
      expect(formatInterval(r.patch.due - NOW)).toBe(p[a]);
    }
    const again = answerCard(c, 1, DEFAULT_DECK_OPTIONS, NOW, { durationMs: 0 });
    expect(again.patch.state).toBe(3); // yeniden öğrenme
    expect(again.patch.lapses).toBe(1);
    expect(again.log.kind).toBe(1);
  });
});

describe("kart üretme kuralları", () => {
  const nt = (key: string) => BUILTIN_NOTE_TYPES.find((t) => t.key === key)!;

  it("Basic: 1 kart; ters kartlı: 2; isteğe bağlı ters: sadece işaretliyse", () => {
    expect(cardOrdsForNote(nt("basic"), { front: "a", back: "b" })).toEqual([0]);
    expect(cardOrdsForNote(nt("basic-reversed"), { front: "a", back: "b" })).toEqual([0, 1]);
    expect(cardOrdsForNote(nt("basic-reversed"), { front: "a", back: "" })).toEqual([0]);
    expect(cardOrdsForNote(nt("basic-optional-reversed"), { front: "a", back: "b", "add-reverse": "" })).toEqual([0]);
    expect(cardOrdsForNote(nt("basic-optional-reversed"), { front: "a", back: "b", "add-reverse": "y" })).toEqual([0, 1]);
    expect(cardOrdsForNote(nt("basic"), { front: "<br>", back: "b" })).toEqual([]);
  });

  it("Cloze: her numara için bir kart, hiç yoksa c1", () => {
    expect(cardOrdsForNote(nt("cloze"), { text: "{{c1::a}} {{c3::b}} {{c1::c}}", "back-extra": "" })).toEqual([0, 2]);
    expect(cardOrdsForNote(nt("cloze"), { text: "cloze yok", "back-extra": "" })).toEqual([0]);
  });
});

describe("çalışma kuyruğu ve sınırlar", () => {
  it("günlük yeni kart sınırı ve bugün yapılanlar", () => {
    const decks = [deck("d1", "YDS")];
    const cards = Array.from({ length: 30 }, () => card());
    expect(computeDeckCounts(qInput(decks, cards)).get("d1")).toEqual({ new: 20, learn: 0, review: 0 });
    const logs = Array.from({ length: 5 }, () => ({ deck_id: "d1", state: 0, deleted_at: null }));
    expect(computeDeckCounts(qInput(decks, cards, {}, logs)).get("d1")?.new).toBe(15);
    // Geri alınan (silinmiş) cevap sayılmaz
    expect(computeDeckCounts(qInput(decks, cards, {}, [{ deck_id: "d1", state: 0, deleted_at: 1 }])).get("d1")?.new).toBe(20);
  });

  it("alt desteler: her deste kendi ve üstünün sınırıyla kesilir", () => {
    const decks = [deck("p", "Ana"), deck("a", "A", "p"), deck("b", "B", "p")];
    const cards = [
      ...Array.from({ length: 20 }, () => card({ deck_id: "a" })),
      ...Array.from({ length: 20 }, () => card({ deck_id: "b" })),
    ];
    const opts = { p: { newPerDay: 10 }, a: { newPerDay: 5 }, b: { newPerDay: 20 } };
    const counts = computeDeckCounts(qInput(decks, cards, opts));
    expect(counts.get("a")?.new).toBe(5);
    expect(counts.get("b")?.new).toBe(20);
    expect(counts.get("p")?.new).toBe(10);
    // Ana destede çalışırken önce A'nın 5 kartı, sonra B'den 5 kart
    const q = buildStudyQueue(qInput(decks, cards, opts), "p");
    expect(q.queue.map((i) => i.card.deck_id)).toEqual([...Array(5).fill("a"), ...Array(5).fill("b")]);
  });

  it("öğrenme kartı önce gelir; askıya alınmış, gömülü ve vakti gelmemiş kartlar gelmez", () => {
    const decks = [deck("d1", "YDS")];
    const learning = card({ state: 1, due: NOW - MIN, last_review: NOW - 10 * MIN });
    const review = card({ state: 2, due: NOW - DAY, scheduled_days: 3, last_review: NOW - 4 * DAY });
    const fresh = card();
    const tomorrow = card({ state: 2, due: day.nextDayStart + MIN, scheduled_days: 3 });
    const suspended = card({ suspended: true });
    const buried = card({ buried_until: day.nextDayStart });
    const later = card({ state: 1, due: NOW + 2 * 3600_000, last_review: NOW });
    const q = buildStudyQueue(qInput(decks, [fresh, review, learning, tomorrow, suspended, buried, later]), "d1");
    expect(q.queue[0].card.id).toBe(learning.id);
    expect(q.queue.map((i) => i.card.id).sort()).toEqual([learning.id, review.id, fresh.id].sort());
    expect(q.counts).toEqual({ new: 1, learn: 1, review: 1 });
    expect(q.nextLearnDue).toBe(later.due);
  });

  it("yeni kartlar tekrarların arasına serpiştirilir; az önce görülen kart hemen tekrar gelmez", () => {
    const decks = [deck("d1", "YDS")];
    const reviews = Array.from({ length: 4 }, (_, i) => card({ state: 2, due: NOW - (i + 1) * DAY, scheduled_days: 5 }));
    const news = Array.from({ length: 2 }, () => card());
    const kinds = buildStudyQueue(qInput(decks, [...reviews, ...news]), "d1").queue.map((i) => i.kind);
    expect(kinds).toHaveLength(6);
    expect(kinds[0]).toBe("review");
    expect(kinds.slice(-1)[0]).toBe("new");
    expect(kinds.indexOf("new")).toBeLessThan(4);

    const l1 = card({ state: 1, due: NOW - MIN });
    const l2 = card({ state: 1, due: NOW });
    const q = buildStudyQueue(qInput(decks, [l1, l2]), "d1", l1.id);
    expect(q.queue[0].card.id).toBe(l2.id);
  });
});
