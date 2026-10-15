"use client";
// KART TARAYICI SOL PANELİ: tıklanınca arama oluşturur.
//   tıkla: aramayı değiştir · Ctrl/Cmd+tıkla: "ve" ile ekle
//   Shift+tıkla: "veya" ile ekle · Alt+tıkla: "değil" ile ekle
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { listTags } from "@/lib/browse/ops";
import type { DeckRow, NoteRow, NoteTypeRow } from "@/lib/db/types";
import { buildDeckTree, type DeckNode } from "@/lib/decks";
import { FLAG_COLORS, FLAG_NAMES } from "@/lib/flags";
import { quoteSearchValue } from "@/lib/search/parser";
import { noteTypeLabel } from "@/lib/notetypes/labels";

interface Props {
  decks: DeckRow[];
  noteTypes: NoteTypeRow[];
  notes: NoteRow[];
  query: string;
  onSearch: (q: string) => void;
}

/** Tıklama türüne göre yeni arama metni */
export function combineSearch(current: string, term: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): string {
  const cur = current.trim();
  if (e.altKey) return cur ? `(${cur}) -${term}` : `-${term}`;
  if (e.ctrlKey || e.metaKey) return cur ? `(${cur}) ${term}` : term;
  if (e.shiftKey) return cur ? `(${cur}) or ${term}` : term;
  return term;
}

interface TagNode {
  name: string; // tam ad
  label: string; // son parça
  count: number;
  children: TagNode[];
}

function tagTree(notes: NoteRow[]): TagNode[] {
  const roots: TagNode[] = [];
  const byName = new Map<string, TagNode>();
  for (const t of listTags(notes)) {
    const parts = t.name.split("::");
    let parent: TagNode[] = roots;
    let path = "";
    parts.forEach((p, i) => {
      path = path ? `${path}::${p}` : p;
      const key = path.toLocaleLowerCase("tr");
      let node = byName.get(key);
      if (!node) {
        node = { name: path, label: p, count: 0, children: [] };
        byName.set(key, node);
        parent.push(node);
      }
      if (i === parts.length - 1) node.count += t.count;
      parent = node.children;
    });
  }
  return roots;
}

function Section({ title, children, action, defaultOpen = true }: { title: string; children: ReactNode; action?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="py-1.5">
      <div className="flex items-center gap-1 px-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex flex-1 items-center gap-1 py-1 text-left text-xs font-semibold text-ink-soft hover:text-ink"
        >
          <Chevron open={open} />
          {title}
        </button>
        {action}
      </div>
      {open && <ul className="mt-0.5">{children}</ul>}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function Item({
  label,
  term,
  depth = 0,
  query,
  onSearch,
  count,
  icon,
  hasChildren,
  open,
  onToggle,
}: {
  label: string;
  term: string;
  depth?: number;
  query: string;
  onSearch: (q: string) => void;
  count?: number;
  icon?: ReactNode;
  hasChildren?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const active = query.trim() === term;
  return (
    <li className="flex items-center" style={{ paddingLeft: depth * 12 }}>
      {hasChildren ? (
        <button type="button" onClick={onToggle} aria-label={open ? "Daralt" : "Genişlet"} className="grid size-6 shrink-0 place-items-center text-ink-soft hover:text-ink">
          <Chevron open={!!open} />
        </button>
      ) : (
        <span className="size-6 shrink-0" />
      )}
      <button
        type="button"
        title={`${term}\nCtrl/Cmd: ve · Shift: veya · Alt: değil`}
        onClick={(e) => onSearch(combineSearch(query, term, e))}
        aria-current={active ? "true" : undefined}
        className="flex min-h-8 flex-1 items-center gap-2 truncate rounded-md px-1.5 text-left text-sm hover:bg-ink/5 aria-[current=true]:bg-accent/15 aria-[current=true]:font-medium"
      >
        {icon}
        <span className="truncate">{label}</span>
        {count !== undefined && <span className="ml-auto pl-2 text-xs tabular-nums text-ink-soft">{count}</span>}
      </button>
    </li>
  );
}

export function BrowseSidebar({ decks, noteTypes, notes, query, onSearch }: Props) {
  const tree = useMemo(() => buildDeckTree(decks), [decks]);
  const tags = useMemo(() => tagTree(notes), [notes]);
  const [openDecks, setOpenDecks] = useState<Set<string>>(new Set());
  const [openTags, setOpenTags] = useState<Set<string>>(new Set());
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };
  const common = { query, onSearch };

  const deckItems = (nodes: DeckNode[]): ReactNode =>
    nodes.map((n) => {
      const open = openDecks.has(n.deck.id);
      return (
        <li key={n.deck.id} className="list-none">
          <ul>
            <Item
              {...common}
              label={n.deck.name}
              term={`deck:${quoteSearchValue(n.fullName)}`}
              depth={n.depth}
              hasChildren={n.children.length > 0}
              open={open}
              onToggle={() => toggle(openDecks, setOpenDecks, n.deck.id)}
            />
            {open && deckItems(n.children)}
          </ul>
        </li>
      );
    });

  const tagItems = (nodes: TagNode[], depth: number): ReactNode =>
    nodes.map((t) => {
      const key = t.name.toLocaleLowerCase("tr");
      const open = openTags.has(key);
      return (
        <li key={key} className="list-none">
          <ul>
            <Item
              {...common}
              label={t.label}
              term={`tag:${quoteSearchValue(t.name)}`}
              depth={depth}
              count={t.count || undefined}
              hasChildren={t.children.length > 0}
              open={open}
              onToggle={() => toggle(openTags, setOpenTags, key)}
            />
            {open && tagItems(t.children, depth + 1)}
          </ul>
        </li>
      );
    });

  return (
    <nav aria-label="Filtreler" className="text-ink">
      <Section title="Kısayollar">
        <Item {...common} label="Tüm kartlar" term="" />
        <Item {...common} label="Zamanı gelenler" term="is:due" />
        <Item {...common} label="Bugün eklenenler" term="added:1" />
        <Item {...common} label="Bugün çalışılanlar" term="rated:1" />
        <Item {...common} label="Örnek cümlesi olmayanlar" term="examples:0" />
        <Item {...common} label="İşaretli notlar" term="tag:marked" />
      </Section>
      <Section title="Durum">
        <Item {...common} label="Yeni" term="is:new" />
        <Item {...common} label="Öğreniliyor" term="is:learn" />
        <Item {...common} label="Tekrar" term="is:review" />
        <Item {...common} label="Askıda" term="is:suspended" />
        <Item {...common} label="Yarına ertelenmiş" term="is:buried" />
      </Section>
      <Section title="Bayraklar" defaultOpen={false}>
        {FLAG_NAMES.map((name, i) =>
          i === 0 ? null : (
            <Item key={i} {...common} label={name} term={`flag:${i}`} icon={<span className="size-2.5 shrink-0 rounded-full" style={{ background: FLAG_COLORS[i] }} />} />
          ),
        )}
        <Item {...common} label="Bayraksız" term="flag:0" />
      </Section>
      <Section title="Desteler">{deckItems(tree)}</Section>
      <Section
        title="Not tipleri"
        action={
          <Link href="/not-tipleri" className="rounded px-1.5 py-0.5 text-xs text-accent hover:bg-accent/10">
            Yönet
          </Link>
        }
      >
        {[...noteTypes]
          .sort((a, b) => noteTypeLabel(a.name).localeCompare(noteTypeLabel(b.name), "tr"))
          .map((t) => (
            <Item key={t.id} {...common} label={noteTypeLabel(t.name)} term={`note:${quoteSearchValue(t.name)}`} />
          ))}
      </Section>
      <Section
        title="Etiketler"
        action={
          <Link href="/etiketler" className="rounded px-1.5 py-0.5 text-xs text-accent hover:bg-accent/10">
            Yönet
          </Link>
        }
      >
        {tags.length ? tagItems(tags, 0) : <li className="px-7 py-1 text-sm text-ink-soft">Etiket yok</li>}
      </Section>
    </nav>
  );
}
