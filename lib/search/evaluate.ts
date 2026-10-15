// ARAMAYI ÇALIŞTIRMA: ayrıştırılmış aramayı (AST) cihazdaki kartlara uygular.
// Tüm veri bellekte süzülür (birkaç on bin kart için hızlıdır).
//
// Kararlar:
//  - Metin aramaları HTML etiketleri atılmış alan içeriğinde yapılır.
//  - Büyük/küçük harf duyarsızdır; nc: ayrıca aksanları yok sayar (ş→s, ı→i …).
//  - deck:Ad alt desteleri de kapsar; tag:ad alt etiketleri (ad::alt) de kapsar.
import type { CardRow, DeckRow, NoteRow, NoteTypeRow, ReviewLogRow } from "@/lib/db/types";
import { buildDeckTree, flattenDeckTree } from "@/lib/decks";
import { DEFAULT_DECK_OPTIONS } from "@/lib/scheduler/config";
import type { DayInfo } from "@/lib/scheduler/day";
import { retrievability } from "@/lib/scheduler/fsrs";
import { stripHtml } from "@/lib/text";
import { type CompareOp, parseSearch, SearchError, type SearchNode, type Term, wildcardToRegex } from "./parser";

const DAY = 86_400_000;

export interface SearchData {
  cards: CardRow[];
  notes: NoteRow[];
  noteTypes: NoteTypeRow[];
  decks: DeckRow[];
  /** Not başına onaylı örnek cümle sayısı */
  exampleCounts: Map<string, number>;
  /** Sadece rated:/introduced: için gerekir (yoksa boş kabul edilir) */
  logs?: ReviewLogRow[];
  now: number;
  day: DayInfo;
}

/** Bu arama cevap geçmişine ihtiyaç duyuyor mu? (geçmişi gereksiz yüklememek için) */
export function needsLogs(node: SearchNode): boolean {
  if (node.type === "term") return node.term.kind === "rated" || node.term.kind === "introduced";
  if (node.type === "not") return needsLogs(node.child);
  if (node.type === "and" || node.type === "or") return node.children.some(needsLogs);
  return false;
}

/** Aksanları ve Türkçe özel harfleri sadeleştirir (nc: için) */
export function foldAccents(s: string): string {
  return s
    .replace(/[ıİI]/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** HLC damgasından duvar saati (ms) */
function hlcWall(hlc: string): number {
  return Number(hlc.slice(0, 15)) || 0;
}

function compare(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    case "=":
      return Math.abs(a - b) < 1e-9;
    case "!=":
      return Math.abs(a - b) >= 1e-9;
  }
}

type Pred = (card: CardRow) => boolean;

class Context {
  readonly noteById: Map<string, NoteRow>;
  readonly typeById: Map<string, NoteTypeRow>;
  readonly deckFullName = new Map<string, string>();
  private textCache = new Map<string, string>();
  private foldCache = new Map<string, string>();
  private fieldCache = new Map<string, Map<string, string>>();
  private logsByCard: Map<string, ReviewLogRow[]> | null = null;

  constructor(readonly data: SearchData) {
    this.noteById = new Map(data.notes.filter((n) => n.deleted_at === null).map((n) => [n.id, n]));
    this.typeById = new Map(data.noteTypes.map((t) => [t.id, t]));
    for (const n of flattenDeckTree(buildDeckTree(data.decks.filter((d) => d.deleted_at === null)), true)) {
      this.deckFullName.set(n.deck.id, n.fullName);
    }
  }

  /** Notun tüm alanları, HTML'siz, tek metin */
  noteText(note: NoteRow): string {
    let t = this.textCache.get(note.id);
    if (t === undefined) {
      t = Object.values(note.fields).map(stripHtml).join("\u001f");
      this.textCache.set(note.id, t);
    }
    return t;
  }

  noteFolded(note: NoteRow): string {
    let t = this.foldCache.get(note.id);
    if (t === undefined) {
      t = foldAccents(this.noteText(note));
      this.foldCache.set(note.id, t);
    }
    return t;
  }

  /** Alan adı (küçük harf) → HTML'siz değer */
  fieldsByName(note: NoteRow): Map<string, string> {
    let m = this.fieldCache.get(note.id);
    if (!m) {
      m = new Map();
      const nt = this.typeById.get(note.note_type_id);
      for (const f of nt?.fields ?? []) m.set(f.name.toLowerCase(), stripHtml(note.fields[f.id] ?? ""));
      this.fieldCache.set(note.id, m);
    }
    return m;
  }

  cardLogs(cardId: string): ReviewLogRow[] {
    if (!this.logsByCard) {
      this.logsByCard = new Map();
      for (const l of this.data.logs ?? []) {
        if (l.deleted_at !== null) continue;
        const list = this.logsByCard.get(l.card_id);
        if (list) list.push(l);
        else this.logsByCard.set(l.card_id, [l]);
      }
    }
    return this.logsByCard.get(cardId) ?? [];
  }

  /** n gün önceki günün başlangıcı (bugün = 1) */
  since(days: number): number {
    return this.data.day.dayStart - (days - 1) * DAY;
  }
}

function regexFrom(pattern: string, flags = "i"): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch {
    throw new SearchError(`Geçersiz düzenli ifade: ${pattern}`);
  }
}

function compileTerm(term: Term, ctx: Context): Pred {
  const note = (c: CardRow) => ctx.noteById.get(c.note_id);
  const { now, day } = ctx.data;

  switch (term.kind) {
    case "text": {
      const re = wildcardToRegex(term.pattern, false);
      return (c) => {
        const n = note(c);
        return !!n && re.test(ctx.noteText(n));
      };
    }
    case "nc": {
      const re = wildcardToRegex(foldAccents(term.text), false);
      return (c) => {
        const n = note(c);
        return !!n && re.test(ctx.noteFolded(n));
      };
    }
    case "re": {
      const re = regexFrom(term.pattern);
      return (c) => {
        const n = note(c);
        return !!n && Object.values(n.fields).some((v) => re.test(stripHtml(v)));
      };
    }
    case "field": {
      const nameRe = wildcardToRegex(term.field, true);
      const valueRe = term.regex ? regexFrom(term.pattern) : wildcardToRegex(term.pattern, true);
      return (c) => {
        const n = note(c);
        if (!n) return false;
        for (const [name, value] of ctx.fieldsByName(n)) if (nameRe.test(name) && valueRe.test(value)) return true;
        return false;
      };
    }
    case "deck": {
      const re = wildcardToRegex(term.pattern, true);
      const ids = new Set<string>();
      for (const [id, name] of ctx.deckFullName) {
        // Destenin kendisi veya üst destelerinden biri eşleşiyorsa
        const parts = name.split("::");
        for (let i = 1; i <= parts.length; i++) {
          if (re.test(parts.slice(0, i).join("::"))) {
            ids.add(id);
            break;
          }
        }
      }
      return (c) => ids.has(c.deck_id);
    }
    case "tag": {
      if (term.pattern.toLowerCase() === "none") return (c) => (note(c)?.tags.length ?? 0) === 0;
      const re = wildcardToRegex(term.pattern, true);
      const matches = (tag: string) => {
        const parts = tag.split("::");
        for (let i = 1; i <= parts.length; i++) if (re.test(parts.slice(0, i).join("::"))) return true;
        return false;
      };
      return (c) => !!note(c)?.tags.some(matches);
    }
    case "note": {
      const re = wildcardToRegex(term.pattern, true);
      const ids = new Set(ctx.data.noteTypes.filter((t) => re.test(t.name)).map((t) => t.id));
      return (c) => {
        const n = note(c);
        return !!n && ids.has(n.note_type_id);
      };
    }
    case "card": {
      if (/^\d+$/.test(term.pattern)) {
        const ord = Number(term.pattern) - 1;
        return (c) => c.ord === ord;
      }
      const re = wildcardToRegex(term.pattern, true);
      return (c) => {
        const n = note(c);
        const nt = n && ctx.typeById.get(n.note_type_id);
        if (!nt) return false;
        if (nt.kind === "cloze" || nt.kind === "image_occlusion") return re.test(nt.templates[0]?.name ?? "");
        const t = nt.templates[c.ord];
        return !!t && re.test(t.name);
      };
    }
    case "is":
      switch (term.value) {
        case "new":
          return (c) => c.state === 0;
        case "learn":
          return (c) => c.state === 1 || c.state === 3;
        case "review":
          return (c) => c.state === 2 || c.state === 3;
        case "due":
          return (c) => c.state !== 0 && !c.suspended && c.due < day.nextDayStart && !(c.buried_until && c.buried_until > now);
        case "suspended":
          return (c) => c.suspended;
        case "buried":
          return (c) => !!c.buried_until && c.buried_until > now;
      }
      break;
    case "flag":
      return (c) => c.flags === term.value;
    case "prop": {
      const { op, value } = term;
      switch (term.prop) {
        case "ivl":
          return (c) => c.state !== 0 && compare(c.interval_days, op, value);
        case "due":
          // Bugüne göre gün farkı (0 = bugün, 1 = yarın, -1 = dün)
          return (c) => c.state !== 0 && compare(Math.floor((c.due - day.dayStart) / DAY), op, value);
        case "reps":
          return (c) => compare(c.reps, op, value);
        case "lapses":
          return (c) => compare(c.lapses, op, value);
        case "ease":
          return (c) => c.state !== 0 && compare(c.ease / 1000, op, value);
        case "pos":
          return (c) => c.state === 0 && compare(c.position, op, value);
        case "s":
          return (c) => c.state !== 0 && compare(c.stability, op, value);
        case "d":
          // Anki ölçeği: 0 (kolay) – 1 (zor); FSRS zorluğu 1–10
          return (c) => c.state !== 0 && compare((c.difficulty - 1) / 9, op, value);
        case "r":
          return (c) => {
            const r = retrievability(c, DEFAULT_DECK_OPTIONS, now);
            return r !== null && compare(r, op, value);
          };
      }
      break;
    }
    case "rated": {
      const since = ctx.since(term.days);
      return (c) => ctx.cardLogs(c.id).some((l) => l.reviewed_at >= since && l.rating > 0 && (term.ease === null || l.rating === term.ease));
    }
    case "introduced": {
      const since = ctx.since(term.days);
      return (c) => {
        const logs = ctx.cardLogs(c.id).filter((l) => l.rating > 0);
        if (!logs.length) return false;
        const first = Math.min(...logs.map((l) => l.reviewed_at));
        return first >= since;
      };
    }
    case "added": {
      const since = ctx.since(term.days);
      return (c) => c.created_at >= since;
    }
    case "edited": {
      const since = ctx.since(term.days);
      return (c) => {
        const n = note(c);
        return !!n && hlcWall(n.updated_at) >= since;
      };
    }
    case "dupe": {
      const want = term.text.trim().toLowerCase();
      const types = ctx.data.noteTypes.filter((t) => t.id === term.noteType || t.name.toLowerCase() === term.noteType.toLowerCase());
      const typeIds = new Set(types.map((t) => t.id));
      return (c) => {
        const n = note(c);
        if (!n || !typeIds.has(n.note_type_id)) return false;
        const nt = ctx.typeById.get(n.note_type_id)!;
        const first = nt.fields[0];
        return !!first && stripHtml(n.fields[first.id] ?? "").trim().toLowerCase() === want;
      };
    }
    case "examples":
      return (c) => compare(ctx.data.exampleCounts.get(c.note_id) ?? 0, term.op, term.value);
    case "nid": {
      const ids = new Set(term.ids);
      return (c) => ids.has(c.note_id);
    }
    case "cid": {
      const ids = new Set(term.ids);
      return (c) => ids.has(c.id);
    }
  }
  throw new SearchError("Desteklenmeyen arama terimi.");
}

function compile(node: SearchNode, ctx: Context): Pred {
  switch (node.type) {
    case "all":
      return () => true;
    case "term":
      return compileTerm(node.term, ctx);
    case "not": {
      const p = compile(node.child, ctx);
      return (c) => !p(c);
    }
    case "and": {
      const ps = node.children.map((n) => compile(n, ctx));
      return (c) => ps.every((p) => p(c));
    }
    case "or": {
      const ps = node.children.map((n) => compile(n, ctx));
      return (c) => ps.some((p) => p(c));
    }
  }
}

/** Arama metnine uyan (silinmemiş) kartları döndürür. Hatalı aramada SearchError. */
export function searchCards(query: string | SearchNode, data: SearchData): CardRow[] {
  const ast = typeof query === "string" ? parseSearch(query) : query;
  const ctx = new Context(data);
  const pred = compile(ast, ctx);
  return data.cards.filter((c) => c.deleted_at === null && ctx.noteById.has(c.note_id) && pred(c));
}
