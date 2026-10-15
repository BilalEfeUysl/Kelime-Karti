// GEMINI İSTEMLERİ ve CEVAP DOĞRULAMA (sunucu + testler kullanır; anahtar içermez).
// Gemini'den yapılandırılmış JSON istenir; gelen cevap yine de kontrol edilir:
// bozuk/eksik parçalar atılır, eksik kalan kelimeler sonraki partiye kalır.

export const PROMPT_VERSION = "v1";
/** Bir istekte gönderilecek kelime sayısı (toplu üretim) */
export const BATCH_SIZE = 25;

export interface ExampleSentence {
  en: string;
  tr: string;
}

export interface Explanation {
  word: string;
  partOfSpeech: string;
  meaningsTr: string[];
  definitionEn: string;
  examples: ExampleSentence[];
  synonyms: string[];
  antonyms: string[];
  collocations: string[];
  ydsNote: string;
}

/** Önbellek anahtarı için kelimeyi sadeleştirir */
export function normalizeWord(word: string): string {
  return word
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en");
}

const strArray = { type: "array", items: { type: "string" } };
const sentence = {
  type: "object",
  properties: { en: { type: "string" }, tr: { type: "string" } },
  required: ["en", "tr"],
};

export const EXPLAIN_SCHEMA = {
  type: "object",
  properties: {
    word: { type: "string" },
    partOfSpeech: { type: "string", description: "Türkçe: fiil, isim, sıfat, zarf, edat, bağlaç, deyim…" },
    meaningsTr: { ...strArray, description: "En yaygından başlayarak Türkçe karşılıklar" },
    definitionEn: { type: "string", description: "Kısa, sade İngilizce tanım" },
    examples: { type: "array", items: sentence, description: "2-3 doğal İngilizce cümle ve Türkçe çevirileri" },
    synonyms: strArray,
    antonyms: strArray,
    collocations: { ...strArray, description: "Sık kullanılan kalıplar (ör. 'abandon hope')" },
    ydsNote: { type: "string", description: "YDS sınavında nasıl çıkabileceğine dair 1-2 cümlelik Türkçe not" },
  },
  required: ["word", "partOfSpeech", "meaningsTr", "definitionEn", "examples", "synonyms", "antonyms", "collocations", "ydsNote"],
};

export function explainPrompt(word: string, meaning?: string): string {
  return [
    "Sen Türk öğrencilere YDS (Yabancı Dil Sınavı) için İngilizce kelime öğreten bir öğretmensin.",
    `Kelime: "${word}"`,
    meaning ? `Öğrencinin kartındaki anlam (bu anlama öncelik ver): "${meaning}"` : "",
    "JSON şemasına uygun cevap ver. Örnek cümleler B1-B2 seviyesinde, doğal ve kısa olsun; kelimeyi (gerekirse çekimli hâliyle) mutlaka içersin.",
    "Türkçe alanlar doğal Türkçe olsun.",
  ]
    .filter(Boolean)
    .join("\n");
}

export const BATCH_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, sentences: { type: "array", items: sentence } },
        required: ["id", "sentences"],
      },
    },
  },
  required: ["items"],
};

export interface BatchWord {
  id: string;
  word: string;
  meaning?: string;
}

export interface BatchOptions {
  count: number; // kelime başına cümle (1-5)
  level: string; // ör. "YDS / B1-B2"
  translate: boolean;
}

export function batchPrompt(words: BatchWord[], o: BatchOptions): string {
  const list = words.map((w) => ({ id: w.id, word: w.word, ...(w.meaning ? { meaning: w.meaning } : {}) }));
  return [
    "Sen Türk öğrencilere YDS için İngilizce kelime öğreten bir öğretmensin.",
    `Aşağıdaki her kelime için ${o.count} farklı İngilizce örnek cümle yaz. Seviye: ${o.level}.`,
    "Kurallar: cümle kelimeyi (gerekirse çekimli hâliyle) içersin; 8-20 kelime uzunluğunda, doğal ve akademik/haber diline yakın olsun;",
    "aynı kelimenin cümleleri birbirinden farklı yapıda olsun; 'meaning' verilmişse o anlamı kullan.",
    o.translate ? "Her cümlenin doğal Türkçe çevirisini 'tr' alanına yaz." : "'tr' alanını boş bırak.",
    "Her kelimenin 'id' değerini AYNEN geri döndür.",
    `Kelimeler (JSON): ${JSON.stringify(list)}`,
  ].join("\n");
}

const clean = (s: unknown, max = 400): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const cleanList = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? [...new Set(v.map((x) => clean(x, 120)).filter(Boolean))].slice(0, max) : [];

/** Cümle kelimeyi (ya da kökünü) içeriyor mu? "abandon" → "abandoned" da geçer */
export function sentenceHasWord(sentence: string, word: string): boolean {
  const s = sentence.toLowerCase();
  const parts = normalizeWord(word).split(" ").filter((p) => p.length > 1);
  if (!parts.length) return true;
  return parts.every((p) => {
    const stem = p.length > 4 ? p.slice(0, Math.max(4, p.length - 2)) : p;
    return s.includes(stem);
  });
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Bazen ```json … ``` içinde gelir
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

function sentences(v: unknown, word: string, translate: boolean, max: number): ExampleSentence[] {
  if (!Array.isArray(v)) return [];
  const out: ExampleSentence[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    const en = clean((item as ExampleSentence)?.en, 300);
    const tr = translate ? clean((item as ExampleSentence)?.tr, 300) : "";
    if (en.length < 8 || !sentenceHasWord(en, word) || seen.has(en.toLowerCase())) continue;
    seen.add(en.toLowerCase());
    out.push({ en, tr });
    if (out.length >= max) break;
  }
  return out;
}

/** Açıklama cevabını doğrular; kullanılamazsa null */
export function parseExplanation(raw: string, word: string): Explanation | null {
  const d = parseJson(raw) as Partial<Explanation> | null;
  if (!d || typeof d !== "object") return null;
  const e: Explanation = {
    word: clean(d.word, 80) || word,
    partOfSpeech: clean(d.partOfSpeech, 60),
    meaningsTr: cleanList(d.meaningsTr),
    definitionEn: clean(d.definitionEn, 400),
    examples: sentences(d.examples, word, true, 5),
    synonyms: cleanList(d.synonyms),
    antonyms: cleanList(d.antonyms),
    collocations: cleanList(d.collocations),
    ydsNote: clean(d.ydsNote, 600),
  };
  if (!e.meaningsTr.length && !e.definitionEn) return null;
  return e;
}

/** Toplu cevabı doğrular: sadece istenen id'ler, geçerli cümleler. Eksikler `missing`'de. */
export function parseBatch(raw: string, words: BatchWord[], o: BatchOptions): { results: Map<string, ExampleSentence[]>; missing: string[] } {
  const d = parseJson(raw) as { items?: { id?: unknown; sentences?: unknown }[] } | null;
  const byId = new Map(words.map((w) => [w.id, w]));
  const results = new Map<string, ExampleSentence[]>();
  for (const item of Array.isArray(d?.items) ? d!.items : []) {
    const id = typeof item?.id === "string" ? item.id : "";
    const w = byId.get(id);
    if (!w || results.has(id)) continue;
    const list = sentences(item.sentences, w.word, o.translate, o.count);
    if (list.length) results.set(id, list);
  }
  return { results, missing: words.filter((w) => !results.has(w.id)).map((w) => w.id) };
}
