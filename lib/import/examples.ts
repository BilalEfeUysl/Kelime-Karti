// ÖRNEK CÜMLE SİHİRBAZI yardımcıları:
//  - Alan adlarına bakarak "kelime hangi alanda?" ve "örnek cümle hangi
//    alanda?" sorularına tahmin üretir.
//  - Bir alanda birden fazla cümle varsa (<br>, satır sonu, numaralı liste,
//    <li>) bunları ayrı cümlelere böler.
import { stripHtml } from "@/lib/text";

const norm = (s: string) =>
  s
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[c] ?? c)
    .trim();

const WORD_PATTERNS = [
  /^(word|kelime|sozcuk|vocab|vocabulary|term|terim|expression|ifade)$/,
  /^(english|ingilizce|en|front|on|on yuz|question|soru)$/,
  /(word|kelime|vocab|english|ingilizce)/,
];

const EXAMPLE_PATTERNS = [
  /^(example|examples|ornek|ornekler|ornek cumle|ornek cumleler|sentence|sentences|cumle|cumleler)$/,
  /(example|ornek|sentence|cumle|usage|kullanim|context)/,
];

function guess(names: string[], patterns: RegExp[]): number | null {
  const normalized = names.map(norm);
  for (const p of patterns) {
    const i = normalized.findIndex((n) => p.test(n));
    if (i >= 0) return i;
  }
  return null;
}

/** Kelime alanı tahmini (bulunamazsa ilk alan) */
export function guessWordField(names: string[]): number | null {
  if (!names.length) return null;
  return guess(names, WORD_PATTERNS) ?? 0;
}

/** Örnek cümle alanı tahmini (bulunamazsa null) */
export function guessExampleField(names: string[]): number | null {
  return guess(names, EXAMPLE_PATTERNS);
}

/** Bir alandaki birden fazla örnek cümleyi ayırır */
export function splitExamples(html: string): string[] {
  if (!html || !html.trim()) return [];
  let parts: string[];
  if (/<li[\s>]/i.test(html)) {
    parts = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)(?=<\/li>|<li\b|$)/gi)].map((m) => m[1]);
  } else {
    parts = html.split(/<br\s*\/?>|<\/?(?:div|p)\b[^>]*>|\r?\n/i);
  }
  const out: string[] = [];
  for (const part of parts) {
    // "1. …", "2) …", "- …", "• …" gibi başları ve satır içi numaraları ayır
    const pieces = stripHtml(part).split(/\s+(?=\d{1,2}[.)]\s)/);
    for (const piece of pieces) {
      const text = piece.replace(/^\s*(?:\d{1,2}[.)]|[-•*–])\s*/, "").trim();
      if (text.length >= 3) out.push(text);
    }
  }
  return out;
}
