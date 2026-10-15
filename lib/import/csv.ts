// CSV / TXT İÇE AKTARMA
//  - Ayırıcı seçimi (sekme, virgül, noktalı virgül, dikey çizgi) + otomatik tahmin
//  - Tırnaklı alanlar ("a, b" ve satır içi yeni satır) desteklenir
//  - Anki'nin dışa aktarma başlıkları: #separator:tab, #html:true, #tags column:3
//  - Sütun eşleştirme: alan / etiketler / örnek cümle / çeviri / yok say
import type { LocalDB } from "@/lib/db/database";
import { insertRows } from "@/lib/db/mutations";
import type { CardRow, NoteExampleRow, NoteRow, NoteTypeRow } from "@/lib/db/types";
import { cardOrdsForNote } from "@/lib/cards/generate";
import { nextNewPosition, sortFieldText } from "@/lib/notes";
import { escapeHtml, newGuid, normalizeTags } from "@/lib/text";
import { splitExamples } from "./examples";
import type { ImportProgress } from "./anki-writer";

export const DELIMITERS: { value: string; label: string }[] = [
  { value: "\t", label: "Sekme" },
  { value: ",", label: "Virgül (,)" },
  { value: ";", label: "Noktalı virgül (;)" },
  { value: "|", label: "Dikey çizgi (|)" },
];

export interface TextFileHeaders {
  delimiter: string | null;
  html: boolean | null;
  tagsColumn: number | null; // 0'dan başlar
}

/** Anki dışa aktarma başlıklarını (# ile başlayan satırlar) ayıklar */
export function readHeaders(text: string): { headers: TextFileHeaders; body: string } {
  const headers: TextFileHeaders = { delimiter: null, html: null, tagsColumn: null };
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let i = 0;
  for (; i < lines.length && lines[i].startsWith("#"); i++) {
    const m = lines[i].match(/^#([\w ]+):(.*)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key === "separator") {
      const map: Record<string, string> = { tab: "\t", comma: ",", semicolon: ";", pipe: "|", space: " " };
      headers.delimiter = map[value.toLowerCase()] ?? (value.length === 1 ? value : null);
    } else if (key === "html") headers.html = value.toLowerCase() === "true";
    else if (key === "tags column") headers.tagsColumn = Number(value) - 1;
  }
  return { headers, body: lines.slice(i).join("\n") };
}

/** İlk satırlara bakarak ayırıcıyı tahmin eder */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).filter(Boolean);
  let best = "\t";
  let bestScore = -1;
  for (const { value } of DELIMITERS) {
    const counts = sample.map((l) => l.split(value).length - 1);
    const min = Math.min(...counts);
    const consistent = counts.every((c) => c === counts[0]);
    const score = min > 0 ? min + (consistent ? 100 : 0) : 0;
    if (score > bestScore) {
      best = value;
      bestScore = score;
    }
  }
  return best;
}

/** RFC 4180 benzeri ayrıştırma (tırnaklar, "" kaçışı, tırnak içinde yeni satır) */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

export type ColumnTarget =
  | { kind: "ignore" }
  | { kind: "field"; fieldId: string }
  | { kind: "tags" }
  | { kind: "example" }
  | { kind: "translation" };

export interface CsvImportOptions {
  noteType: NoteTypeRow;
  deckId: string;
  columns: ColumnTarget[];
  allowHtml: boolean;
  extraTags: string[];
  skipFirstRow: boolean;
}

export interface CsvSummary {
  notesAdded: number;
  rowsSkipped: number;
  cardsAdded: number;
  examplesAdded: number;
}

function toHtml(value: string, allowHtml: boolean): string {
  return allowHtml ? value : escapeHtml(value).replace(/\r?\n/g, "<br>");
}

export async function importCsvRows(
  db: LocalDB,
  rows: string[][],
  opts: CsvImportOptions,
  onProgress: (p: ImportProgress) => void = () => {},
): Promise<CsvSummary> {
  const summary: CsvSummary = { notesAdded: 0, rowsSkipped: 0, cardsAdded: 0, examplesAdded: 0 };
  const data = opts.skipFirstRow ? rows.slice(1) : rows;
  const position = nextNewPosition(db.now());
  const CHUNK = 300;

  for (let i = 0; i < data.length; i += CHUNK) {
    onProgress({ label: "Satırlar", done: i, total: data.length });
    const notes: Partial<NoteRow>[] = [];
    const cards: Partial<CardRow>[] = [];
    const examples: Partial<NoteExampleRow>[] = [];
    for (const [k, row] of data.slice(i, i + CHUNK).entries()) {
      const fields: Record<string, string> = {};
      const tags: string[] = [...opts.extraTags];
      const exTexts: string[] = [];
      const exTranslations: string[] = [];
      opts.columns.forEach((target, col) => {
        const value = (row[col] ?? "").trim();
        if (target.kind === "field") fields[target.fieldId] = toHtml(value, opts.allowHtml);
        else if (target.kind === "tags") tags.push(...value.split(/\s+/));
        else if (target.kind === "example" && value) exTexts.push(...splitExamples(toHtml(value, opts.allowHtml)));
        else if (target.kind === "translation") exTranslations.push(value);
      });
      const ords = cardOrdsForNote(opts.noteType, fields);
      if (!ords.length) {
        summary.rowsSkipped++;
        continue;
      }
      const noteId = crypto.randomUUID();
      notes.push({
        id: noteId,
        note_type_id: opts.noteType.id,
        guid: newGuid(),
        fields,
        tags: normalizeTags(tags),
        sort_field: sortFieldText(opts.noteType, fields),
      });
      for (const ord of ords) cards.push({ note_id: noteId, deck_id: opts.deckId, ord, position: position + i + k });
      exTexts.forEach((text, j) =>
        examples.push({
          note_id: noteId,
          text,
          translation: exTranslations[j] || null,
          source: "deck",
          approved: true,
          position: j,
        }),
      );
    }
    summary.notesAdded += (await insertRows(db, "notes", notes)).length;
    summary.cardsAdded += (await insertRows(db, "cards", cards)).length;
    if (examples.length) summary.examplesAdded += (await insertRows(db, "note_examples", examples)).length;
    await new Promise((r) => setTimeout(r, 0));
  }
  onProgress({ label: "Bitti", done: 1, total: 1 });
  return summary;
}
