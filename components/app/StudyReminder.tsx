"use client";
// "Bugün henüz çalışmadın" hatırlatması: bugün hiç cevap yoksa ve bekleyen kart
// varsa deste listesinin üstünde görünür. "Kapat" o gün için gizler.
import { useEffect, useState } from "react";
import { useDayInfo } from "@/components/app/data";
import type { DeckRow, ReviewLogRow } from "@/lib/db/types";
import type { DeckCounts } from "@/lib/scheduler/queue";
import { readJSON, writeJSON } from "@/lib/storage";

const KEY = "kk.reminder.dismissed";

export function StudyReminder({
  decks,
  counts,
  todayLogs,
}: {
  decks: DeckRow[];
  counts: Map<string, DeckCounts> | null;
  todayLogs: Pick<ReviewLogRow, "deleted_at" | "rating">[] | undefined;
}) {
  const { day } = useDayInfo();
  const [dismissed, setDismissed] = useState<number | null>(null);
  useEffect(() => setDismissed(readJSON<number>(KEY)), []);
  if (!counts || !todayLogs || dismissed === day.today) return null;
  if (todayLogs.some((l) => l.deleted_at === null && l.rating > 0)) return null;
  // Sadece en üst destelerin toplamı (alt desteler zaten içinde)
  const waiting = decks
    .filter((d) => d.deleted_at === null && !d.parent_id && !d.is_filtered)
    .reduce((s, d) => {
      const c = counts.get(d.id);
      return s + (c ? c.new + c.learn + c.review : 0);
    }, 0);
  if (!waiting) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
      <span className="flex-1">
        Bugün henüz çalışmadın: <strong>{waiting} kart</strong> seni bekliyor.
      </span>
      <button
        type="button"
        onClick={() => {
          writeJSON(KEY, day.today);
          setDismissed(day.today);
        }}
        className="rounded-md px-2 py-1 text-ink-soft hover:text-ink"
      >
        Kapat
      </button>
    </div>
  );
}
