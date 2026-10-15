// KARTLARI DÜZENLE: internetten indirilen kelime destelerinde (ör. YDS 1000)
// ön yüz "kelime (okunuş) tür + 1-3 örnek cümle" karışık yazılmış olabiliyor;
// Word'den kopyalanmış gizli stiller de cabası. Bu araç her notu ayırır:
//   Ön      → sadece kelime (alanın adı "Kelime" olur)
//   Okunuş  → okunuş + tür (yeni alan, ön yüzde kelimenin altında)
//   örnekler → uygulamanın örnek cümle listesine; soru tarafında {{Example}}
//              ile her tekrarda BİR cümle (sırayla farklısı) gösterilir
//   Arka    → Word çöpünden temizlenir, cevapta görünür (alanın adı "Anlam" olur)
// Not tipine yeni alan eklenir; kartların zamanlaması/geçmişi değişmez.
import type { LocalDB } from "@/lib/db/database";
import { insertRows, updateRow, updateRows } from "@/lib/db/mutations";
import type { NoteExampleRow, NoteRow, NoteTypeRow } from "@/lib/db/types";
import { sortFieldText } from "@/lib/notes";
import { newFieldId, renameFieldInTemplate } from "@/lib/notetypes/manage";
import { decodeEntities, escapeHtml } from "@/lib/text";

export const PRON_FIELD = "Okunuş";
const WORD_FIELD = "Kelime";
const MEANING_FIELD = "Anlam";
const MARK_OPEN = "\u0001";
const MARK_CLOSE = "\u0002";
const RED = String.raw`(?:red|#f00\b|#ff0000|rgb\(\s*255\s*,\s*0\s*,\s*0\s*\))`;
const POS = /^(?:\(|(?:isim|fiil|sıfat|zarf|edat|bağlaç|zamir|ünlem|deyim|phrasal verb|idiom|noun|verb|adjective|adverb|preposition|conjunction)\b)/i;

/** HTML'i (Word çöpü dahil) satırlara böler; kırmızı vurgular işaretlenir. */
function htmlLines(html: string, markRed: boolean): string[] {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<o:p>[\s\S]*?<\/o:p>/gi, "")
    .replace(/<span[^>]*display:\s*none[^>]*>[\s\S]*?<\/span>/gi, "")
    .replace(/\s*\n\s*/g, " ");
  if (markRed) {
    s = s
      .replace(new RegExp(String.raw`<span[^>]*style="[^"]*(?:^|[;"\s])color:\s*${RED}[^"]*"[^>]*>([^<]*)</span>`, "gi"), `${MARK_OPEN}$1${MARK_CLOSE}`)
      .replace(new RegExp(String.raw`<font[^>]*color="?${RED}"?[^>]*>([^<]*)</font>`, "gi"), `${MARK_OPEN}$1${MARK_CLOSE}`);
  }
  s = s.replace(/<br\s*\/?>|<\/?(?:p|div|li|ul|ol|h\d)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, "");
  return decodeEntities(s)
    .split("\n")
    .map((l) => l.replace(/[\s ]+/g, " ").trim())
    .filter((l) => l.replace(/[\u0001\u0002]/g, "").trim().length > 0);
}

const plain = (s: string) => s.replace(/[\u0001\u0002]/g, "").replace(/\s+/g, " ").trim();

export interface WordFront {
  word: string;
  pron: string;
  examples: string[];
}

/** Ön yüzü ayırır: ilk satır başlık (kırmızı kısım = kelime), sonrakiler örnek cümle. */
export function parseWordFront(html: string): WordFront {
  const lines = htmlLines(html, true);
  if (!lines.length) return { word: "", pron: "", examples: [] };
  const head = lines[0];
  let word = plain(head);
  let pron = "";
  // "1. " gibi baştaki numara atılır; kelime = kırmızı kısım, yoksa "(" öncesi
  const m = head.match(/^\s*(?:\d{1,2}[.)]\s*)?\u0001([^\u0002]*)\u0002([\s\S]*)$/);
  const p = plain(head).match(/^(?:\d{1,2}[.)]\s*)?([^()]+?)\s*(\([\s\S]*)$/);
  if (m && plain(m[1])) {
    word = plain(m[1]);
    pron = plain(m[2]);
  } else if (p) {
    word = p[1];
    pron = p[2];
  }
  let i = 1;
  // Okunuş/tür bazen ikinci satırda: "(ı-BÆN-dın) fiil"
  while (i < lines.length && pron.length < 60 && POS.test(plain(lines[i])) && !/[.!?]$/.test(plain(lines[i]))) {
    pron = plain(`${pron} ${lines[i]}`);
    i++;
  }
  const seen = new Set<string>();
  const examples: string[] = [];
  for (const l of lines.slice(i)) {
    const t = plain(l);
    if (t.length < 3 || seen.has(t)) continue;
    seen.add(t);
    examples.push(t);
  }
  return { word, pron, examples };
}

/** Arka yüzü Word çöpünden temizler (anlam satırları korunur). */
export function cleanBack(html: string): string {
  return htmlLines(html, false)
    .map((l) => `<div>${escapeHtml(plain(l))}</div>`)
    .join("");
}

export interface TidyCandidate {
  noteType: NoteTypeRow;
  frontFieldId: string;
  backFieldId: string;
  notes: NoteRow[];
  /** örnek cümlesi ön yüzde olan not sayısı */
  messy: number;
}

/** Düzenlenebilecek not tiplerini bulur: 2 alanlı tek kartlı tipler, notların
 *  en az %30'unda ön yüzde birden fazla satır var ve henüz düzenlenmemiş. */
export async function findTidyCandidates(db: LocalDB): Promise<TidyCandidate[]> {
  const types = (await db.note_types.toArray()).filter(
    (t) => t.deleted_at === null && t.kind === "standard" && t.templates.length === 1 && t.fields.length === 2 && !t.fields.some((f) => f.name === PRON_FIELD),
  );
  const out: TidyCandidate[] = [];
  for (const t of types) {
    const [front, back] = t.fields;
    const tpl = t.templates[0];
    if (!tpl.front.includes(`{{${front.name}}}`) || /\{\{#?\^?Examples?\}\}/.test(tpl.back)) continue;
    const notes = (await db.notes.where("note_type_id").equals(t.id).toArray()).filter((n) => n.deleted_at === null);
    if (notes.length < 10) continue;
    const messy = notes.filter((n) => parseWordFront(n.fields[front.id] ?? "").examples.length > 0).length;
    if (messy / notes.length >= 0.3) out.push({ noteType: t, frontFieldId: front.id, backFieldId: back.id, notes, messy });
  }
  return out;
}

/** Not tipini ve notlarını düzenler. undo.run içinde çağrılmalı (geri alınabilsin). */
export async function tidyNoteType(db: LocalDB, c: TidyCandidate): Promise<{ notes: number; examples: number }> {
  const { noteType: t, frontFieldId, backFieldId } = c;
  const pronId = newFieldId();
  const front = t.fields.find((f) => f.id === frontFieldId)!;
  const back = t.fields.find((f) => f.id === backFieldId)!;
  const tpl = t.templates[0];
  // Alan adları anlaşılır olsun: Ön/Geri → Kelime/Anlam (şablonlardaki adlar da değişir)
  const wordName = back.name === WORD_FIELD ? front.name : WORD_FIELD;
  const meaningName = wordName === MEANING_FIELD || front.name === MEANING_FIELD ? back.name : MEANING_FIELD;
  const rename = (html: string) => renameFieldInTemplate(renameFieldInTemplate(html, front.name, wordName), back.name, meaningName);
  const pronBlock = `{{#${PRON_FIELD}}}<div class="kk-pron">{{${PRON_FIELD}}}</div>{{/${PRON_FIELD}}}`;
  const after = (await updateRow(db, "note_types", t.id, {
    fields: [
      ...t.fields.map((f) => (f.id === frontFieldId ? { ...f, name: wordName } : f.id === backFieldId ? { ...f, name: meaningName } : f)),
      { id: pronId, name: PRON_FIELD, sticky: false },
    ],
    templates: [
      {
        ...tpl,
        front: rename(tpl.front).replace(
          `{{${wordName}}}`,
          `<div class="kk-word">{{${wordName}}}</div>${pronBlock}{{#Example}}<div class="kk-example-box">{{Example}}</div>{{/Example}}`,
        ),
        back: rename(tpl.back),
      },
    ],
    word_field: t.word_field ?? frontFieldId,
  }))!;

  const hasExamples = new Set(
    (await db.note_examples.where("note_id").anyOf(c.notes.map((n) => n.id)).toArray()).filter((e) => e.deleted_at === null).map((e) => e.note_id),
  );
  const patches: { id: string; patch: Partial<NoteRow> }[] = [];
  const examples: Partial<NoteExampleRow>[] = [];
  for (const n of c.notes) {
    const p = parseWordFront(n.fields[frontFieldId] ?? "");
    if (!p.word) continue;
    const fields = { ...n.fields, [frontFieldId]: escapeHtml(p.word), [pronId]: escapeHtml(p.pron), [backFieldId]: cleanBack(n.fields[backFieldId] ?? "") };
    patches.push({ id: n.id, patch: { fields, sort_field: sortFieldText(after, fields) } });
    if (!hasExamples.has(n.id)) {
      p.examples.forEach((text, position) => examples.push({ note_id: n.id, text, translation: null, source: "user", approved: true, position }));
    }
  }
  await updateRows(db, "notes", patches);
  if (examples.length) await insertRows(db, "note_examples", examples);
  return { notes: patches.length, examples: examples.length };
}
