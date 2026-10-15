// ÇALIŞMA KUYRUĞU ve DESTE SAYILARI (Anki v3'e benzer kurallar)
//
// Kart türleri:
//   yeni     (state 0)                     → günlük "yeni kart" sınırına tabi
//   öğrenme  (state 1/3, gün içi adımlar)  → sınırsız, öncelikli
//   tekrar   (state 2, vakti gelmiş; günlük adımdaki öğrenme kartları da)
//            → günlük "tekrar" sınırına tabi
//
// Sınırlar: bir kart, seçilen desteden kendi destesine kadar yoldaki HER destenin
// sınırına sığıyorsa alınır (üst deste alt destelerin toplamını keser).
// Bugün yapılanlar düşülür; özel çalışmadaki "bugünlük artış" eklenir.
// Filtreli destelerde sınır yoktur ve vakti gelmemiş kartlar da gösterilir.
import type { CardRow, DeckRow, ReviewLogRow } from "@/lib/db/types";
import { type FilterOrder, filteredSortKey } from "@/lib/filtered";
import type { DeckOptions } from "./config";
import type { DayInfo } from "./day";
import { retrievability } from "./fsrs";

export const LEARN_AHEAD_MS = 20 * 60_000; // Anki'deki "ileriye öğrenme" sınırı

export type QueueKind = "new" | "learn" | "review";

export interface DeckCounts {
  new: number;
  learn: number;
  review: number;
}

export interface QueueItem {
  card: CardRow;
  kind: QueueKind;
}

export interface QueueInput {
  decks: DeckRow[];
  cards: CardRow[];
  /** Bugün (dayStart'tan beri) yapılan cevaplar */
  todayLogs: Pick<ReviewLogRow, "deck_id" | "state" | "deleted_at">[];
  optionsFor: (deckId: string) => DeckOptions;
  now: number;
  day: DayInfo;
  /** Özel çalışma: bugünlük sınır artışları (deste id → ek yeni/tekrar) */
  boosts?: Map<string, { new: number; review: number }>;
}

type Klass = "new" | "review" | "learnNow" | "learnSoon" | "learnLater" | null;

/** Kartın bugünkü durumu; çalışılamıyorsa null */
function classify(card: CardRow, now: number, day: DayInfo, filtered: boolean): Klass {
  if (card.deleted_at !== null || card.suspended) return null;
  if (card.buried_until && card.buried_until > now) return null;
  if (card.state === 0) return "new";
  if (card.state === 2) return filtered || card.due < day.nextDayStart ? "review" : null;
  const interday = card.scheduled_days >= 1;
  if (interday) return filtered || card.due < day.nextDayStart ? "review" : null;
  if (card.due <= now) return "learnNow";
  if (card.due <= now + LEARN_AHEAD_MS) return "learnSoon";
  if (card.due < day.nextDayStart) return "learnLater";
  return null;
}

/** Karta ve güne bağlı kararlı "rastgele" sayı */
function stableRandom(id: string, salt: number): number {
  let h = salt | 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h ^ id.charCodeAt(i), 2654435761) >>> 0) | 0;
  return h >>> 0;
}

interface Prepared {
  input: QueueInput;
  deckById: Map<string, DeckRow>;
  parentOf: Map<string, string | null>;
  children: Map<string | null, string[]>;
  /** Ağaç sırası (deste sıralaması için) */
  treeIndex: Map<string, number>;
  byKlass: Record<Exclude<Klass, null>, CardRow[]>;
  newLeft: Map<string, number>;
  reviewLeft: Map<string, number>;
}

function prepare(input: QueueInput): Prepared {
  const alive = input.decks.filter((d) => d.deleted_at === null);
  const deckById = new Map(alive.map((d) => [d.id, d]));
  const children = new Map<string | null, string[]>();
  const parentOf = new Map<string, string | null>();
  for (const d of [...alive].sort((a, b) => a.name.localeCompare(b.name, "tr"))) {
    const parent = d.parent_id && deckById.has(d.parent_id) ? d.parent_id : null;
    parentOf.set(d.id, parent);
    children.set(parent, [...(children.get(parent) ?? []), d.id]);
  }
  const treeIndex = new Map<string, number>();
  const walk = (id: string | null) => {
    for (const c of children.get(id) ?? []) {
      treeIndex.set(c, treeIndex.size);
      walk(c);
    }
  };
  walk(null);

  const byKlass: Prepared["byKlass"] = { new: [], review: [], learnNow: [], learnSoon: [], learnLater: [] };
  for (const card of input.cards) {
    const deck = deckById.get(card.deck_id);
    if (!deck) continue;
    const k = classify(card, input.now, input.day, deck.is_filtered);
    if (k) byKlass[k].push(card);
  }

  // Bugün yapılanları sınırdan düş, özel çalışma artışlarını ekle
  const newDone = new Map<string, number>();
  const reviewDone = new Map<string, number>();
  for (const log of input.todayLogs) {
    if (log.deleted_at !== null || !log.deck_id) continue;
    if (log.state === 0) newDone.set(log.deck_id, (newDone.get(log.deck_id) ?? 0) + 1);
    else if (log.state === 2) reviewDone.set(log.deck_id, (reviewDone.get(log.deck_id) ?? 0) + 1);
  }
  const newLeft = new Map<string, number>();
  const reviewLeft = new Map<string, number>();
  for (const d of alive) {
    if (d.is_filtered) {
      newLeft.set(d.id, Infinity);
      reviewLeft.set(d.id, Infinity);
      continue;
    }
    const o = input.optionsFor(d.id);
    const boost = input.boosts?.get(d.id);
    newLeft.set(d.id, Math.max(0, o.newPerDay + (boost?.new ?? 0) - (newDone.get(d.id) ?? 0)));
    reviewLeft.set(d.id, Math.max(0, o.reviewsPerDay + (boost?.review ?? 0) - (reviewDone.get(d.id) ?? 0)));
  }
  return { input, deckById, parentOf, children, treeIndex, byKlass, newLeft, reviewLeft };
}

/** Kartın destesinden seçilen desteye kadarki yol (seçilen dahil). Alt ağaçta değilse null. */
function pathTo(p: Prepared, deckId: string, rootId: string): string[] | null {
  const path: string[] = [];
  let cur: string | null = deckId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    path.push(cur);
    if (cur === rootId) return path;
    cur = p.parentOf.get(cur) ?? null;
  }
  return null;
}

/** Sınırlara sığan kartları sırayla seçer */
function takeWithLimits(p: Prepared, rootId: string, sorted: CardRow[], left: Map<string, number>): CardRow[] {
  const remaining = new Map<string, number>();
  const cap = (id: string) => remaining.get(id) ?? left.get(id) ?? 0;
  const out: CardRow[] = [];
  if (cap(rootId) <= 0) return out;
  for (const card of sorted) {
    const path = pathTo(p, card.deck_id, rootId);
    if (!path || path.some((id) => cap(id) <= 0)) continue;
    for (const id of path) remaining.set(id, cap(id) - 1);
    out.push(card);
    if (cap(rootId) <= 0) break;
  }
  return out;
}

function inSubtree(p: Prepared, cards: CardRow[], rootId: string): CardRow[] {
  return cards.filter((c) => pathTo(p, c.deck_id, rootId) !== null);
}

/** Yeni kartların toplanma sırası */
function sortNew(p: Prepared, cards: CardRow[], rootId: string): CardRow[] {
  const root = p.deckById.get(rootId);
  const salt = p.input.day.today;
  if (root?.is_filtered) {
    const order = ((root.filter ?? {}) as { order?: FilterOrder }).order ?? "due";
    return [...cards].sort((a, b) => filteredSortKey(a, order, salt) - filteredSortKey(b, order, salt));
  }
  const o = p.input.optionsFor(rootId);
  const pos = (c: CardRow) => c.position * 1000 + c.ord;
  const key: (c: CardRow) => number =
    o.newGatherOrder === "position"
      ? pos
      : o.newGatherOrder === "positionDesc"
        ? (c) => -pos(c)
        : o.newGatherOrder === "randomNotes"
          ? (c) => stableRandom(c.note_id, salt) * 1000 + c.ord
          : o.newGatherOrder === "randomCards"
            ? (c) => stableRandom(c.id, salt)
            : (c) => (p.treeIndex.get(c.deck_id) ?? 0) * 1e13 + pos(c); // deste sırası
  return [...cards].sort((a, b) => key(a) - key(b) || a.created_at - b.created_at || a.ord - b.ord);
}

function arrangeNew(p: Prepared, gathered: CardRow[], rootId: string): CardRow[] {
  const o = p.input.optionsFor(rootId);
  if (p.deckById.get(rootId)?.is_filtered || o.newSortOrder === "gathered") return gathered;
  const salt = p.input.day.today;
  if (o.newSortOrder === "template") {
    const idx = new Map(gathered.map((c, i) => [c.id, i]));
    return [...gathered].sort((a, b) => a.ord - b.ord || idx.get(a.id)! - idx.get(b.id)!);
  }
  return [...gathered].sort((a, b) => stableRandom(a.id, salt + 1) - stableRandom(b.id, salt + 1));
}

/** Tekrarların sırası */
function sortReviews(p: Prepared, cards: CardRow[], rootId: string): CardRow[] {
  const root = p.deckById.get(rootId);
  const salt = p.input.day.today;
  if (root?.is_filtered) {
    const order = ((root.filter ?? {}) as { order?: FilterOrder }).order ?? "due";
    return [...cards].sort((a, b) => filteredSortKey(a, order, salt) - filteredSortKey(b, order, salt));
  }
  const o = p.input.optionsFor(rootId);
  const { now } = p.input;
  const tie = (a: CardRow, b: CardRow) => stableRandom(a.id, salt) - stableRandom(b.id, salt);
  const dueDay = (c: CardRow) => Math.floor((c.due - p.input.day.dayStart) / 86_400_000);
  switch (o.reviewSortOrder) {
    case "intervalAsc":
      return [...cards].sort((a, b) => a.interval_days - b.interval_days || tie(a, b));
    case "intervalDesc":
      return [...cards].sort((a, b) => b.interval_days - a.interval_days || tie(a, b));
    case "difficultyDesc":
      return [...cards].sort((a, b) => b.difficulty - a.difficulty || tie(a, b));
    case "retrievabilityAsc": {
      const r = new Map(cards.map((c) => [c.id, retrievability(c, p.input.optionsFor(c.original_deck_id ?? c.deck_id), now) ?? 1]));
      return [...cards].sort((a, b) => r.get(a.id)! - r.get(b.id)! || tie(a, b));
    }
    case "random":
      return [...cards].sort(tie);
    default:
      // Vadesi en eski önce; aynı gün içinde karışık
      return [...cards].sort((a, b) => dueDay(a) - dueDay(b) || tie(a, b));
  }
}

/** Yeni kartları tekrarların arasına eşit aralıklarla serpiştirir */
function mix(reviews: QueueItem[], news: QueueItem[]): QueueItem[] {
  if (!news.length) return reviews;
  if (!reviews.length) return news;
  const out: QueueItem[] = [];
  const every = (reviews.length + news.length) / news.length;
  let ni = 0;
  let ri = 0;
  for (let i = 0; ni < news.length || ri < reviews.length; i++) {
    const wantNew = ni < news.length && (ri >= reviews.length || i >= Math.round(every * (ni + 1)) - 1);
    if (wantNew) out.push(news[ni++]);
    else out.push(reviews[ri++]);
  }
  return out;
}

function gatherFor(p: Prepared, rootId: string) {
  const news = arrangeNew(p, takeWithLimits(p, rootId, sortNew(p, inSubtree(p, p.byKlass.new, rootId), rootId), p.newLeft), rootId);
  const reviews = takeWithLimits(p, rootId, sortReviews(p, inSubtree(p, p.byKlass.review, rootId), rootId), p.reviewLeft);
  const learnNow = inSubtree(p, p.byKlass.learnNow, rootId).sort((a, b) => a.due - b.due);
  const learnSoon = inSubtree(p, p.byKlass.learnSoon, rootId).sort((a, b) => a.due - b.due);
  return { news, reviews, learnNow, learnSoon };
}

/** Her deste için (alt desteler dahil, sınırlar uygulanmış) Yeni / Öğrenme / Tekrar sayıları */
export function computeDeckCounts(input: QueueInput): Map<string, DeckCounts> {
  const p = prepare(input);
  const out = new Map<string, DeckCounts>();
  for (const d of input.decks) {
    if (d.deleted_at !== null) continue;
    const g = gatherFor(p, d.id);
    const interdayLearn = g.reviews.filter((c) => c.state !== 2).length;
    out.set(d.id, {
      new: g.news.length,
      learn: g.learnNow.length + g.learnSoon.length + interdayLearn,
      review: g.reviews.length - interdayLearn,
    });
  }
  return out;
}

export interface StudyQueue {
  queue: QueueItem[];
  counts: DeckCounts;
  /** Bugün daha sonra vakti gelecek ilk öğrenme kartının zamanı (yoksa null) */
  nextLearnDue: number | null;
}

/** Seçilen deste (ve alt desteleri) için sıralı çalışma kuyruğu */
export function buildStudyQueue(input: QueueInput, deckId: string, avoidCardId?: string | null): StudyQueue {
  const p = prepare(input);
  const g = gatherFor(p, deckId);
  const news = g.news.map((card) => ({ card, kind: "new" as const }));
  const reviews = g.reviews.map((card) => ({ card, kind: (card.state === 2 ? "review" : "learn") as QueueKind }));
  const learnNow = g.learnNow.map((card) => ({ card, kind: "learn" as const }));
  const learnSoon = g.learnSoon.map((card) => ({ card, kind: "learn" as const }));

  const o = p.deckById.get(deckId)?.is_filtered ? null : input.optionsFor(deckId);
  const middle = o?.newReviewMix === "newFirst" ? [...news, ...reviews] : o?.newReviewMix === "reviewFirst" ? [...reviews, ...news] : mix(reviews, news);
  const queue = [...learnNow, ...middle, ...learnSoon];
  // Az önce cevaplanan kartı (başka seçenek varsa) hemen tekrar gösterme
  if (avoidCardId && queue.length > 1 && queue[0].card.id === avoidCardId) {
    const [first] = queue.splice(0, 1);
    queue.splice(1, 0, first);
  }

  let nextLearnDue: number | null = null;
  for (const c of inSubtree(p, p.byKlass.learnLater, deckId)) if (nextLearnDue === null || c.due < nextLearnDue) nextLearnDue = c.due;

  return {
    queue,
    counts: {
      new: news.length,
      learn: learnNow.length + learnSoon.length + reviews.filter((r) => r.kind === "learn").length,
      review: reviews.filter((r) => r.kind === "review").length,
    },
    nextLearnDue,
  };
}
