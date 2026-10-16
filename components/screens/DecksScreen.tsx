"use client";
// DESTE LİSTESİ: ağaç görünümü, her destede Yeni / Öğrenme / Tekrar sayıları
// (alt desteler dahil, günlük sınırlara uygun), daralt/genişlet, sürükle-bırak
// ile taşıma (telefonda menüden "Taşı"), yeniden adlandır, sil.
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type DragEvent, type FormEvent, useMemo, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useUndo } from "@/components/app/undo";
import { useDayInfo, useDecks, useOptionsResolver } from "@/components/app/data";
import { Button, Dropdown, MenuItem, Modal, Notice } from "@/components/ui";
import { updateRow } from "@/lib/db/mutations";
import type { DeckRow } from "@/lib/db/types";
import {
  buildDeckTree,
  createDeckPath,
  type DeckNode,
  deleteDeckTree,
  flattenDeckTree,
  moveDeck,
  renameDeck,
  subtreeIds,
} from "@/lib/decks";
import { computeDeckCounts, type DeckCounts } from "@/lib/scheduler/queue";
import { FilteredDeckDialog } from "@/components/study/DeckTools";
import { StudyReminder } from "@/components/app/StudyReminder";
import { TidyBanner } from "@/components/app/TidyBanner";
import { defaultDeckId } from "@/lib/notetypes/builtins";
import { BOOSTS_SETTING, type Boosts, boostsForToday } from "@/lib/customStudy";
import { getSetting } from "@/lib/db/mutations";
import { buildFilteredDeck, deleteFilteredDeck, emptyFilteredDeck } from "@/lib/filtered";
import { loadSearchData } from "@/lib/search/load";

export function DecksScreen() {
  const { db } = useApp();
  const undo = useUndo();
  const decks = useDecks();
  const optionsFor = useOptionsResolver(decks);
  const { day, now } = useDayInfo();
  const cards = useLiveQuery(async () => (db ? db.cards.toArray() : []), [db]);
  const todayLogs = useLiveQuery(
    async () => (db ? db.review_logs.where("reviewed_at").aboveOrEqual(day.dayStart).toArray() : []),
    [db, day.dayStart],
  );
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const boostsRaw = useLiveQuery(async () => (db ? getSetting<Boosts | null>(db, BOOSTS_SETTING, null) : null), [db]);

  const counts = useMemo(() => {
    if (!decks || !cards || !todayLogs || !optionsFor) return null;
    return computeDeckCounts({ decks, cards, todayLogs, optionsFor, now, day, boosts: boostsForToday(boostsRaw ?? null, day.today) });
  }, [decks, cards, todayLogs, optionsFor, now, day, boostsRaw]);

  const cardTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards ?? []) if (c.deleted_at === null) m.set(c.deck_id, (m.get(c.deck_id) ?? 0) + 1);
    return m;
  }, [cards]);

  if (!db || !decks) return null;
  // Anki'deki gibi: boş "Varsayılan" deste (başka deste varken) listede gizlenir
  const def = defaultDeckId(db.userId);
  const hideDefault =
    decks.some((d) => d.id !== def && d.deleted_at === null) && !cardTotals.get(def) && !decks.some((d) => d.parent_id === def && d.deleted_at === null);
  const rows = flattenDeckTree(buildDeckTree(decks)).filter((n) => !(hideDefault && n.deck.id === def));
  // Alt destesi olan yoksa aç/kapa düğmesi için boşluk bırakılmaz
  const nested = rows.some((n) => n.children.length > 0);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const value = name;
    setName("");
    setError(null);
    try {
      await undo.run("Deste oluşturma", () => createDeckPath(db, value));
    } catch (err) {
      setName(value);
      setError((err as Error).message);
    }
  };

  const dropOn = async (targetId: string | null) => {
    if (!dragId || dragId === targetId) return;
    if (targetId && decks.find((d) => d.id === targetId)?.is_filtered) {
      setError("Filtreli destenin altına deste konamaz.");
      setDragId(null);
      return;
    }
    try {
      await undo.run("Deste taşıma", () => moveDeck(db, dragId, targetId));
    } catch (err) {
      setError((err as Error).message);
    }
    setDragId(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-[28px] font-semibold leading-tight">Desteler</h1>
        <div className="flex gap-2 text-sm">
          <Link href="/iceaktar" className="rounded-lg border border-rule bg-surface px-3.5 py-2 font-semibold hover:border-ink-soft">
            İçe aktar
          </Link>
          <Link href="/ekle" className="rounded-lg bg-accent px-3.5 py-2 font-semibold text-accent-ink hover:bg-accent-strong">
            Kart ekle
          </Link>
        </div>
      </div>
      <TidyBanner />
      <StudyReminder decks={decks} counts={counts} todayLogs={todayLogs} />

      <div className="overflow-hidden rounded-xl border border-rule bg-surface">
        <div className="h-1 bg-margin" aria-hidden />
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-ink-soft">
            Henüz deste yok. İndirdiğin bir desteyi “İçe aktar” ile ekleyebilir ya da aşağıdan boş bir deste oluşturabilirsin.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-rule py-2 pr-1 pl-3 text-xs font-semibold text-ink-soft">
              <span className="flex-1">Deste</span>
              <span className="w-10 text-center text-accent sm:w-20">Yeni</span>
              <span className="w-10 text-center text-warn sm:w-20" title="Öğrenme">
                <span className="sm:hidden">Öğr.</span>
                <span className="hidden sm:inline">Öğrenme</span>
              </span>
              <span className="w-10 text-center text-ok sm:w-20" title="Tekrar">
                <span className="sm:hidden">Tekr.</span>
                <span className="hidden sm:inline">Tekrar</span>
              </span>
              <span className="w-8" />
            </div>
            <ul>
              {rows.map((node) => (
                <DeckItem
                  key={node.deck.id}
                  node={node}
                  counts={counts?.get(node.deck.id)}
                  cardCount={subtreeIds(decks, node.deck.id).reduce((s, id) => s + (cardTotals.get(id) ?? 0), 0)}
                  dragging={dragId !== null}
                  onDragStart={() => setDragId(node.deck.id)}
                  onDragEnd={() => setDragId(null)}
                  onDrop={() => void dropOn(node.deck.id)}
                  decks={decks}
                  nested={nested}
                />
              ))}
            </ul>
            {dragId && (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => void dropOn(null)}
                className="m-2 rounded-lg border-2 border-dashed border-accent/50 px-3 py-3 text-center text-sm text-accent"
              >
                Buraya bırak: en üst seviyeye taşı
              </div>
            )}
          </>
        )}
      </div>

      <form onSubmit={create} className="flex gap-2">
        <label className="sr-only" htmlFor="deck-name">
          Yeni deste adı
        </label>
        <input
          id="deck-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Yeni deste adı"
          autoComplete="off"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-rule bg-surface px-3 text-base placeholder:text-ink-soft/70 focus:border-accent focus:outline-none"
        />
        <Button type="submit" variant="secondary" disabled={!name.trim()}>
          Deste oluştur
        </Button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
      {rows.length > 1 && (
        <p className="hidden text-sm text-ink-soft md:block">
          İpucu: Bir desteyi sürükleyip başka bir destenin üstüne bırakırsan onun alt destesi olur.
        </p>
      )}
    </div>
  );
}

function CountCell({ n, cls }: { n: number | undefined; cls: string }) {
  return (
    <span className={`w-10 text-center text-sm font-semibold tabular-nums sm:w-20 ${n ? cls : "text-ink-soft/40"}`}>{n ?? "·"}</span>
  );
}

function DeckItem({
  node,
  counts,
  cardCount,
  dragging,
  onDragStart,
  onDragEnd,
  onDrop,
  decks,
  nested,
}: {
  nested: boolean;
  node: DeckNode;
  counts: DeckCounts | undefined;
  cardCount: number;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  decks: DeckRow[];
}) {
  const { db } = useApp();
  const undo = useUndo();
  const [dialog, setDialog] = useState<"rename" | "delete" | "move" | "filter" | null>(null);
  const { day, now } = useDayInfo();
  const filtered = node.deck.is_filtered;
  const [draft, setDraft] = useState(node.deck.name);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const router = useRouter();
  const hasChildren = node.children.length > 0;

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    setOver(true);
  };
  const close = () => {
    setDialog(null);
    setError(null);
  };

  const menuItems: [string, () => void][] = filtered
    ? [
        [
          "Yeniden oluştur",
          async () => {
            const data = await loadSearchData(db!, day, now);
            await undo.run("Filtreli desteyi yeniden oluşturma", () => buildFilteredDeck(db!, node.deck, data));
          },
        ],
        ["Boşalt", () => void undo.run("Filtreli desteyi boşaltma", () => emptyFilteredDeck(db!, node.deck.id))],
        ["Filtreyi düzenle", () => setDialog("filter")],
        ["Ad değiştir", () => setDialog("rename")],
        ["Sil", () => setDialog("delete")],
      ]
    : [
        ["Ad değiştir", () => setDialog("rename")],
        ["Taşı", () => setDialog("move")],
        ["Kart ekle", () => router.push(`/ekle?deste=${node.deck.id}`)],
        ["Deste seçenekleri", () => router.push(`/deste-ayarlari?deste=${node.deck.id}`)],
        ["Sil", () => setDialog("delete")],
      ];

  return (
    <li className="border-b border-rule last:border-b-0">
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onDragOver={dragging ? onDragOver : undefined}
        onDragLeave={() => setOver(false)}
        onDrop={() => {
          setOver(false);
          onDrop();
        }}
        className={`flex min-h-13 items-center gap-2 py-1 pr-1 ${over ? "bg-accent/10" : ""}`}
        style={{ paddingLeft: `${(nested ? 4 : 12) + node.depth * 18}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="grid size-8 shrink-0 place-items-center rounded-md text-ink-soft hover:bg-ink/5"
            aria-label={node.deck.collapsed ? "Alt desteleri göster" : "Alt desteleri gizle"}
            aria-expanded={!node.deck.collapsed}
            onClick={() => void updateRow(db!, "decks", node.deck.id, { collapsed: !node.deck.collapsed })}
          >
            <svg viewBox="0 0 24 24" className={`size-4 transition-transform ${node.deck.collapsed ? "" : "rotate-90"}`} aria-hidden>
              <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        ) : nested ? (
          <span className="size-8 shrink-0" aria-hidden />
        ) : null}
        <Link
          href={`/calis?deste=${node.deck.id}`}
          className="line-clamp-2 min-w-0 flex-1 py-2 text-[16px] font-medium leading-snug break-words hover:text-accent"
          title={filtered ? `${node.fullName} (filtreli deste)` : node.fullName}
        >
          {filtered && (
            <span className="mr-1.5 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-semibold text-accent" aria-label="filtreli deste">
              F
            </span>
          )}
          {node.deck.name}
        </Link>
        <CountCell n={counts?.new} cls="text-accent" />
        <CountCell n={counts?.learn} cls="text-warn" />
        <CountCell n={counts?.review} cls="text-ok" />
        <Dropdown
          label={`${node.deck.name} menüsü`}
          width={208}
          className="grid size-8 shrink-0 place-items-center rounded-md text-ink-soft hover:bg-ink/5"
          trigger="⋯"
        >
          {(closeMenu) =>
            menuItems.map(([label, fn]) => (
              <MenuItem
                key={label}
                danger={label === "Sil"}
                onClick={() => {
                  closeMenu();
                  fn();
                }}
              >
                {label}
              </MenuItem>
            ))
          }
        </Dropdown>
      </div>

      {dialog === "rename" && (
        <Modal title="Desteyi yeniden adlandır" onClose={close}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await undo.run("Deste adı değiştirme", () => renameDeck(db!, node.deck.id, draft));
                close();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
            className="space-y-3"
          >
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Yeni ad"
              className="min-h-11 w-full rounded-lg border border-rule bg-surface px-3 text-base focus:border-accent focus:outline-none"
            />
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit">Kaydet</Button>
          </form>
        </Modal>
      )}

      {dialog === "move" && (
        <Modal title={`“${node.deck.name}” nereye taşınsın?`} onClose={close}>
          <MovePicker
            decks={decks}
            excluded={new Set(subtreeIds(decks, node.deck.id))}
            onPick={async (parentId) => {
              try {
                await undo.run("Deste taşıma", () => moveDeck(db!, node.deck.id, parentId));
                close();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          />
          {error && <Notice tone="error">{error}</Notice>}
        </Modal>
      )}

      {dialog === "filter" && <FilteredDeckDialog deck={node.deck} onClose={close} />}
      {dialog === "delete" && (
        <Modal title="Desteyi sil" onClose={close}>
          <p>
            “{node.fullName}”{hasChildren ? " ve alt desteleri" : ""} silinsin mi?
            {filtered
              ? " İçindeki kartlar kendi destelerine döner, silinmez."
              : cardCount > 0 && <strong> İçindeki {cardCount} kart da silinecek.</strong>}
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              variant="danger"
              onClick={async () => {
                await undo.run("Deste silme", async () => {
                  if (filtered) await deleteFilteredDeck(db!, node.deck.id);
                  else await deleteDeckTree(db!, node.deck.id);
                });
                close();
              }}
            >
              Sil
            </Button>
            <Button variant="ghost" onClick={close}>
              Vazgeç
            </Button>
          </div>
        </Modal>
      )}
    </li>
  );
}

function MovePicker({
  decks,
  excluded,
  onPick,
}: {
  decks: DeckRow[];
  excluded: Set<string>;
  onPick: (parentId: string | null) => void;
}) {
  const options = flattenDeckTree(buildDeckTree(decks), true).filter((n) => !excluded.has(n.deck.id));
  return (
    <ul className="divide-y divide-rule rounded-lg border border-rule">
      <li>
        <button type="button" onClick={() => onPick(null)} className="block w-full px-3 py-2.5 text-left font-medium hover:bg-ink/5">
          En üst seviye
        </button>
      </li>
      {options.map((n) => (
        <li key={n.deck.id}>
          <button
            type="button"
            onClick={() => onPick(n.deck.id)}
            className="block w-full px-3 py-2.5 text-left hover:bg-ink/5"
            style={{ paddingLeft: `${12 + n.depth * 16}px` }}
          >
            {n.deck.name}
          </button>
        </li>
      ))}
    </ul>
  );
}
