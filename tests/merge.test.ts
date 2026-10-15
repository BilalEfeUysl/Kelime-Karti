import { describe, expect, it } from "vitest";
import type { CardRow, DeckRow, ReviewLogRow } from "@/lib/db/types";
import { mergeRow } from "@/lib/sync/merge";

const h = (n: number, node = "a") => `${String(n).padStart(15, "0")}-00000-${node.repeat(16)}`;

function deck(name: string, updated: number, extra: Partial<DeckRow> = {}): DeckRow {
  return {
    id: "d1",
    user_id: "u",
    created_at: 1,
    updated_at: h(updated),
    deleted_at: null,
    name,
    parent_id: null,
    config_id: null,
    description: "",
    collapsed: false,
    is_filtered: false,
    filter: null,
    ...extra,
  };
}

function card(extra: Partial<CardRow>): CardRow {
  return {
    id: "c1",
    user_id: "u",
    created_at: 1,
    updated_at: h(1),
    deleted_at: null,
    note_id: "n1",
    deck_id: "deck-1",
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
    sched_updated_at: h(1),
    flags: 0,
    suspended: false,
    buried_until: null,
    original_deck_id: null,
    original_due: null,
    position: 0,
    ...extra,
  };
}

describe("mergeRow (çakışma kuralları)", () => {
  it("yerelde yoksa uzaktaki alınır", () => {
    const r = mergeRow("decks", undefined, deck("A", 5));
    expect(r.changed).toBe(true);
    expect(r.row.name).toBe("A");
  });

  it("son yazan kazanır", () => {
    expect(mergeRow("decks", deck("yerel", 5), deck("uzak", 6)).row.name).toBe("uzak");
    const kept = mergeRow("decks", deck("yerel", 7), deck("uzak", 6));
    expect(kept.changed).toBe(false);
    expect(kept.row.name).toBe("yerel");
  });

  it("silme de bir yazmadır: daha yeni silme kazanır, daha yeni düzenleme silmeyi geri alır", () => {
    expect(mergeRow("decks", deck("A", 5), deck("A", 6, { deleted_at: 99 })).row.deleted_at).toBe(99);
    expect(mergeRow("decks", deck("A", 5, { deleted_at: 99 }), deck("B", 6)).row.deleted_at).toBeNull();
  });

  it("cevap geçmişi asla değişmez; sadece 'geri al' işareti alınır", () => {
    const log = { id: "r1", updated_at: h(1), rating: 3, deleted_at: null } as ReviewLogRow;
    const r = mergeRow("review_logs", log, { ...log, updated_at: h(9), rating: 1 });
    expect(r.changed).toBe(false);
    expect(r.row.rating).toBe(3);
    const undone = mergeRow("review_logs", log, { ...log, updated_at: h(9), rating: 1, deleted_at: 55 });
    expect(undone.changed).toBe(true);
    expect(undone.row.deleted_at).toBe(55);
    expect(undone.row.rating).toBe(3);
  });

  it("kart: zamanlama ve meta alanlar ayrı ayrı birleşir", () => {
    // yerel: kartı çalıştı (zamanlama yeni), uzak: desteyi değiştirdi (meta yeni)
    const local = card({ reps: 5, due: 500, sched_updated_at: h(20), updated_at: h(1) });
    const remote = card({ deck_id: "deck-2", reps: 0, sched_updated_at: h(1), updated_at: h(10) });
    const r = mergeRow("cards", local, remote);
    expect(r.changed).toBe(true);
    expect(r.row.deck_id).toBe("deck-2");
    expect(r.row.reps).toBe(5);
    expect(r.row.due).toBe(500);
    expect(r.row.sched_updated_at).toBe(h(20));
    expect(r.row.updated_at).toBe(h(10));
  });
});
