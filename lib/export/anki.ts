// ANKI'YE DIŞA AKTARMA (.apkg / .colpkg) — şema 11 (collection.anki2).
// Bu eski ama hâlâ desteklenen biçimi tüm Anki sürümleri (masaüstü, AnkiDroid,
// AnkiMobile) içe aktarabilir.
//
//  - Çalışma geçmişi dahil/hariç (hariçse tüm kartlar yeni olur)
//  - Resimler dahil (kk-media/<hash>.png → Anki'de "<hash>.png")
//  - Örnek cümleler: istenirse seçilen bir alana (yoksa yeni alan olarak) liste
//    hâlinde eklenir; şablonlardaki {{Example}}/{{Examples}} o alana çevrilir
//  - Resim maskeleme notları Anki'nin kendi resim maskeleme tipiyle yazılır
import { zipSync } from "fflate";
import type { SqlJsStatic } from "sql.js";
import type { CardRow, DeckRow, NoteExampleRow, NoteRow, NoteTypeRow, ReviewLogRow } from "@/lib/db/types";
import { buildDeckTree, flattenDeckTree } from "@/lib/decks";
import { escapeHtml, stripHtml } from "@/lib/text";

const DAY = 86_400_000;

export interface AnkiExportInput {
  noteTypes: NoteTypeRow[];
  notes: NoteRow[];
  cards: CardRow[];
  decks: DeckRow[];
  examples: NoteExampleRow[];
  logs: ReviewLogRow[];
  includeScheduling: boolean;
  /** Örnek cümlelerin yazılacağı alan adı (yoksa not tipine eklenir); null = örnekler dahil edilmez */
  examplesField: string | null;
  getMedia: (fileName: string) => Promise<Uint8Array | null>;
  now: number;
  /** Koleksiyonun "gün 0" başlangıcı (ms) — tekrar tarihleri bundan gün olarak sayılır */
  dayZero: number;
}

export interface AnkiExportResult {
  bytes: Uint8Array;
  notes: number;
  cards: number;
  media: number;
  missingMedia: number;
}

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null,
  ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null,
  models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null,
  usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null,
  flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null,
  mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null,
  ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null,
  odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null,
  ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

// Anki'nin kendi resim maskeleme şablonları (Anki 23.10+ bunları tanır)
const ANKI_IO_FRONT = `{{#Header}}<div>{{Header}}</div>{{/Header}}
<div style="display: none">{{cloze:Occlusion}}</div>
<div id="err"></div>
<div id="image-occlusion-container">
    {{Image}}
    <canvas id="image-occlusion-canvas"></canvas>
</div>
<script>
try {
    anki.imageOcclusion.setup();
} catch (exc) {
    document.getElementById("err").innerHTML = \`Error loading image occlusion. Is your Anki version up to date?<br><br>\${exc}\`;
}
</script>`;
const ANKI_IO_BACK = `${ANKI_IO_FRONT}
<div><button id="toggle">Toggle Masks</button></div>
{{#Back Extra}}<div>{{Back Extra}}</div>{{/Back Extra}}`;

/** Benzersiz, artan tamsayı kimlik üretici (Anki kimlikleri ms zaman damgasıdır) */
function idMaker() {
  const used = new Set<number>();
  return (seed: number) => {
    let id = Math.max(1_000_000_000_000, Math.floor(seed));
    while (used.has(id)) id++;
    used.add(id);
    return id;
  };
}

async function sha1Checksum(text: string): Promise<number> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(digest).slice(0, 4), (b) => b.toString(16).padStart(2, "0")).join("");
  return parseInt(hex, 16);
}

const MEDIA_RE = /kk-media\/([a-f0-9]{64}\.[a-z0-9]+)/gi;

/** Şablondaki {{Example}}/{{Examples}} etiketlerini alana çevirir ya da kaldırır */
function adaptTemplate(t: string, field: string | null): string {
  if (!field) {
    return t
      .replace(/\{\{#Examples?\}\}[\s\S]*?\{\{\/Examples?\}\}/g, "")
      .replace(/\{\{\^Examples?\}\}([\s\S]*?)\{\{\/Examples?\}\}/g, "$1")
      .replace(/\{\{Examples?\}\}/g, "");
  }
  return t
    .replace(/\{\{([#^/])Examples?\}\}/g, `{{$1${field}}}`)
    .replace(/\{\{Examples?\}\}/g, `{{${field}}}`);
}

function examplesHtml(list: NoteExampleRow[]): string {
  if (!list.length) return "";
  const items = list.map((e) => `<li>${escapeHtml(e.text)}${e.translation ? `<br><i>${escapeHtml(e.translation)}</i>` : ""}</li>`);
  return `<ul>${items.join("")}</ul>`;
}

export async function exportAnki(SQL: SqlJsStatic, input: AnkiExportInput): Promise<AnkiExportResult> {
  const nowSec = Math.floor(input.now / 1000);
  const crt = Math.floor(input.dayZero / 1000);
  const newId = idMaker();
  const notes = input.notes.filter((n) => n.deleted_at === null);
  const noteIds = new Set(notes.map((n) => n.id));
  const cards = input.cards.filter((c) => c.deleted_at === null && noteIds.has(c.note_id));
  const usedTypes = new Set(notes.map((n) => n.note_type_id));
  const types = input.noteTypes.filter((t) => usedTypes.has(t.id));
  const exampleMap = new Map<string, NoteExampleRow[]>();
  for (const e of input.examples) {
    if (e.deleted_at !== null || !e.approved || !noteIds.has(e.note_id)) continue;
    exampleMap.set(e.note_id, [...(exampleMap.get(e.note_id) ?? []), e]);
  }
  for (const list of exampleMap.values()) list.sort((a, b) => a.position - b.position);

  // --- not tipleri (modeller)
  const deckTree = flattenDeckTree(buildDeckTree(input.decks.filter((d) => d.deleted_at === null)), true);
  const models: Record<string, unknown> = {};
  const modelInfo = new Map<string, { mid: number; fieldNames: string[]; examplesOrd: number | null; type: NoteTypeRow }>();
  for (const t of types) {
    const mid = newId(t.created_at);
    const isIo = t.kind === "image_occlusion";
    const fieldNames = t.fields.map((f) => f.name);
    let examplesOrd: number | null = null;
    if (input.examplesField && !isIo) {
      const i = fieldNames.findIndex((n) => n.toLowerCase() === input.examplesField!.toLowerCase());
      if (i >= 0) examplesOrd = i;
      else {
        fieldNames.push(input.examplesField);
        examplesOrd = fieldNames.length - 1;
      }
    }
    const exField = examplesOrd !== null ? fieldNames[examplesOrd] : null;
    const tmpls = isIo
      ? [{ name: t.templates[0]?.name ?? "Image Occlusion", ord: 0, qfmt: ANKI_IO_FRONT, afmt: ANKI_IO_BACK }]
      : t.templates.map((tp, i) => ({ name: tp.name, ord: i, qfmt: adaptTemplate(tp.front, exField), afmt: adaptTemplate(tp.back, exField) }));
    const sortIdx = Math.max(0, t.fields.findIndex((f) => f.id === t.sort_field));
    models[String(mid)] = {
      id: mid,
      name: t.name,
      type: t.kind === "standard" ? 0 : 1,
      ...(isIo ? { originalStockKind: 6 } : {}),
      mod: nowSec,
      usn: -1,
      sortf: sortIdx,
      did: null,
      tmpls: tmpls.map((x) => ({ ...x, did: null, bqfmt: "", bafmt: "", bfont: "", bsize: 0 })),
      flds: fieldNames.map((name, ord) => ({
        name,
        ord,
        sticky: !!t.fields[ord]?.sticky,
        rtl: false,
        font: "Arial",
        size: 20,
        media: [],
        description: "",
        plainText: false,
        collapsed: false,
        excludeFromSearch: false,
      })),
      css: t.css,
      latexPre: "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
      latexPost: "\\end{document}",
      latexsvg: false,
      req: tmpls.map((_, i) => [i, "any", [0]]),
      tags: [],
      vers: [],
    };
    modelInfo.set(t.id, { mid, fieldNames, examplesOrd, type: t });
  }

  // --- desteler (filtreli destedeki kart asıl destesine yazılır)
  const homeDeck = (c: CardRow) => c.original_deck_id ?? c.deck_id;
  const usedDecks = new Set(cards.map(homeDeck));
  const deckIdMap = new Map<string, number>();
  const decksJson: Record<string, unknown> = {};
  const deckEntry = (id: number, name: string, collapsed = false) => ({
    id,
    name,
    mod: nowSec,
    usn: -1,
    lrnToday: [0, 0],
    revToday: [0, 0],
    newToday: [0, 0],
    timeToday: [0, 0],
    collapsed,
    browserCollapsed: collapsed,
    desc: "",
    dyn: 0,
    conf: 1,
    extendNew: 0,
    extendRev: 0,
  });
  decksJson["1"] = deckEntry(1, "Default");
  for (const node of deckTree) {
    if (node.deck.is_filtered) continue;
    // Kullanılan desteler ve onların üst desteleri
    const subtreeUsed = (n: typeof node): boolean => usedDecks.has(n.deck.id) || n.children.some(subtreeUsed);
    if (!subtreeUsed(node)) continue;
    const id = newId(node.deck.created_at);
    deckIdMap.set(node.deck.id, id);
    decksJson[String(id)] = deckEntry(id, node.fullName, node.deck.collapsed);
  }

  // --- medya
  const mediaNames = new Map<string, number>();
  const mediaOf = (html: string) => {
    for (const m of html.matchAll(MEDIA_RE)) if (!mediaNames.has(m[1])) mediaNames.set(m[1], mediaNames.size);
    return html.replace(MEDIA_RE, "$1");
  };

  // --- veritabanı
  const db = new SQL.Database();
  db.exec(SCHEMA);
  const dconf = {
    "1": {
      id: 1,
      name: "Default",
      mod: 0,
      usn: 0,
      maxTaken: 60,
      autoplay: true,
      timer: 0,
      replayq: true,
      dyn: false,
      new: { delays: [1, 10], ints: [1, 4, 0], initialFactor: 2500, order: 1, perDay: 20, bury: false },
      rev: { perDay: 200, ease4: 1.3, ivlFct: 1, maxIvl: 36500, hardFactor: 1.2, bury: false },
      lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 1 },
    },
  };
  const conf = { activeDecks: [1], curDeck: 1, newSpread: 0, collapseTime: 1200, timeLim: 0, estTimes: true, dueCounts: true, curModel: null, nextPos: 1, sortType: "noteFld", sortBackwards: false, addToCur: true, schedVer: 2 };
  db.run("insert into col values (1,?,?,?,11,0,0,0,?,?,?,?,?)", [
    crt,
    input.now,
    input.now,
    JSON.stringify(conf),
    JSON.stringify(models),
    JSON.stringify(decksJson),
    JSON.stringify(dconf),
    "{}",
  ]);

  const noteAnkiId = new Map<string, number>();
  const insertNote = db.prepare("insert into notes values (?,?,?,?,0,?,?,?,?,0,'')");
  for (const n of notes) {
    const info = modelInfo.get(n.note_type_id)!;
    const values = info.type.fields.map((f) => mediaOf(n.fields[f.id] ?? ""));
    while (values.length < info.fieldNames.length) values.push("");
    if (info.examplesOrd !== null) {
      const ex = examplesHtml(exampleMap.get(n.id) ?? []);
      if (ex) values[info.examplesOrd] = values[info.examplesOrd] ? `${values[info.examplesOrd]}<br>${ex}` : ex;
    }
    const sortIdx = Math.max(0, info.type.fields.findIndex((f) => f.id === info.type.sort_field));
    const id = newId(n.created_at);
    noteAnkiId.set(n.id, id);
    const tags = n.tags.length ? ` ${n.tags.join(" ")} ` : "";
    insertNote.run([id, n.guid, info.mid, nowSec, tags, values.join("\x1f"), stripHtml(values[sortIdx] ?? ""), await sha1Checksum(stripHtml(values[0] ?? ""))]);
  }
  insertNote.free();

  // --- kartlar
  const newRank = new Map(
    cards
      .filter((c) => !input.includeScheduling || c.state === 0)
      .sort((a, b) => a.position - b.position || a.created_at - b.created_at)
      .map((c, i) => [c.id, i + 1]),
  );
  const cardAnkiId = new Map<string, number>();
  const insertCard = db.prepare("insert into cards values (?,?,?,?,?,0,?,?,?,?,?,?,?,?,0,0,?,?)");
  for (const c of cards) {
    const id = newId(c.created_at);
    cardAnkiId.set(c.id, id);
    const did = deckIdMap.get(homeDeck(c)) ?? 1;
    let type = 0;
    let queue = 0;
    let due = newRank.get(c.id) ?? 0;
    let ivl = 0;
    let factor = 0;
    let reps = 0;
    let lapses = 0;
    let left = 0;
    let data = "";
    if (input.includeScheduling && c.state !== 0) {
      reps = c.reps;
      lapses = c.lapses;
      factor = c.ease > 0 ? c.ease : 2500;
      ivl = Math.max(0, Math.round(c.interval_days));
      const dayNum = Math.max(0, Math.floor((c.due - input.dayZero) / DAY));
      if (c.state === 2) {
        type = 2;
        queue = 2;
        due = dayNum;
        ivl = Math.max(1, ivl);
      } else {
        type = c.state === 3 ? 3 : 1;
        if (c.scheduled_days >= 1) {
          queue = 3;
          due = dayNum;
        } else {
          queue = 1;
          due = Math.floor(c.due / 1000);
        }
        left = 1001;
      }
      if (c.stability > 0 && c.difficulty > 0) data = JSON.stringify({ s: Math.round(c.stability * 10000) / 10000, d: Math.round(c.difficulty * 1000) / 1000 });
    }
    if (c.suspended) queue = -1;
    else if (c.buried_until && c.buried_until > input.now) queue = -3;
    insertCard.run([id, noteAnkiId.get(c.note_id)!, did, c.ord, nowSec, type, queue, due, ivl, factor, reps, lapses, left, c.flags & 7, data]);
  }
  insertCard.free();

  // --- cevap geçmişi
  if (input.includeScheduling) {
    const insertLog = db.prepare("insert into revlog values (?,?,0,?,?,?,?,?,?)");
    const used = new Set<number>();
    for (const l of input.logs) {
      const cid = cardAnkiId.get(l.card_id);
      if (!cid || l.deleted_at !== null) continue;
      let id = l.reviewed_at;
      while (used.has(id)) id++;
      used.add(id);
      const after = l.interval_after ?? 0;
      const before = l.interval_before ?? 0;
      insertLog.run([
        id,
        cid,
        l.kind === 4 ? 0 : l.rating,
        after >= 1 ? Math.round(after) : -600,
        before >= 1 ? Math.round(before) : -600,
        l.ease ?? 2500,
        Math.min(60_000, Math.max(0, l.duration_ms)),
        Math.min(4, Math.max(0, l.kind)),
      ]);
    }
    insertLog.free();
  }

  const collection = db.export();
  db.close();

  // --- zip
  const files: Record<string, Uint8Array> = { "collection.anki2": collection };
  const mediaMap: Record<string, string> = {};
  let missing = 0;
  for (const [name, index] of mediaNames) {
    const data = await input.getMedia(name);
    if (!data) {
      missing++;
      continue;
    }
    files[String(index)] = data;
    mediaMap[String(index)] = name;
  }
  files.media = new TextEncoder().encode(JSON.stringify(mediaMap));
  return { bytes: zipSync(files, { level: 6 }), notes: notes.length, cards: cards.length, media: Object.keys(mediaMap).length, missingMedia: missing };
}
