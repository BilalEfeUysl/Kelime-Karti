// .apkg / .colpkg AYRIŞTIRICI
//
// Üç format desteklenir:
//  a) collection.anki2 / collection.anki21 (şema 11): not tipleri ve desteler
//     "col" tablosundaki JSON'da; medya eşleme dosyası JSON.
//  b) collection.anki21b (şema 18, zstd ile sıkıştırılmış SQLite): not tipleri,
//     alanlar, şablonlar, desteler ayrı tablolarda (protobuf); medya eşleme
//     dosyası protobuf + zstd; medya dosyaları da zstd ile sıkıştırılmış.
//  c) Yeni Anki sürümleri genelde "lütfen güncelleyin" yazan sahte bir
//     collection.anki2 ile asıl veriyi anki21b'ye koyar → anki21b varsa O kullanılır.
//
// Sonuç, formattan bağımsız bir ara yapıdır (AnkiPackage); yazma işi writer'da.
import type { Database, SqlJsStatic } from "sql.js";
import { decodeProto, listZipEntries, maybeZstd, proto, readZipEntries } from "./binary";

export interface AnkiNoteType {
  ankiId: number;
  name: string;
  kind: "standard" | "cloze";
  fields: { name: string; ord: number; sticky: boolean }[];
  templates: { name: string; ord: number; front: string; back: string }[];
  css: string;
  sortFieldIdx: number;
}

export interface AnkiDeck {
  ankiId: number;
  name: string; // "Ana::Alt"
  filtered: boolean;
}

export interface AnkiNote {
  ankiId: number;
  guid: string;
  noteTypeId: number;
  fields: string[];
  tags: string[];
}

export interface AnkiCard {
  ankiId: number;
  noteId: number;
  deckId: number;
  ord: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  originalDeckId: number;
  flags: number;
  data: string;
}

export interface AnkiRevlog {
  id: number; // cevap zamanı (ms)
  cardId: number;
  ease: number;
  ivl: number;
  lastIvl: number;
  factor: number;
  time: number;
  type: number;
}

export interface AnkiMediaFile {
  name: string; // kartlardaki ad (ör. "kedi.png")
  entry: string; // zip içindeki dosya adı ("0", "1", …)
}

export interface AnkiPackage {
  format: "anki2" | "anki21" | "anki21b";
  collectionCreated: number; // col.crt (saniye)
  noteTypes: AnkiNoteType[];
  decks: AnkiDeck[];
  notes: AnkiNote[];
  cards: AnkiCard[];
  revlog: AnkiRevlog[];
  media: AnkiMediaFile[];
}

function rows<T extends Record<string, unknown>>(db: Database, sql: string): T[] {
  const res = db.exec(sql);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])) as T);
}

function hasTable(db: Database, name: string): boolean {
  return rows(db, `select name from sqlite_master where type='table' and name='${name}'`).length > 0;
}

const splitTags = (tags: string) => tags.split(/\s+/).filter(Boolean);

function readCommon(db: Database): Pick<AnkiPackage, "notes" | "cards" | "revlog" | "collectionCreated"> {
  const crt = Number(rows<{ crt: number }>(db, "select crt from col")[0]?.crt ?? 0);
  const notes = rows<{ id: number; guid: string; mid: number; flds: string; tags: string }>(
    db,
    "select id, guid, mid, flds, tags from notes",
  ).map((n) => ({
    ankiId: Number(n.id),
    guid: String(n.guid),
    noteTypeId: Number(n.mid),
    fields: String(n.flds).split("\x1f"),
    tags: splitTags(String(n.tags)),
  }));
  const cards = rows<Record<string, number | string>>(
    db,
    "select id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, odid, flags, data from cards",
  ).map((c) => ({
    ankiId: Number(c.id),
    noteId: Number(c.nid),
    deckId: Number(c.did),
    ord: Number(c.ord),
    type: Number(c.type),
    queue: Number(c.queue),
    due: Number(c.due),
    ivl: Number(c.ivl),
    factor: Number(c.factor),
    reps: Number(c.reps),
    lapses: Number(c.lapses),
    originalDeckId: Number(c.odid),
    flags: Number(c.flags) & 7,
    data: String(c.data ?? ""),
  }));
  const revlog = hasTable(db, "revlog")
    ? rows<Record<string, number>>(db, "select id, cid, ease, ivl, lastIvl, factor, time, type from revlog").map((r) => ({
        id: Number(r.id),
        cardId: Number(r.cid),
        ease: Number(r.ease),
        ivl: Number(r.ivl),
        lastIvl: Number(r.lastIvl),
        factor: Number(r.factor),
        time: Number(r.time),
        type: Number(r.type),
      }))
    : [];
  return { notes, cards, revlog, collectionCreated: crt };
}

/** Şema 11: not tipleri ve desteler col tablosundaki JSON'da */
function readSchema11(db: Database): Pick<AnkiPackage, "noteTypes" | "decks"> {
  const col = rows<{ models: string; decks: string }>(db, "select models, decks from col")[0];
  const models = JSON.parse(col?.models || "{}") as Record<string, Record<string, unknown>>;
  const decks = JSON.parse(col?.decks || "{}") as Record<string, Record<string, unknown>>;
  return {
    noteTypes: Object.values(models).map((m) => ({
      ankiId: Number(m.id),
      name: String(m.name),
      kind: Number(m.type) === 1 ? "cloze" : "standard",
      fields: ((m.flds as Record<string, unknown>[]) ?? []).map((f, i) => ({
        name: String(f.name),
        ord: Number(f.ord ?? i),
        sticky: Boolean(f.sticky),
      })),
      templates: ((m.tmpls as Record<string, unknown>[]) ?? []).map((t, i) => ({
        name: String(t.name),
        ord: Number(t.ord ?? i),
        front: String(t.qfmt ?? ""),
        back: String(t.afmt ?? ""),
      })),
      css: String(m.css ?? ""),
      sortFieldIdx: Number(m.sortf ?? 0),
    })),
    decks: Object.values(decks).map((d) => ({
      ankiId: Number(d.id),
      name: String(d.name),
      filtered: Number(d.dyn) === 1,
    })),
  };
}

/** Şema 18: ayrı tablolar + protobuf ayarlar */
function readSchema18(db: Database): Pick<AnkiPackage, "noteTypes" | "decks"> {
  const fields = rows<{ ntid: number; ord: number; name: string; config: Uint8Array }>(
    db,
    "select ntid, ord, name, config from fields order by ntid, ord",
  );
  const templates = rows<{ ntid: number; ord: number; name: string; config: Uint8Array }>(
    db,
    "select ntid, ord, name, config from templates order by ntid, ord",
  );
  const noteTypes = rows<{ id: number; name: string; config: Uint8Array }>(db, "select id, name, config from notetypes").map((nt) => {
    const cfg = decodeProto(nt.config);
    const id = Number(nt.id);
    return {
      ankiId: id,
      name: String(nt.name),
      kind: proto.num(cfg, 1) === 1 ? ("cloze" as const) : ("standard" as const),
      sortFieldIdx: proto.num(cfg, 2),
      css: proto.str(cfg, 3),
      fields: fields
        .filter((f) => Number(f.ntid) === id)
        .map((f) => ({ name: String(f.name), ord: Number(f.ord), sticky: proto.bool(decodeProto(f.config), 1) })),
      templates: templates
        .filter((t) => Number(t.ntid) === id)
        .map((t) => {
          const tc = decodeProto(t.config);
          return { name: String(t.name), ord: Number(t.ord), front: proto.str(tc, 1), back: proto.str(tc, 2) };
        }),
    };
  });
  const decks = rows<{ id: number; name: string; kind: Uint8Array }>(db, "select id, name, kind from decks").map((d) => ({
    ankiId: Number(d.id),
    name: String(d.name).split("\x1f").join("::"),
    filtered: decodeProto(d.kind).has(2),
  }));
  return { noteTypes, decks };
}

function readMediaMap(bytes: Uint8Array | undefined): AnkiMediaFile[] {
  if (!bytes || !bytes.length) return [];
  const data = maybeZstd(bytes);
  // Eski format: JSON {"0": "kedi.png"}
  if (data[0] === 0x7b) {
    const map = JSON.parse(new TextDecoder().decode(data)) as Record<string, string>;
    return Object.entries(map).map(([entry, name]) => ({ entry, name }));
  }
  // Yeni format: MediaEntries { repeated MediaEntry entries = 1 } (name = 1, legacy_zip_filename = 255)
  return proto.messages(decodeProto(data), 1).map((m, i) => ({
    name: proto.str(m, 1),
    entry: m.has(255) ? String(proto.num(m, 255)) : String(i),
  }));
}

/** Paketi açar ve ara yapıya çevirir. Medya içerikleri ayrıca okunur (readMedia). */
export function parseAnkiPackage(SQL: SqlJsStatic, file: Uint8Array): AnkiPackage {
  const entries = new Set(listZipEntries(file));
  const collectionName = ["collection.anki21b", "collection.anki21", "collection.anki2"].find((n) => entries.has(n));
  if (!collectionName) throw new Error("Bu dosya bir deste paketi değil ya da bozuk.");

  const files = readZipEntries(file, new Set([collectionName, "media"]));
  const sqlite = maybeZstd(files[collectionName]);
  const db = new SQL.Database(sqlite);
  try {
    const schema18 = hasTable(db, "notetypes");
    const structure = schema18 ? readSchema18(db) : readSchema11(db);
    return {
      format: collectionName.slice("collection.".length) as AnkiPackage["format"],
      ...readCommon(db),
      ...structure,
      media: readMediaMap(files.media),
    };
  } finally {
    db.close();
  }
}

/** Medya dosyalarını parça parça okur (zstd ise açar) */
export function readMedia(file: Uint8Array, media: AnkiMediaFile[]): Map<string, Uint8Array> {
  const byEntry = new Map(media.map((m) => [m.entry, m.name]));
  const raw = readZipEntries(file, new Set(byEntry.keys()));
  const out = new Map<string, Uint8Array>();
  for (const [entry, bytes] of Object.entries(raw)) out.set(byEntry.get(entry)!, maybeZstd(bytes));
  return out;
}
