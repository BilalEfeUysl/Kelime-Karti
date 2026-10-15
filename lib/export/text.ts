// METİN OLARAK DIŞA AKTARMA (Anki'nin "Notes in Plain Text" biçimi):
// sekmeyle ayrılmış; başlık satırları (#separator, #html, #notetype column,
// #deck column, #tags column) sayesinde Anki ve bu uygulama geri okuyabilir.
import type { CardRow, DeckRow, NoteExampleRow, NoteRow, NoteTypeRow } from "@/lib/db/types";
import { buildDeckTree, flattenDeckTree } from "@/lib/decks";
import { stripHtml } from "@/lib/text";

export interface TextExportInput {
  notes: NoteRow[];
  cards: CardRow[];
  noteTypes: NoteTypeRow[];
  decks: DeckRow[];
  examples: NoteExampleRow[];
  html: boolean;
  includeExamples: boolean;
}

function cell(value: string): string {
  return /[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function exportText(input: TextExportInput): { text: string; notes: number } {
  const types = new Map(input.noteTypes.map((t) => [t.id, t]));
  const deckNames = new Map(flattenDeckTree(buildDeckTree(input.decks), true).map((n) => [n.deck.id, n.fullName]));
  const firstCard = new Map<string, CardRow>();
  for (const c of input.cards) {
    if (c.deleted_at !== null) continue;
    const cur = firstCard.get(c.note_id);
    if (!cur || c.ord < cur.ord) firstCard.set(c.note_id, c);
  }
  const exByNote = new Map<string, NoteExampleRow[]>();
  for (const e of input.examples) {
    if (e.deleted_at !== null || !e.approved) continue;
    exByNote.set(e.note_id, [...(exByNote.get(e.note_id) ?? []), e]);
  }
  const notes = input.notes.filter((n) => n.deleted_at === null && types.has(n.note_type_id));
  const maxFields = Math.max(0, ...notes.map((n) => types.get(n.note_type_id)!.fields.length));
  // Sütunlar: not tipi, deste, alanlar…, (örnekler), etiketler
  const tagsCol = 2 + maxFields + (input.includeExamples ? 1 : 0) + 1;
  const lines = [`#separator:tab`, `#html:${input.html}`, `#notetype column:1`, `#deck column:2`, `#tags column:${tagsCol}`];
  for (const n of notes) {
    const t = types.get(n.note_type_id)!;
    const card = firstCard.get(n.id);
    const deckId = card ? (card.original_deck_id ?? card.deck_id) : "";
    const fields = t.fields.map((f) => {
      const v = n.fields[f.id] ?? "";
      return input.html ? v : stripHtml(v);
    });
    while (fields.length < maxFields) fields.push("");
    const row = [t.name, deckNames.get(deckId) ?? "", ...fields];
    if (input.includeExamples) {
      const ex = (exByNote.get(n.id) ?? []).sort((a, b) => a.position - b.position);
      row.push(ex.map((e) => (e.translation ? `${e.text} — ${e.translation}` : e.text)).join(input.html ? "<br>" : "\n"));
    }
    row.push(n.tags.join(" "));
    lines.push(row.map(cell).join("\t"));
  }
  return { text: `${lines.join("\n")}\n`, notes: notes.length };
}
