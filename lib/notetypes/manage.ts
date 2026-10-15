// NOT TİPİ YÖNETİMİ: oluştur / kopyala / sil / yeniden adlandır ve
// alan + şablon değişikliklerini var olan notlara ve kartlara uygula.
//
// Kurallar (Anki'deki gibi):
//  - Alanlar kalıcı kimlikle tutulur; yeniden adlandırma notları değiştirmez,
//    sadece şablonlardaki {{Eski}} → {{Yeni}} güncellenir.
//  - Şablon silinirse o şablonun kartları silinir. Şablonların sırası
//    değişirse kartların "ord" değeri yeni sıraya göre güncellenir.
//  - Yeni şablon eklenince (ön yüzü dolu olan) notlar için kart üretilir.
import { generateMissingCards } from "@/lib/browse/ops";
import type { LocalDB } from "@/lib/db/database";
import { insertRow, softDeleteRows, updateRow, updateRows } from "@/lib/db/mutations";
import type { CardRow, NoteTypeField, NoteTypeRow, NoteTypeTemplate } from "@/lib/db/types";
import { deleteNotes, sortFieldText } from "@/lib/notes";
import { parseTemplate, TemplateError } from "@/lib/template/parser";
import { SPECIAL_FIELDS } from "@/lib/template/render";
import { shortId } from "@/lib/text";

export type NoteTypeDraft = Pick<NoteTypeRow, "name" | "kind" | "fields" | "templates" | "css" | "sort_field" | "word_field">;

export function newFieldId(): string {
  return `f-${shortId(8)}`;
}

export function newTemplateId(): string {
  return `t-${shortId(8)}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Şablondaki alan adını değiştirir: {{Ad}}, {{#Ad}}, {{/Ad}}, {{^Ad}}, {{filtre:Ad}} */
export function renameFieldInTemplate(template: string, oldName: string, newName: string): string {
  const re = new RegExp(`\\{\\{([#/^]?)((?:[^{}:]+:)*)\\s*${escapeRegex(oldName)}\\s*\\}\\}`, "g");
  return template.replace(re, (_m, sigil: string, filters: string) => `{{${sigil}${filters}${newName}}}`);
}

export interface NoteTypeProblem {
  message: string;
}

/** Kaydetmeden önce kontrol: boş/tekrarlı adlar, bozuk şablonlar */
export function validateNoteType(draft: NoteTypeDraft): string | null {
  if (!draft.name.trim()) return "Not tipinin adı boş olamaz.";
  if (!draft.fields.length) return "En az bir alan olmalı.";
  const names = new Set<string>();
  for (const f of draft.fields) {
    const n = f.name.trim();
    if (!n) return "Alan adı boş olamaz.";
    if (/[:{}"]/.test(n)) return `"${n}": alan adında : { } " karakterleri olamaz.`;
    if (SPECIAL_FIELDS.some((s) => s.toLowerCase() === n.toLowerCase())) return `"${n}" özel bir ad, alan adı olarak kullanılamaz.`;
    if (names.has(n.toLowerCase())) return `"${n}" adlı iki alan var.`;
    names.add(n.toLowerCase());
  }
  if (!draft.templates.length) return "En az bir kart şablonu olmalı.";
  if ((draft.kind === "cloze" || draft.kind === "image_occlusion") && draft.templates.length !== 1) return "Bu not tipinde tek kart şablonu olur.";
  const tnames = new Set<string>();
  for (const t of draft.templates) {
    if (!t.name.trim()) return "Şablon adı boş olamaz.";
    if (tnames.has(t.name.trim().toLowerCase())) return `"${t.name}" adlı iki şablon var.`;
    tnames.add(t.name.trim().toLowerCase());
    for (const [side, src] of [
      ["ön yüz", t.front],
      ["arka yüz", t.back],
    ] as const) {
      try {
        parseTemplate(src);
      } catch (err) {
        const msg = err instanceof TemplateError ? err.message : String(err);
        return `"${t.name}" ${side}: ${msg}`;
      }
    }
    if (!/\{\{[^}]+\}\}/.test(t.front)) return `"${t.name}" ön yüzünde en az bir alan olmalı (ör. {{${draft.fields[0].name}}}).`;
  }
  if (draft.kind === "cloze" && !/\{\{(?:[^}]*:)?cloze:[^}]+\}\}/.test(draft.templates[0].front)) {
    return "Cloze şablonunun ön yüzünde {{cloze:Alan}} olmalı.";
  }
  return null;
}

/** Yeni not tipi (var olan bir tipin kopyası olarak) */
export async function createNoteType(db: LocalDB, base: NoteTypeDraft, name: string): Promise<NoteTypeRow> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Ad boş olamaz.");
  return insertRow(db, "note_types", {
    name: trimmed,
    kind: base.kind,
    fields: base.fields.map((f) => ({ ...f })),
    templates: base.templates.map((t) => ({ ...t })),
    css: base.css,
    sort_field: base.sort_field,
    word_field: base.word_field,
  });
}

/** Not tipini ve ona ait TÜM notları (kartlar, örnekler) siler */
export async function deleteNoteType(db: LocalDB, id: string): Promise<number> {
  const notes = (await db.notes.where("note_type_id").equals(id).toArray()).filter((n) => n.deleted_at === null);
  if (notes.length) await deleteNotes(db, notes.map((n) => n.id));
  await softDeleteRows(db, "note_types", [id]);
  return notes.length;
}

export interface NoteTypeImpact {
  notes: number;
  cardsRemoved: number;
  removedTemplates: string[];
  removedFields: string[];
}

/** Değişikliğin etkisi (kaydetmeden önce kullanıcıya göstermek için) */
export async function noteTypeImpact(db: LocalDB, before: NoteTypeRow, after: NoteTypeDraft): Promise<NoteTypeImpact> {
  const keptTemplates = new Set(after.templates.map((t) => t.id));
  const removedOrds = new Set(before.templates.flatMap((t, i) => (keptTemplates.has(t.id) ? [] : [i])));
  const notes = (await db.notes.where("note_type_id").equals(before.id).toArray()).filter((n) => n.deleted_at === null);
  let cardsRemoved = 0;
  if (removedOrds.size && before.kind !== "cloze") {
    const cards = await db.cards.where("note_id").anyOf(notes.map((n) => n.id)).toArray();
    cardsRemoved = cards.filter((c) => c.deleted_at === null && removedOrds.has(c.ord)).length;
  }
  const keptFields = new Set(after.fields.map((f) => f.id));
  return {
    notes: notes.length,
    cardsRemoved,
    removedTemplates: before.templates.filter((t) => !keptTemplates.has(t.id)).map((t) => t.name),
    removedFields: before.fields.filter((f) => !keptFields.has(f.id)).map((f) => f.name),
  };
}

/**
 * Not tipini kaydeder ve değişiklikleri notlara/kartlara uygular.
 * Doğrulama hatasında Error fırlatır.
 */
export async function saveNoteType(db: LocalDB, id: string, draft: NoteTypeDraft): Promise<void> {
  const problem = validateNoteType(draft);
  if (problem) throw new Error(problem);
  const before = await db.note_types.get(id);
  if (!before) throw new Error("Not tipi bulunamadı");

  const fields: NoteTypeField[] = draft.fields.map((f) => ({ ...f, name: f.name.trim() }));
  const templates: NoteTypeTemplate[] = draft.templates.map((t) => ({ ...t, name: t.name.trim() }));
  const fieldIds = new Set(fields.map((f) => f.id));
  const sortField = draft.sort_field && fieldIds.has(draft.sort_field) ? draft.sort_field : fields[0].id;
  const wordField = draft.word_field && fieldIds.has(draft.word_field) ? draft.word_field : null;

  const after = (await updateRow(db, "note_types", id, {
    name: draft.name.trim(),
    fields,
    templates,
    css: draft.css,
    sort_field: sortField,
    word_field: wordField,
  }))!;

  const notes = (await db.notes.where("note_type_id").equals(id).toArray()).filter((n) => n.deleted_at === null);
  if (!notes.length) return;

  // Sıralama alanı değiştiyse (ya da silindiyse) notların sıralama metnini yenile
  const sortChanged = (before.sort_field ?? before.fields[0]?.id) !== sortField || !before.fields.some((f) => f.id === sortField);
  if (sortChanged) {
    await updateRows(
      db,
      "notes",
      notes.map((n) => ({ id: n.id, patch: { sort_field: sortFieldText(after, n.fields) } })),
    );
  }

  // Kartları yeni şablon sırasına eşle (cloze'da sıra = boşluk numarası, dokunma)
  if (before.kind !== "cloze") {
    const newOrd = new Map(templates.map((t, i) => [t.id, i]));
    const ordMap = new Map<number, number | null>(before.templates.map((t, i) => [i, newOrd.get(t.id) ?? null]));
    const changed = [...ordMap].some(([o, n]) => o !== n);
    if (changed) {
      const cards = (await db.cards.where("note_id").anyOf(notes.map((n) => n.id)).toArray()).filter((c) => c.deleted_at === null);
      const patches: { id: string; patch: Partial<CardRow> }[] = [];
      const remove: string[] = [];
      for (const c of cards) {
        const next = ordMap.has(c.ord) ? ordMap.get(c.ord)! : c.ord;
        if (next === null) remove.push(c.id);
        else if (next !== c.ord) patches.push({ id: c.id, patch: { ord: next } });
      }
      await updateRows(db, "cards", patches);
      await softDeleteRows(db, "cards", remove);
    }
  }

  // Yeni şablonlar / değişen ön yüzler için eksik kartları üret
  await generateMissingCards(db, notes, after);
}

/** Boş bir not tipi taslağı için başlangıç alanları */
export function blankField(name: string): NoteTypeField {
  return { id: newFieldId(), name, sticky: false };
}

export function blankTemplate(name: string, fields: NoteTypeField[]): NoteTypeTemplate {
  const first = fields[0]?.name ?? "Front";
  const second = fields[1]?.name ?? first;
  return {
    id: newTemplateId(),
    name,
    front: `{{${first}}}`,
    back: `{{FrontSide}}\n\n<hr id=answer>\n\n{{${second}}}`,
  };
}
