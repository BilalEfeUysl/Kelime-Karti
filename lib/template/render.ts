// KART ÇİZİCİ: bir notu + not tipini + kart numarasını alır, sorunun ve
// cevabın HTML'ini üretir (Anki şablon sözdizimiyle uyumlu).
//
// Desteklenenler: {{Alan}}, {{FrontSide}}, {{#Alan}}…{{/Alan}}, {{^Alan}}…{{/Alan}},
// {{text:Alan}}, {{hint:Alan}}, {{type:Alan}}, {{type:cloze:Alan}}, {{cloze:Alan}},
// {{Tags}}, {{Deck}}, {{Subdeck}}, {{Card}}, {{CardFlag}}, {{Type}},
// EK: {{Example}} (onaylı örnek cümlelerden biri), {{Examples}} (hepsi).
import { escapeHtml, fieldIsEmpty, stripHtml } from "@/lib/text";
import { clozeAnswers, renderCloze } from "./cloze";
import { parseTemplate, type TemplateNode } from "./parser";
import { compareTypedAnswer } from "./typeanswer";
import { renderOcclusionSvg } from "@/lib/io";

/** Anki furigana sözdizimi: "日本語[にほんご]" (öncesinde boşluk ayırıcıdır) */
function furigana(html: string, mode: "ruby" | "kana" | "kanji"): string {
  return html.replace(/ ?([^ >[\]]+?)\[(.+?)\]/g, (_m, base: string, reading: string) =>
    mode === "kana" ? reading : mode === "kanji" ? base : `<ruby><rb>${base}</rb><rt>${reading}</rt></ruby>`,
  );
}

export interface ExampleItem {
  id: string;
  text: string;
  translation: string | null;
}

export interface RenderInput {
  noteType: {
    name: string;
    kind: string;
    fields: { id: string; name: string }[];
    templates: { name: string; front: string; back: string }[];
    css: string;
    word_field?: string | null;
  };
  note: { fields: Record<string, string>; tags: string[] };
  /** Kartın sırası (0'dan başlar). Cloze'da c1 → 0 */
  cardOrd: number;
  deckName: string;
  flags?: number;
  /** Notun onaylı örnek cümleleri (sıralı) */
  examples?: ExampleItem[];
  /** Bu gösterimde {{Example}} için seçilen cümle */
  chosenExampleId?: string | null;
}

export interface RenderedCard {
  question: string;
  answer: string;
  css: string;
  /** Kartta {{type:…}} varsa beklenen cevap */
  typeAnswer: { expected: string } | null;
}

const TYPE_MARKER = "\u0000kk-type\u0000";
const TYPE_INPUT =
  '<input type="text" id="typeans" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Cevabı yaz">';

export const SPECIAL_FIELDS = ["FrontSide", "Tags", "Deck", "Subdeck", "Card", "CardFlag", "Type", "Example", "Examples"];

interface Ctx {
  side: "question" | "answer";
  fields: Map<string, string>;
  fieldsLower: Map<string, string>;
  special: Record<string, string>;
  clozeOrd: number;
  examples: ExampleItem[];
  chosen: ExampleItem | null;
  word: string;
  typeExpected: string | null;
  frontSide: string;
}

function lookupField(ctx: Ctx, name: string): string | undefined {
  return ctx.fields.get(name) ?? ctx.fieldsLower.get(name.toLowerCase());
}

/** Örnek cümlede kelimeyi kalın ve hafif renkli göster ("abandon" → "abandoned" da yakalanır). */
function highlightWord(text: string, word: string): string {
  const safe = escapeHtml(text);
  const w = word.trim();
  if (w.length < 2) return safe;
  const pattern = escapeHtml(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return safe.replace(new RegExp(`(?<![\\p{L}])(${pattern}[\\p{L}]*)`, "giu"), '<b class="kk-hl">$1</b>');
  } catch {
    return safe;
  }
}

function exampleHtml(ctx: Ctx, ex: ExampleItem, withTranslation: boolean): string {
  const tr =
    withTranslation && ex.translation ? `<div class="kk-example-tr">${escapeHtml(ex.translation)}</div>` : "";
  return `<div class="kk-example-text">${highlightWord(ex.text, ctx.word)}</div>${tr}`;
}

function renderExample(ctx: Ctx): string {
  if (!ctx.chosen) return "";
  const main = `<div class="kk-example">${exampleHtml(ctx, ctx.chosen, ctx.side === "answer")}</div>`;
  if (ctx.side === "question") return main;
  const others = ctx.examples.filter((e) => e.id !== ctx.chosen!.id);
  if (!others.length) return main;
  const items = others.map((e) => `<li>${exampleHtml(ctx, e, true)}</li>`).join("");
  return `${main}<details class="kk-more-examples"><summary>Diğer örnekleri göster (${others.length})</summary><ul>${items}</ul></details>`;
}

function renderExamples(ctx: Ctx): string {
  if (!ctx.examples.length) return "";
  const items = ctx.examples.map((e) => `<li>${exampleHtml(ctx, e, ctx.side === "answer")}</li>`).join("");
  return `<ul class="kk-examples">${items}</ul>`;
}

function isTruthy(ctx: Ctx, name: string): boolean {
  const field = lookupField(ctx, name);
  if (field !== undefined) return !fieldIsEmpty(field);
  if (name === "Example" || name === "Examples") return ctx.examples.length > 0;
  const special = ctx.special[name];
  if (special !== undefined) return !fieldIsEmpty(special);
  return false;
}

function applyFilters(ctx: Ctx, raw: string, filters: string[], fieldName: string): string {
  // {{type:Alan}} / {{type:cloze:Alan}}: işaret bırak, sonra giriş kutusuna/karşılaştırmaya çevrilir
  if (filters[0] === "type") {
    if (ctx.typeExpected === null) {
      ctx.typeExpected = filters.includes("cloze") ? clozeAnswers(raw, ctx.clozeOrd) : stripHtml(raw);
    }
    return TYPE_MARKER;
  }
  let value = raw;
  // Filtreler sağdan sola uygulanır: {{text:cloze:Alan}} → önce cloze, sonra text
  for (let i = filters.length - 1; i >= 0; i--) {
    const f = filters[i];
    if (f === "text") value = stripHtml(value);
    else if (f === "cloze") value = renderCloze(value, ctx.clozeOrd, ctx.side);
    else if (f === "image-occlusion") value = renderOcclusionSvg(value, ctx.clozeOrd, ctx.side);
    else if (f === "furigana") value = furigana(value, "ruby");
    else if (f === "kana") value = furigana(value, "kana");
    else if (f === "kanji") value = furigana(value, "kanji");
    else if (f === "hint") {
      value = fieldIsEmpty(value)
        ? ""
        : `<a class="hint" href="#" onclick="this.style.display='none';this.nextElementSibling.style.display='block';return false;">${escapeHtml(fieldName)}</a><div class="hint" style="display:none">${value}</div>`;
    }
    // Bilinmeyen filtreler (furigana vb. ileride) içeriği değiştirmez
  }
  return value;
}

function renderNodes(nodes: TemplateNode[], ctx: Ctx): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") out += node.text;
    else if (node.type === "conditional") {
      if (isTruthy(ctx, node.field) !== node.negated) out += renderNodes(node.children, ctx);
    } else {
      const { field, filters } = node;
      if (field === "FrontSide") {
        out += ctx.side === "answer" ? ctx.frontSide : "";
        continue;
      }
      const value = lookupField(ctx, field);
      if (value !== undefined) out += applyFilters(ctx, value, filters, field);
      else if (field === "Example") out += renderExample(ctx);
      else if (field === "Examples") out += renderExamples(ctx);
      else if (ctx.special[field] !== undefined) out += applyFilters(ctx, ctx.special[field], filters, field);
      else out += `<span class="kk-template-error">{Bilinmeyen alan: ${escapeHtml(field)}}</span>`;
    }
  }
  return out;
}

function errorHtml(message: string) {
  return `<div class="kk-template-error">Şablon hatası: ${escapeHtml(message)}</div>`;
}

export function renderCard(input: RenderInput, opts: { typed?: string } = {}): RenderedCard {
  const { noteType, note, cardOrd } = input;
  const isCloze = noteType.kind === "cloze" || noteType.kind === "image_occlusion";
  const template = isCloze ? noteType.templates[0] : noteType.templates[cardOrd];
  if (!template) {
    const err = errorHtml(`Bu not tipinde ${cardOrd + 1}. kart şablonu yok`);
    return { question: err, answer: err, css: noteType.css, typeAnswer: null };
  }

  const fields = new Map<string, string>();
  const fieldsLower = new Map<string, string>();
  for (const f of noteType.fields) {
    const v = note.fields[f.id] ?? "";
    fields.set(f.name, v);
    if (!fieldsLower.has(f.name.toLowerCase())) fieldsLower.set(f.name.toLowerCase(), v);
  }
  const examples = input.examples ?? [];
  const chosen = examples.find((e) => e.id === input.chosenExampleId) ?? examples[0] ?? null;
  const deckParts = input.deckName.split("::");
  const wordField = noteType.fields.find((f) => f.id === noteType.word_field);

  const base: Omit<Ctx, "side" | "typeExpected" | "frontSide"> = {
    fields,
    fieldsLower,
    special: {
      Tags: note.tags.join(" "),
      Deck: input.deckName,
      Subdeck: deckParts[deckParts.length - 1] ?? "",
      Card: template.name,
      CardFlag: input.flags ? `flag${input.flags}` : "",
      Type: noteType.name,
    },
    clozeOrd: cardOrd + 1,
    examples,
    chosen,
    word: wordField ? stripHtml(fields.get(wordField.name) ?? "") : "",
  };

  try {
    const qCtx: Ctx = { ...base, side: "question", typeExpected: null, frontSide: "" };
    const qRaw = renderNodes(parseTemplate(template.front), qCtx);
    const question = qRaw.replace(TYPE_MARKER, TYPE_INPUT).split(TYPE_MARKER).join("");
    const frontSide = qRaw.split(TYPE_MARKER).join(""); // {{FrontSide}}'da giriş kutusu olmaz

    const aCtx: Ctx = { ...base, side: "answer", typeExpected: qCtx.typeExpected, frontSide };
    const aRaw = renderNodes(parseTemplate(template.back), aCtx);
    const expected = aCtx.typeExpected ?? qCtx.typeExpected;
    const comparison = expected !== null ? compareTypedAnswer(expected, opts.typed ?? "") : "";
    const answer = aRaw.replace(TYPE_MARKER, comparison).split(TYPE_MARKER).join("");

    return { question, answer, css: noteType.css, typeAnswer: expected !== null ? { expected } : null };
  } catch (err) {
    const msg = errorHtml((err as Error).message);
    return { question: msg, answer: msg, css: noteType.css, typeAnswer: null };
  }
}
