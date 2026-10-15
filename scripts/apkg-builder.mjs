// Test ve deneme için ÖRNEK ANKİ PAKETLERİ üretir (gerçek Anki biçiminde).
//   format "legacy": collection.anki2 (şema 11) + JSON medya listesi
//   format "latest": sahte collection.anki2 ("lütfen güncelleyin") + zstd'li
//                    collection.anki21b (şema 18, protobuf ayarlar) + protobuf
//                    medya listesi + zstd'li medya dosyaları
// Hem testler (tests/import.test.ts) hem de scripts/make-fixtures.mjs kullanır.
import zlib from "node:zlib";
import { zipSync } from "fflate";
import initSqlJs from "sql.js";

// ------------------------------------------------------------ protobuf yazıcı
function varint(value) {
  let n = BigInt(value);
  const out = [];
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) b |= 0x80;
    out.push(b);
  } while (n > 0n);
  return out;
}
const enc = new TextEncoder();
const pb = {
  varint: (field, v) => [...varint((field << 3) | 0), ...varint(v)],
  bytes: (field, bytes) => [...varint((field << 3) | 2), ...varint(bytes.length), ...bytes],
  str: (field, s) => pb.bytes(field, [...enc.encode(s)]),
  msg: (...parts) => Uint8Array.from(parts.flat()),
};

// ------------------------------------------------------------ örnek içerik
const CRT = Date.UTC(2026, 0, 1, 1, 0) / 1000; // koleksiyon oluşturma (saniye)
const NOW_S = Date.UTC(2026, 9, 13, 9, 0) / 1000;
// 1x1 PNG
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

export const SAMPLE = {
  noteTypes: [
    {
      id: 1700000000001,
      name: "YDS Kelime",
      kind: 0,
      sortf: 0,
      css: ".card { font-family: arial; font-size: 22px; text-align: center; }",
      fields: ["Word", "Meaning", "Example", "Picture"],
      templates: [
        {
          name: "Kart 1",
          qfmt: "{{Word}}",
          afmt: "{{FrontSide}}<hr id=answer>{{Meaning}}<div class=ex>{{Example}}</div>{{Picture}}",
        },
      ],
    },
    {
      id: 1700000000002,
      name: "Cloze",
      kind: 1,
      sortf: 0,
      css: ".card { font-family: arial; } .cloze { font-weight: bold; color: blue; }",
      fields: ["Text", "Back Extra"],
      templates: [{ name: "Cloze", qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}<br>{{Back Extra}}" }],
    },
  ],
  decks: [
    { id: 1, name: ["Default"] },
    { id: 1700000000100, name: ["YDS", "Fiiller"] },
    { id: 1700000000200, name: ["YDS", "İsimler"] },
  ],
  notes: [
    {
      id: 1700000001001,
      guid: "guid-abandon",
      mid: 1700000000001,
      tags: " yds fiil ",
      flds: ["abandon [sound:abandon.mp3]", "terk etmek", "They abandoned the car.<br>Never abandon hope.", '<img src="kedi.png">'],
    },
    {
      id: 1700000001002,
      guid: "guid-acquire",
      mid: 1700000000001,
      tags: " yds ",
      flds: ["acquire", "edinmek", "1. She acquired a new skill. 2. The company was acquired.", ""],
    },
    {
      id: 1700000001003,
      guid: "guid-benefit",
      mid: 1700000000001,
      tags: "",
      flds: ["benefit", "fayda", "<ul><li>It will benefit everyone.</li><li>A tax benefit.</li></ul>", ""],
    },
    {
      id: 1700000001004,
      guid: "guid-cloze",
      mid: 1700000000002,
      tags: " yds cloze ",
      flds: ["I {{c1::gave up}} smoking {{c2::last year}}.", "vazgeçmek"],
    },
  ],
  // [id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, data]
  cards: [
    [1700000002001, 1700000001001, 1700000000100, 0, 2, 2, 280, 15, 2500, 5, 1, '{"s":15.5,"d":5.2}'],
    [1700000002002, 1700000001002, 1700000000100, 0, 1, 1, NOW_S + 600, 0, 2500, 1, 0, ""],
    [1700000002003, 1700000001003, 1700000000200, 0, 0, 0, 3, 0, 0, 0, 0, ""],
    [1700000002004, 1700000001004, 1700000000100, 0, 0, 0, 4, 0, 0, 0, 0, ""],
    [1700000002005, 1700000001004, 1700000000100, 1, 2, -1, 270, 3, 2300, 2, 0, ""],
  ],
  // [id(ms), cid, ease, ivl, lastIvl, factor, time, type]
  revlog: [
    [Date.UTC(2026, 8, 1) , 1700000002001, 3, -600, 0, 0, 5000, 0],
    [Date.UTC(2026, 8, 2), 1700000002001, 3, 4, -600, 2500, 4000, 0],
    [Date.UTC(2026, 8, 6), 1700000002001, 3, 15, 4, 2500, 3000, 1],
    [Date.UTC(2026, 9, 13, 8, 50), 1700000002002, 3, -600, 0, 0, 6000, 0],
  ],
  media: [
    { name: "kedi.png", data: PNG },
    { name: "abandon.mp3", data: enc.encode("sahte-ses") },
  ],
};

const SCHEMA_COMMON = `
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
`;

const SCHEMA_18 = `
CREATE TABLE notetypes (id integer NOT NULL PRIMARY KEY, name text NOT NULL, mtime_secs integer NOT NULL,
  usn integer NOT NULL, config blob NOT NULL);
CREATE TABLE fields (ntid integer NOT NULL, ord integer NOT NULL, name text NOT NULL, config blob NOT NULL,
  PRIMARY KEY (ntid, ord)) without rowid;
CREATE TABLE templates (ntid integer NOT NULL, ord integer NOT NULL, name text NOT NULL, mtime_secs integer NOT NULL,
  usn integer NOT NULL, config blob NOT NULL, PRIMARY KEY (ntid, ord)) without rowid;
CREATE TABLE decks (id integer PRIMARY KEY NOT NULL, name text NOT NULL, mtime_secs integer NOT NULL,
  usn integer NOT NULL, common blob NOT NULL, kind blob NOT NULL);
CREATE TABLE deck_config (id integer PRIMARY KEY NOT NULL, name text NOT NULL, mtime_secs integer NOT NULL,
  usn integer NOT NULL, config blob NOT NULL);
CREATE TABLE config (KEY text NOT NULL PRIMARY KEY, usn integer NOT NULL, mtime_secs integer NOT NULL,
  val blob NOT NULL) without rowid;
CREATE TABLE tags (tag text NOT NULL PRIMARY KEY, usn integer NOT NULL, collapsed boolean NOT NULL,
  config blob NULL) without rowid;
`;

function insertCommon(db, data, { modelsJson, decksJson }) {
  db.run("insert into col values (1, ?, 0, 0, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')", [CRT, modelsJson, decksJson]);
  for (const n of data.notes) {
    db.run("insert into notes values (?, ?, ?, 0, -1, ?, ?, ?, 0, 0, '')", [n.id, n.guid, n.mid, n.tags, n.flds.join("\x1f"), n.flds[0]]);
  }
  for (const c of data.cards) {
    const [id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, cdata] = c;
    db.run("insert into cards values (?, ?, ?, ?, 0, -1, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?)", [
      id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, cdata,
    ]);
  }
  for (const r of data.revlog) db.run("insert into revlog values (?, ?, -1, ?, ?, ?, ?, ?, ?)", r);
}

function legacyCollection(SQL, data) {
  const db = new SQL.Database();
  db.exec(SCHEMA_COMMON);
  const models = Object.fromEntries(
    data.noteTypes.map((m) => [
      String(m.id),
      {
        id: m.id,
        name: m.name,
        type: m.kind,
        sortf: m.sortf,
        css: m.css,
        flds: m.fields.map((name, ord) => ({ name, ord, sticky: false, rtl: false, font: "Arial", size: 20 })),
        tmpls: m.templates.map((t, ord) => ({ name: t.name, ord, qfmt: t.qfmt, afmt: t.afmt })),
      },
    ]),
  );
  const decks = Object.fromEntries(data.decks.map((d) => [String(d.id), { id: d.id, name: d.name.join("::"), dyn: 0 }]));
  insertCommon(db, data, { modelsJson: JSON.stringify(models), decksJson: JSON.stringify(decks) });
  const bytes = db.export();
  db.close();
  return bytes;
}

function latestCollection(SQL, data) {
  const db = new SQL.Database();
  db.exec(SCHEMA_COMMON + SCHEMA_18);
  insertCommon(db, data, { modelsJson: "", decksJson: "" });
  for (const m of data.noteTypes) {
    db.run("insert into notetypes values (?, ?, 0, 0, ?)", [
      m.id,
      m.name,
      pb.msg(pb.varint(1, m.kind), pb.varint(2, m.sortf), pb.str(3, m.css)),
    ]);
    m.fields.forEach((name, ord) => db.run("insert into fields values (?, ?, ?, ?)", [m.id, ord, name, pb.msg(pb.varint(1, 0))]));
    m.templates.forEach((t, ord) =>
      db.run("insert into templates values (?, ?, ?, 0, 0, ?)", [m.id, ord, t.name, pb.msg(pb.str(1, t.qfmt), pb.str(2, t.afmt))]),
    );
  }
  for (const d of data.decks) {
    db.run("insert into decks values (?, ?, 0, 0, ?, ?)", [d.id, d.name.join("\x1f"), new Uint8Array(), pb.msg(pb.bytes(1, []))]);
  }
  const bytes = db.export();
  db.close();
  return bytes;
}

/** Yeni Anki'nin eski sürümler için koyduğu sahte koleksiyon */
function dummyCollection(SQL) {
  const db = new SQL.Database();
  db.exec(SCHEMA_COMMON);
  const models = { 1: { id: 1, name: "Basic", type: 0, sortf: 0, css: "", flds: [{ name: "Front", ord: 0 }], tmpls: [{ name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{Front}}" }] } };
  db.run("insert into col values (1, ?, 0, 0, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')", [CRT, JSON.stringify(models), JSON.stringify({ 1: { id: 1, name: "Default", dyn: 0 } })]);
  db.run("insert into notes values (1, 'dummy', 1, 0, -1, '', 'Please update to the latest Anki version, then import the .colpkg/.apkg file again.', '', 0, 0, '')");
  db.run("insert into cards values (1, 1, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')");
  const bytes = db.export();
  db.close();
  return bytes;
}

const zstd = (bytes) => new Uint8Array(zlib.zstdCompressSync(Buffer.from(bytes)));

export async function buildApkg(format = "legacy", data = SAMPLE) {
  const SQL = await initSqlJs();
  const files = {};
  if (format === "legacy") {
    files["collection.anki2"] = legacyCollection(SQL, data);
    files.media = enc.encode(JSON.stringify(Object.fromEntries(data.media.map((m, i) => [String(i), m.name]))));
    data.media.forEach((m, i) => (files[String(i)] = m.data));
  } else {
    files["collection.anki2"] = dummyCollection(SQL);
    files["collection.anki21b"] = zstd(latestCollection(SQL, data));
    files.media = zstd(pb.msg(...data.media.map((m) => pb.bytes(1, [...pb.str(1, m.name), ...pb.varint(2, m.data.length)]))));
    data.media.forEach((m, i) => (files[String(i)] = zstd(m.data)));
    files.meta = pb.msg(pb.varint(1, 3));
  }
  return zipSync(files, { level: 0 });
}

export const SAMPLE_CSV = `#separator:tab
#html:false
#tags column:4
abandon\tterk etmek\tThey abandoned the car.\tyds fiil\tArabayı terk ettiler.
acquire\tedinmek\t"She acquired a new skill.
The company was acquired."\tyds\t
\tboş kelime\t\t\t
benefit\tfayda, yarar\t\t\t
`;
