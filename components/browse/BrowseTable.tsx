"use client";
// KART TARAYICI TABLOSU
//  - Sadece görünen satırlar çizilir (on binlerce satırda da akıcı)
//  - Tıkla: seç; Ctrl/Cmd+tıkla: ekle/çıkar; Shift+tıkla: aralık seç
//  - Klavye: ↑/↓ gezin (Shift ile genişlet), Ctrl/Cmd+A tümünü seç
//  - Sütun başlığına tıkla: sırala (tekrar tıkla: ters)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CardRow } from "@/lib/db/types";
import { FLAG_COLORS } from "@/lib/flags";
import type { DayInfo } from "@/lib/scheduler/day";
import { renderCard } from "@/lib/template/render";
import { stripHtml } from "@/lib/text";
import {
  type BrowseMode,
  type BrowseRow,
  COLUMNS,
  type ColumnId,
  formatDate,
  formatDue,
  formatIvl,
  hlcWall,
  type SortState,
} from "./data";
import { noteTypeLabel } from "@/lib/notetypes/labels";

const ROW_H = 36;
const OVERSCAN = 8;

interface Props {
  rows: BrowseRow[];
  mode: BrowseMode;
  columns: ColumnId[];
  sort: SortState;
  onSort: (s: SortState) => void;
  selected: Set<string>;
  current: string | null;
  onSelect: (selected: Set<string>, current: string | null) => void;
  onOpen?: (id: string) => void;
  /** Değiştiricisiz tıklama (telefonda ayrıntıyı açmak için) */
  onActivate?: (id: string) => void;
  day: DayInfo;
  height: string;
}

// Soru/cevap metni (HTML'siz) — not değişmedikçe önbellekten
const qaCache = new Map<string, { q: string; a: string }>();
function questionAnswer(row: BrowseRow): { q: string; a: string } {
  const key = `${row.card.id}:${row.note.updated_at}:${row.noteType?.updated_at ?? ""}`;
  let hit = qaCache.get(key);
  if (!hit && row.noteType) {
    try {
      const r = renderCard({ noteType: row.noteType, note: row.note, cardOrd: row.card.ord, deckName: row.deckName });
      const answerOnly = r.answer.split(/<hr id=["']?answer["']?\s*\/?>/i).pop() ?? r.answer;
      hit = { q: stripHtml(r.question), a: stripHtml(answerOnly) };
    } catch {
      hit = { q: "(şablon hatası)", a: "" };
    }
    if (qaCache.size > 5000) qaCache.clear();
    qaCache.set(key, hit);
  }
  return hit ?? { q: "", a: "" };
}

function cellText(row: BrowseRow, col: ColumnId, mode: BrowseMode, day: DayInfo): string {
  const cards: CardRow[] = mode === "notes" ? row.cards : [row.card];
  switch (col) {
    case "sortField":
      return row.note.sort_field;
    case "question":
      return questionAnswer(row).q;
    case "answer":
      return questionAnswer(row).a;
    case "deck":
      return mode === "notes" && new Set(cards.map((c) => c.deck_id)).size > 1 ? "(çoklu)" : row.deckName;
    case "due": {
      const c = cards.reduce((a, b) => (b.state !== 0 && (a.state === 0 || b.due < a.due) ? b : a));
      return formatDue(c, day);
    }
    case "interval": {
      const rev = cards.filter((c) => c.state !== 0);
      return rev.length ? formatIvl(Math.max(...rev.map((c) => c.interval_days))) : "(yeni)";
    }
    case "difficulty": {
      const rev = cards.filter((c) => c.state !== 0 && c.difficulty > 0);
      return rev.length ? `%${Math.round(((Math.max(...rev.map((c) => c.difficulty)) - 1) / 9) * 100)}` : "—";
    }
    case "reps":
      return String(cards.reduce((s, c) => s + c.reps, 0));
    case "lapses":
      return String(cards.reduce((s, c) => s + c.lapses, 0));
    case "created":
      return formatDate(mode === "notes" ? row.note.created_at : row.card.created_at);
    case "modified":
      return formatDate(hlcWall(row.card.updated_at > row.note.updated_at && mode === "cards" ? row.card.updated_at : row.note.updated_at));
    case "tags":
      return row.note.tags.join(" ");
    case "noteType":
      return row.noteType ? noteTypeLabel(row.noteType.name) : "?";
    case "examples":
      return String(row.examples);
    case "cardCount":
      return String(row.cards.length);
  }
}

export function BrowseTable({ rows, mode, columns, sort, onSort, selected, current, onSelect, onOpen, onActivate, day, height }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const anchor = useRef<string | null>(null);
  const defs = useMemo(() => columns.map((id) => COLUMNS.find((c) => c.id === id)!).filter(Boolean), [columns]);
  const template = `28px ${defs.map((d) => d.width).join(" ")}`;
  const indexById = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);

  const scrollIntoView = useCallback((index: number) => {
    const el = scroller.current;
    if (!el) return;
    const top = index * ROW_H;
    const headerH = ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight - headerH) el.scrollTop = top + ROW_H - el.clientHeight + headerH;
  }, []);

  const click = (e: React.MouseEvent | React.KeyboardEvent, id: string) => {
    if (e.shiftKey && anchor.current && indexById.has(anchor.current)) {
      const a = indexById.get(anchor.current)!;
      const b = indexById.get(id)!;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const next = new Set((e.ctrlKey || e.metaKey) ? selected : []);
      for (let i = lo; i <= hi; i++) next.add(rows[i].id);
      onSelect(next, id);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      anchor.current = id;
      onSelect(next, next.has(id) ? id : current);
      return;
    }
    anchor.current = id;
    onSelect(new Set([id]), id);
    onActivate?.(id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!rows.length) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      onSelect(new Set(rows.map((r) => r.id)), current ?? rows[0].id);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = current !== null && indexById.has(current) ? indexById.get(current)! : -1;
      const next = Math.min(rows.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)));
      const id = rows[next].id;
      if (e.shiftKey) {
        if (!anchor.current) anchor.current = current ?? id;
        click(e, id);
      } else {
        anchor.current = id;
        onSelect(new Set([id]), id);
      }
      scrollIntoView(next);
    } else if (e.key === "Enter" && current) {
      onOpen?.(current);
    }
  };

  const allSelected = rows.length > 0 && selected.size === rows.length;

  return (
    <div
      ref={scroller}
      tabIndex={0}
      role="grid"
      aria-rowcount={rows.length}
      aria-multiselectable
      aria-label={mode === "cards" ? "Kartlar" : "Notlar"}
      onKeyDown={onKeyDown}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="relative overflow-auto rounded-xl border border-rule bg-surface text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
      style={{ height }}
    >
      <div style={{ minWidth: "fit-content" }}>
        <div role="row" className="sticky top-0 z-10 grid border-b border-rule bg-surface" style={{ gridTemplateColumns: template, height: ROW_H }}>
          <div role="columnheader" className="grid place-items-center">
            <input
              type="checkbox"
              aria-label="Tümünü seç"
              checked={allSelected}
              onChange={() => onSelect(allSelected ? new Set() : new Set(rows.map((r) => r.id)), current)}
              className="size-4"
            />
          </div>
          {defs.map((d) => (
            <button
              key={d.id}
              role="columnheader"
              type="button"
              disabled={!d.sortable}
              aria-sort={sort.column === d.id ? (sort.desc ? "descending" : "ascending") : "none"}
              onClick={() => onSort({ column: d.id, desc: sort.column === d.id ? !sort.desc : false })}
              className={`flex items-center gap-1 truncate px-2 text-left text-xs font-semibold text-ink-soft enabled:hover:text-ink ${d.numeric ? "justify-end" : ""}`}
            >
              {d.label}
              {sort.column === d.id && <span aria-hidden>{sort.desc ? "▼" : "▲"}</span>}
            </button>
          ))}
        </div>
        <div style={{ height: rows.length * ROW_H, position: "relative" }}>
          {rows.slice(first, last).map((row, k) => {
            const i = first + k;
            const isSel = selected.has(row.id);
            const isCur = current === row.id;
            const c = row.card;
            const flag = mode === "cards" ? c.flags : 0;
            const marked = row.note.tags.some((t) => t.toLowerCase() === "marked");
            const suspended = mode === "cards" ? c.suspended : row.cards.every((x) => x.suspended);
            return (
              <div
                key={row.id}
                role="row"
                aria-selected={isSel}
                onClick={(e) => click(e, row.id)}
                onDoubleClick={() => onOpen?.(row.id)}
                className={`absolute inset-x-0 grid cursor-default items-center border-b border-rule/60 ${
                  isSel ? "bg-accent/15" : suspended ? "bg-mark/15" : marked ? "bg-accent/5" : i % 2 ? "bg-ink/[0.02]" : ""
                } ${isCur ? "outline outline-1 -outline-offset-1 outline-accent" : ""}`}
                style={{ top: i * ROW_H, height: ROW_H, gridTemplateColumns: template }}
              >
                <div className="relative grid h-full place-items-center" onClick={(e) => e.stopPropagation()}>
                  {flag > 0 && <span className="absolute inset-y-1 left-0 w-1 rounded-r" style={{ background: FLAG_COLORS[flag] }} aria-label="bayrak" />}
                  <input
                    type="checkbox"
                    aria-label="Seç"
                    checked={isSel}
                    onChange={() => {
                      const next = new Set(selected);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      anchor.current = row.id;
                      onSelect(next, row.id);
                    }}
                    className="size-4"
                  />
                </div>
                {defs.map((d) => (
                  <div key={d.id} role="gridcell" className={`truncate px-2 ${d.numeric ? "text-right tabular-nums" : ""} ${suspended ? "text-ink-soft" : ""}`}>
                    {cellText(row, d.id, mode, day)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      {!rows.length && <p className="absolute inset-x-0 top-16 text-center text-ink-soft">Aramaya uyan kart yok.</p>}
    </div>
  );
}
