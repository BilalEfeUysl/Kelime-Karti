"use client";
// KART TARAYICI (/kartlar): tüm kartları/notları ara, sırala, toplu düzenle.
// Her şey cihazdaki veritabanında çalışır (internet gerekmez).
//   Ctrl/Cmd+F: aramaya git · Ctrl+1..7: seçili kartlara bayrak
//   Ctrl/Cmd+Z / Shift+Z: geri al / yinele (genel)
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useShell } from "@/components/app/AppShell";
import { useDayInfo } from "@/components/app/data";
import { useUndo } from "@/components/app/undo";
import { BrowseTable } from "@/components/browse/BrowseTable";
import { BulkActions, type Selection } from "@/components/browse/BulkActions";
import {
  type BrowseMode,
  COLUMNS,
  type ColumnId,
  DEFAULT_COLUMNS,
  type SortState,
  useBrowseBase,
  useBrowseRows,
} from "@/components/browse/data";
import { DetailPanel } from "@/components/browse/DetailPanel";
import { BrowseSidebar } from "@/components/browse/Sidebar";
import { FilteredDeckDialog } from "@/components/study/DeckTools";
import { Button, Modal, Notice, Spinner } from "@/components/ui";
import { toggleFlag } from "@/lib/study/actions";
import { readJSON, writeJSON } from "@/lib/storage";

const MODE_KEY = "kk.browse.mode";
const colsKey = (m: BrowseMode) => `kk.browse.columns.${m}`;
const sortKey = (m: BrowseMode) => `kk.browse.sort.${m}`;

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return narrow;
}

export function BrowserScreen() {
  const { db } = useApp();
  const { setWide } = useShell();
  const undo = useUndo();
  const router = useRouter();
  const params = useSearchParams();
  const { day } = useDayInfo();
  const narrow = useIsNarrow();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setWide(true);
    return () => setWide(false);
  }, [setWide]);

  const urlQuery = params.get("q") ?? "";
  const [input, setInput] = useState(urlQuery);
  const [query, setQuery] = useState(urlQuery);
  useEffect(() => {
    setInput(urlQuery);
    setQuery(urlQuery);
  }, [urlQuery]);

  const [mode, setModeState] = useState<BrowseMode>("cards");
  const [columns, setColumns] = useState<ColumnId[]>(DEFAULT_COLUMNS.cards);
  const [sort, setSort] = useState<SortState>({ column: "sortField", desc: false });
  useEffect(() => {
    const m = readJSON<BrowseMode>(MODE_KEY) === "notes" ? "notes" : "cards";
    setModeState(m);
    setColumns(readJSON<ColumnId[]>(colsKey(m)) ?? DEFAULT_COLUMNS[m]);
    setSort(readJSON<SortState>(sortKey(m)) ?? { column: "sortField", desc: false });
  }, []);
  const setMode = (m: BrowseMode) => {
    setModeState(m);
    writeJSON(MODE_KEY, m);
    setColumns(readJSON<ColumnId[]>(colsKey(m)) ?? DEFAULT_COLUMNS[m]);
    setSort(readJSON<SortState>(sortKey(m)) ?? { column: "sortField", desc: false });
    setSelected(new Set());
    setCurrent(null);
  };
  const changeSort = (s: SortState) => {
    setSort(s);
    writeJSON(sortKey(mode), s);
  };
  const changeColumns = (c: ColumnId[]) => {
    setColumns(c);
    writeJSON(colsKey(mode), c);
  };

  const base = useBrowseBase();
  const { rows, error, loading } = useBrowseRows(base, query, mode, sort);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [filteredOpen, setFilteredOpen] = useState(false);

  // Arama değişince seçimi temizle; silinen satırları seçimden çıkar
  useEffect(() => {
    setSelected(new Set());
    setCurrent(null);
  }, [query, mode]);
  const rowIds = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const liveSelected = useMemo(() => new Set([...selected].filter((id) => rowIds.has(id))), [selected, rowIds]);
  const currentRow = rows.find((r) => r.id === current) ?? null;

  const selection: Selection = useMemo(() => {
    const chosen = rows.filter((r) => liveSelected.has(r.id));
    if (mode === "cards") {
      const notes = new Map(chosen.map((r) => [r.note.id, r.note]));
      return { cards: chosen.map((r) => r.card), notes: [...notes.values()] };
    }
    const noteIds = new Set(chosen.map((r) => r.note.id));
    const cards = (base?.cards ?? []).filter((c) => c.deleted_at === null && noteIds.has(c.note_id));
    return { cards, notes: chosen.map((r) => r.note) };
  }, [rows, liveSelected, mode, base]);

  const search = useCallback(
    (q: string) => {
      setInput(q);
      setQuery(q);
      setFiltersOpen(false);
      router.replace(q ? `/kartlar?q=${encodeURIComponent(q)}` : "/kartlar", { scroll: false });
    },
    [router],
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    search(input.trim());
  };

  const flash = useCallback((text: string) => {
    setMessage(text);
    setTimeout(() => setMessage((m) => (m === text ? null : m)), 2500);
  }, []);

  // Kısayollar: Ctrl/Cmd+F arama, Ctrl+1..7 bayrak
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (!typing && e.ctrlKey && /^[1-7]$/.test(e.key) && db && selectionRef.current.cards.length) {
        e.preventDefault();
        const ids = selectionRef.current.cards.map((c) => c.id);
        void undo.run("Bayrak", () => toggleFlag(db, ids, Number(e.key)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [db, undo]);

  if (!db) return null;
  const count = rows.length;
  const tableHeight = narrow ? "calc(100dvh - 330px)" : "calc(100dvh - 240px)";

  const sidebar = base ? <BrowseSidebar decks={base.decks} noteTypes={base.noteTypes} notes={base.notes} query={query} onSearch={search} /> : null;
  const detail =
    currentRow && base ? (
      <DetailPanel card={currentRow.card} note={currentRow.note} noteType={currentRow.noteType} deckName={currentRow.deckName} decks={base.decks} />
    ) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-[28px] font-semibold leading-tight">Kartlar</h1>
        <span className="text-sm text-ink-soft" aria-live="polite">
          {loading ? "" : `${count.toLocaleString("tr-TR")} ${mode === "cards" ? "kart" : "not"}`}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <div role="radiogroup" aria-label="Görünüm" className="flex rounded-lg border border-rule bg-surface p-0.5 text-sm">
            {(
              [
                ["cards", "Kartlar"],
                ["notes", "Notlar"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className="rounded-md px-3 py-1 font-medium text-ink-soft aria-checked:bg-accent aria-checked:text-accent-ink"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="hidden sm:block">
            <ColumnsMenu mode={mode} columns={columns} onChange={changeColumns} />
          </div>
          <button
            type="button"
            onClick={() => setFilteredOpen(true)}
            disabled={!query.trim() || !!error}
            title={query.trim() ? "Bu aramadaki kartları geçici bir desteye toplayıp çalış" : "Önce bir arama yap ya da soldan bir filtre seç"}
            className="rounded-md px-2.5 py-1.5 text-sm font-medium text-ink-soft hover:bg-ink/5 hover:text-ink disabled:opacity-40"
          >
            Bunları çalış
          </button>
        </div>
      </div>

      <form onSubmit={submit} className="flex gap-2" role="search">
        <button type="button" onClick={() => setFiltersOpen(true)} className="rounded-lg border border-rule bg-surface px-3 text-sm font-medium xl:hidden">
          Filtreler
        </button>
        <input
          ref={searchRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Kelime, anlam ya da etiket ara"
          aria-label="Arama"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-rule bg-surface px-3 text-base placeholder:text-ink-soft/70 focus:border-accent focus:outline-none"
        />
        <Button type="submit">Ara</Button>
        <button type="button" onClick={() => setHelpOpen(true)} className="rounded-lg px-2.5 text-sm text-ink-soft hover:text-ink" title="Gelişmiş arama" aria-label="Gelişmiş arama yardımı">
          ?
        </button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-lg bg-surface/60 px-2 text-sm">
        {selection.cards.length || selection.notes.length ? (
          <>
            <span className="font-medium">
              {mode === "cards" ? `${liveSelected.size} kart seçili` : `${liveSelected.size} not seçili`}
            </span>
            <BulkActions selection={selection} noteTypes={base?.noteTypes ?? []} allNotes={base?.notes ?? []} onDone={flash} onSearch={search} />
            <button type="button" onClick={() => setSelected(new Set())} className="rounded-md px-2 py-1 text-ink-soft hover:text-ink">
              Seçimi temizle
            </button>
          </>
        ) : (
          <span className="text-ink-soft">
            Düzenlemek için bir karta tıkla.<span className="hidden lg:inline"> Birden çok kart seçmek için Shift ya da Ctrl/Cmd tuşuna basılı tut.</span>
          </span>
        )}
        {message && (
          <span role="status" className="ml-auto font-medium text-ok">
            {message}
          </span>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[200px_minmax(0,1fr)_360px] 2xl:grid-cols-[230px_minmax(0,1fr)_420px]">
        <aside className="hidden overflow-y-auto rounded-xl border border-rule bg-surface p-1.5 xl:block" style={{ height: tableHeight }}>
          {sidebar}
        </aside>
        {loading ? (
          <Spinner />
        ) : (
          <BrowseTable
            rows={rows}
            mode={mode}
            columns={columns}
            sort={sort}
            onSort={changeSort}
            selected={liveSelected}
            current={current}
            onSelect={(s, c) => {
              setSelected(s);
              setCurrent(c);
            }}
            onActivate={() => narrow && setMobileDetail(true)}
            onOpen={() => narrow && setMobileDetail(true)}
            day={day}
            height={tableHeight}
          />
        )}
        <section aria-label="Seçili not" className="hidden overflow-y-auto lg:block" style={{ height: tableHeight }}>
          {detail ?? <p className="rounded-xl border border-dashed border-rule p-6 text-center text-sm text-ink-soft">Düzenlemek ya da nasıl göründüğüne bakmak için soldan bir kart seç.</p>}
        </section>
      </div>

      {filtersOpen && (
        <Modal title="Filtreler" onClose={() => setFiltersOpen(false)}>
          {sidebar}
        </Modal>
      )}
      {narrow && mobileDetail && detail && (
        <Modal title={currentRow?.note.sort_field || "Not"} onClose={() => setMobileDetail(false)} wide>
          {detail}
        </Modal>
      )}
      {filteredOpen && <FilteredDeckDialog initialSearch={query} onClose={() => setFilteredOpen(false)} />}
      {helpOpen && <SearchHelp onClose={() => setHelpOpen(false)} onSearch={(q) => (search(q), setHelpOpen(false))} />}
    </div>
  );
}

function ColumnsMenu({ mode, columns, onChange }: { mode: BrowseMode; columns: ColumnId[]; onChange: (c: ColumnId[]) => void }) {
  const [open, setOpen] = useState(false);
  const available = COLUMNS.filter((c) => mode === "notes" || c.id !== "cardCount");
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-md px-2.5 py-1.5 text-sm font-medium text-ink-soft hover:bg-ink/5 hover:text-ink">
        Sütunlar ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-lg border border-rule bg-surface p-1.5 shadow-lg">
            {available.map((c) => {
              const on = columns.includes(c.id);
              return (
                <label key={c.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-ink/5">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={on && columns.length === 1}
                    onChange={() => onChange(on ? columns.filter((x) => x !== c.id) : COLUMNS.map((x) => x.id).filter((id) => id === c.id || columns.includes(id)))}
                    className="size-4"
                  />
                  {c.label}
                </label>
              );
            })}
            <button type="button" onClick={() => onChange(DEFAULT_COLUMNS[mode])} className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-sm text-accent hover:bg-accent/10">
              Varsayılana dön
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const HELP: [string, string][] = [
  ["abandon", "herhangi bir alanda “abandon” geçenler"],
  ['"terk etmek"', "tam ifade"],
  ["a*n  /  d_g", "joker: * birden çok, _ tek karakter"],
  ["-tag:zor", "olumsuz (değil)"],
  ["fiil or isim", "veya; (a or b) c ile grupla"],
  ["deck:YDS", "deste (alt desteler dahil)"],
  ["tag:yds::fiil", "etiket (alt etiketler dahil); tag:none etiketsiz"],
  ["note:Cloze  /  card:2", "not tipi / kart şablonu"],
  ["front:abandon  /  back:*etmek*", "alan araması (tam eşleşme, jokerle kısmi)"],
  ["is:new  is:learn  is:review", "yeni / öğreniliyor / tekrar"],
  ["is:due  is:suspended  is:buried", "zamanı gelmiş / askıda / yarına ertelenmiş"],
  ["flag:1", "kırmızı bayrak (0 = bayraksız)"],
  ["prop:ivl>=30", "aralık 30 gün ve üstü (ivl, due, reps, lapses, ease, s, d, r, pos)"],
  ["prop:due=1", "yarın gelecekler"],
  ["rated:7:1", "son 7 günde “Tekrar”a basılanlar"],
  ["added:3  edited:1  introduced:7", "eklenen / düzenlenen / ilk kez çalışılan"],
  ["re:^ab  nc:isik", "düzenli ifade / aksansız arama"],
  ["examples:0  examples<3", "örnek cümle sayısı"],
];

function SearchHelp({ onClose, onSearch }: { onClose: () => void; onSearch: (q: string) => void }) {
  return (
    <Modal title="Gelişmiş arama" onClose={onClose} wide>
      <p className="mb-3 text-sm text-ink-soft">
        Boşlukla ayrılan terimlerin hepsi aranır (“ve”). Büyük/küçük harf fark etmez. Sol paneldeki bir öğeye Ctrl/Cmd ile tıklarsan aramaya “ve”, Shift ile “veya”, Alt ile “değil” olarak eklenir.
      </p>
      <dl className="divide-y divide-rule text-sm">
        {HELP.map(([q, d]) => (
          <div key={q} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-2">
            <dt className="min-w-48">
              <button type="button" onClick={() => onSearch(q.split("  ")[0])} className="font-mono text-accent hover:underline">
                {q}
              </button>
            </dt>
            <dd className="text-ink-soft">{d}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
