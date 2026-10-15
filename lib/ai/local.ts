// Gemini'nin ürettiği örnek cümleleri cihazdaki veritabanına yazar (normal
// şekilde eşlenir). Onay bekleyen cümleler (approved=false) kartta görünmez.
import type { LocalDB } from "@/lib/db/database";
import { getSetting, insertRows } from "@/lib/db/mutations";
import type { NoteRow, NoteTypeRow } from "@/lib/db/types";
import { stripHtml } from "@/lib/text";
import type { ExampleSentence } from "./prompts";

export const AUTO_APPROVE_SETTING = "ai.autoApprove";
/** Kart tarayıcıda seçilen notlar → örnek cümle sayfası (sessionStorage değil, localStorage) */
export const AI_SELECTION_KEY = "kk.ai.selection";

/** Notun kelimesi (kelime alanı, yoksa ilk alan) ve anlamı (sonraki alan) */
export function noteWord(note: NoteRow, nt: NoteTypeRow | undefined): { word: string; meaning: string } {
  if (!nt) return { word: note.sort_field, meaning: "" };
  const wordId = nt.word_field ?? nt.fields[0]?.id;
  const other = nt.fields.find((f) => f.id !== wordId);
  const strip = (s: string | undefined) => stripHtml((s ?? "").replace(/\{\{c\d+::([^}]*?)(?:::[^}]*)?\}\}/g, "$1")).slice(0, 120);
  return { word: strip(note.fields[wordId ?? ""]), meaning: other ? strip(note.fields[other.id]) : "" };
}

/** Cümleleri notun örneklerinin sonuna ekler; aynı cümle varsa atlar. Eklenen sayısını döndürür. */
export async function addExamples(
  db: LocalDB,
  noteId: string,
  sentences: ExampleSentence[],
  opts: { approved?: boolean; source?: "gemini" | "user" } = {},
): Promise<number> {
  const approved = opts.approved ?? (await getSetting(db, AUTO_APPROVE_SETTING, false));
  const existing = (await db.note_examples.where("note_id").equals(noteId).toArray()).filter((e) => e.deleted_at === null);
  const seen = new Set(existing.map((e) => e.text.trim().toLowerCase()));
  let pos = existing.reduce((m, e) => Math.max(m, e.position + 1), 0);
  const rows = sentences
    .filter((s) => s.en.trim() && !seen.has(s.en.trim().toLowerCase()))
    .map((s) => ({
      note_id: noteId,
      text: s.en.trim(),
      translation: s.tr?.trim() || null,
      source: opts.source ?? ("gemini" as const),
      approved,
      position: pos++,
    }));
  if (rows.length) await insertRows(db, "note_examples", rows);
  return rows.length;
}
