// Hazır not tipleri (Anki'deki standart tiplerin aynısı) + yeni kullanıcı
// için varsayılan deste ve deste ayarı.
//
// Kimlikler kullanıcıya göre SABİT üretilir (uuidv5). Böylece iki cihaz bunları
// aynı anda oluştursa bile eşlemede tek kayıt olur, kopya oluşmaz.
import type { LocalDB } from "@/lib/db/database";
import { deterministicId, insertRows } from "@/lib/db/mutations";
import type { NoteTypeRow } from "@/lib/db/types";
import { DEFAULT_DECK_OPTIONS } from "@/lib/scheduler/config";

export const DEFAULT_CARD_CSS = `.card {
  font-family: arial;
  font-size: 20px;
  line-height: 1.5;
  text-align: center;
  color: black;
  background-color: white;
}

.nightMode.card {
  color: #ddd7cc;
  background-color: #252421;
}
`;

const CLOZE_CSS = `${DEFAULT_CARD_CSS}
.cloze {
  font-weight: bold;
  color: blue;
}

.nightMode .cloze {
  color: lightblue;
}
`;

// Resim maskeleme şablonları (maskeler {{image-occlusion:Occlusion}} ile çizilir)
export const IO_FRONT = `{{#Header}}<div class="kk-io-header">{{Header}}</div>{{/Header}}\n<div class="kk-io">{{Image}}{{image-occlusion:Occlusion}}</div>`;
export const IO_BACK = `{{#Header}}<div class="kk-io-header">{{Header}}</div>{{/Header}}\n<div class="kk-io">{{Image}}{{image-occlusion:Occlusion}}</div>\n{{#Back Extra}}<div>{{Back Extra}}</div>{{/Back Extra}}\n{{#Comments}}<div>{{Comments}}</div>{{/Comments}}`;

// Arka yüzde (varsa) örnek cümle: {{Example}} onaylı cümlelerden birini seçer
const EXAMPLE_BLOCK = "{{#Example}}\n<div class=\"kk-example-box\">{{Example}}</div>\n{{/Example}}";
const BACK = (field: string) => `{{FrontSide}}\n\n<hr id=answer>\n\n{{${field}}}`;

type BuiltinKey = "basic" | "basic-reversed" | "basic-optional-reversed" | "basic-typing" | "cloze" | "image-occlusion";

interface BuiltinDef {
  key: BuiltinKey;
  name: string;
  kind: NoteTypeRow["kind"];
  fields: { id: string; name: string }[];
  templates: { id: string; name: string; front: string; back: string }[];
  css: string;
  sortField: string;
  wordField: string | null;
}

export const BUILTIN_NOTE_TYPES: BuiltinDef[] = [
  {
    key: "basic",
    name: "Basic",
    kind: "standard",
    fields: [
      { id: "front", name: "Front" },
      { id: "back", name: "Back" },
    ],
    templates: [{ id: "card1", name: "Card 1", front: "{{Front}}", back: `${BACK("Back")}\n\n${EXAMPLE_BLOCK}` }],
    css: DEFAULT_CARD_CSS,
    sortField: "front",
    wordField: "front",
  },
  {
    key: "basic-reversed",
    name: "Basic (and reversed card)",
    kind: "standard",
    fields: [
      { id: "front", name: "Front" },
      { id: "back", name: "Back" },
    ],
    templates: [
      { id: "card1", name: "Card 1", front: "{{Front}}", back: `${BACK("Back")}\n\n${EXAMPLE_BLOCK}` },
      { id: "card2", name: "Card 2", front: "{{Back}}", back: `${BACK("Front")}\n\n${EXAMPLE_BLOCK}` },
    ],
    css: DEFAULT_CARD_CSS,
    sortField: "front",
    wordField: "front",
  },
  {
    key: "basic-optional-reversed",
    name: "Basic (optional reversed card)",
    kind: "standard",
    fields: [
      { id: "front", name: "Front" },
      { id: "back", name: "Back" },
      { id: "add-reverse", name: "Add Reverse" },
    ],
    templates: [
      { id: "card1", name: "Card 1", front: "{{Front}}", back: `${BACK("Back")}\n\n${EXAMPLE_BLOCK}` },
      {
        id: "card2",
        name: "Card 2",
        front: "{{#Add Reverse}}{{Back}}{{/Add Reverse}}",
        back: `${BACK("Front")}\n\n${EXAMPLE_BLOCK}`,
      },
    ],
    css: DEFAULT_CARD_CSS,
    sortField: "front",
    wordField: "front",
  },
  {
    key: "basic-typing",
    name: "Basic (type in the answer)",
    kind: "standard",
    fields: [
      { id: "front", name: "Front" },
      { id: "back", name: "Back" },
    ],
    templates: [
      {
        id: "card1",
        name: "Card 1",
        front: "{{Front}}\n\n{{type:Back}}",
        back: `{{Front}}\n\n<hr id=answer>\n\n{{type:Back}}\n\n${EXAMPLE_BLOCK}`,
      },
    ],
    css: DEFAULT_CARD_CSS,
    sortField: "front",
    wordField: "front",
  },
  {
    key: "cloze",
    name: "Cloze",
    kind: "cloze",
    fields: [
      { id: "text", name: "Text" },
      { id: "back-extra", name: "Back Extra" },
    ],
    templates: [{ id: "cloze", name: "Cloze", front: "{{cloze:Text}}", back: "{{cloze:Text}}<br>\n{{Back Extra}}" }],
    css: CLOZE_CSS,
    sortField: "text",
    wordField: null,
  },
  {
    key: "image-occlusion",
    name: "Image Occlusion",
    kind: "image_occlusion",
    fields: [
      { id: "occlusion", name: "Occlusion" },
      { id: "image", name: "Image" },
      { id: "header", name: "Header" },
      { id: "back-extra", name: "Back Extra" },
      { id: "comments", name: "Comments" },
    ],
    templates: [{ id: "io", name: "Image Occlusion", front: IO_FRONT, back: IO_BACK }],
    css: DEFAULT_CARD_CSS,
    sortField: "header",
    wordField: null,
  },
];

export function builtinNoteTypeId(key: BuiltinKey, userId: string) {
  return deterministicId(`builtin-notetype:${key}`, userId);
}
export function defaultDeckId(userId: string) {
  return deterministicId("default-deck", userId);
}
export function defaultDeckConfigId(userId: string) {
  return deterministicId("default-deck-config", userId);
}

/**
 * Yeni kullanıcı için hazır kayıtları oluşturur (yoksa).
 * İlk eşleme bittikten SONRA çağrılır; silinmiş (tombstone) olanlar tekrar
 * oluşturulmaz (kullanıcı bilerek silmiş olabilir).
 */
export async function ensureDefaults(db: LocalDB): Promise<void> {
  const uid = db.userId;
  const configId = defaultDeckConfigId(uid);
  if (!(await db.deck_configs.get(configId))) {
    await insertRows(db, "deck_configs", [{ id: configId, name: "Varsayılan", config: { ...DEFAULT_DECK_OPTIONS } }]);
  }
  const deckId = defaultDeckId(uid);
  if (!(await db.decks.get(deckId))) {
    await insertRows(db, "decks", [{ id: deckId, name: "Varsayılan", parent_id: null, config_id: null }]);
  }
  const missing = [];
  for (const def of BUILTIN_NOTE_TYPES) {
    const id = builtinNoteTypeId(def.key, uid);
    if (await db.note_types.get(id)) continue;
    missing.push({
      id,
      name: def.name,
      kind: def.kind,
      fields: def.fields.map((f) => ({ ...f, sticky: false })),
      templates: def.templates,
      css: def.css,
      sort_field: def.sortField,
      word_field: def.wordField,
    });
  }
  if (missing.length) await insertRows(db, "note_types", missing);
}
