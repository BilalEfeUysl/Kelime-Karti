// Bir nottan hangi kartların üretileceği (Anki kuralları):
//  - Normal not tipi: her şablon için, ÖN YÜZÜ boş olmayacaksa kart üretilir.
//    "Boş olmamak" = şablonda (koşullar hesaba katılarak) içi dolu en az bir
//    alan gösteriliyor olması. {{FrontSide}}, {{Tags}} gibi özel alanlar sayılmaz.
//  - Cloze not tipi: ön yüzde {{cloze:Alan}} ile kullanılan alanlardaki her
//    c1, c2… için bir kart. Hiç cloze yoksa 1. kart (boş kart) üretilir.
import type { NoteTypeRow } from "@/lib/db/types";
import { parseOcclusions } from "@/lib/io";
import { clozeNumbers } from "@/lib/template/cloze";
import { parseTemplate, type TemplateNode } from "@/lib/template/parser";
import { fieldIsEmpty } from "@/lib/text";

type FieldValues = Map<string, string>; // alan adı → içerik

function valuesByName(noteType: Pick<NoteTypeRow, "fields">, fields: Record<string, string>): FieldValues {
  const map = new Map<string, string>();
  for (const f of noteType.fields) map.set(f.name, fields[f.id] ?? "");
  return map;
}

function lookup(values: FieldValues, name: string): string | undefined {
  if (values.has(name)) return values.get(name);
  const lower = name.toLowerCase();
  for (const [k, v] of values) if (k.toLowerCase() === lower) return v;
  return undefined;
}

/** Şablon, verilen alan değerleriyle en az bir dolu alan gösteriyor mu? */
export function templateHasContent(template: string, values: FieldValues): boolean {
  const walk = (nodes: TemplateNode[]): boolean => {
    for (const n of nodes) {
      if (n.type === "replacement") {
        const v = lookup(values, n.field);
        if (v !== undefined && !fieldIsEmpty(v)) return true;
      } else if (n.type === "conditional") {
        const v = lookup(values, n.field);
        // Not alanı değilse (ör. {{#Tags}}) koşulu "doğru" kabul et
        const truthy = v === undefined ? true : !fieldIsEmpty(v);
        if (truthy !== n.negated && walk(n.children)) return true;
      }
    }
    return false;
  };
  try {
    return walk(parseTemplate(template));
  } catch {
    return false;
  }
}

/** Ön şablonda {{cloze:…}} ile kullanılan alan adları */
function clozeFieldNames(template: string): string[] {
  const out: string[] = [];
  const walk = (nodes: TemplateNode[]) => {
    for (const n of nodes) {
      if (n.type === "replacement" && n.filters.includes("cloze")) out.push(n.field);
      else if (n.type === "conditional") walk(n.children);
    }
  };
  try {
    walk(parseTemplate(template));
  } catch {
    // bozuk şablon: alan yok
  }
  return out;
}

/** Bu not için üretilmesi gereken kart sıraları (0'dan başlar). */
export function cardOrdsForNote(
  noteType: Pick<NoteTypeRow, "kind" | "fields" | "templates">,
  fields: Record<string, string>,
): number[] {
  const values = valuesByName(noteType, fields);
  if (noteType.kind === "image_occlusion") {
    // Her maske grubu (c1, c2…) bir kart
    const groups = [...new Set(parseOcclusions(lookup(values, "Occlusion") ?? Object.values(fields)[0] ?? "").map((s) => s.group))];
    return groups.length ? groups.filter((g) => g >= 1).sort((a, b) => a - b).map((g) => g - 1) : [];
  }
  if (noteType.kind === "cloze") {
    const template = noteType.templates[0];
    if (!template) return [];
    const nums = new Set<number>();
    for (const name of clozeFieldNames(template.front)) {
      const v = lookup(values, name);
      if (v) clozeNumbers(v).forEach((n) => nums.add(n));
    }
    if (nums.size === 0) return [0];
    return [...nums].filter((n) => n >= 1).sort((a, b) => a - b).map((n) => n - 1);
  }
  return noteType.templates.flatMap((t, i) => (templateHasContent(t.front, values) ? [i] : []));
}
