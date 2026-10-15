// "Cevabı yaz" karşılaştırması — Anki'deki gibi renkli fark gösterimi:
//   yeşil (typeGood)  : doğru yazılan karakterler
//   kırmızı (typeBad) : yanlış yazılan karakterler
//   gri (typeMissed)  : yazılması gerekip eksik kalanlar
import { escapeHtml } from "@/lib/text";

type Op = { kind: "same" | "typed" | "expected"; ch: string };

/** İki metnin karakter karakter farkı (en uzun ortak alt dizi ile) */
function diff(typed: string[], expected: string[]): Op[] {
  const n = typed.length;
  const m = expected.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = typed[i] === expected[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (typed[i] === expected[j]) {
      ops.push({ kind: "same", ch: typed[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ kind: "typed", ch: typed[i++] });
    } else {
      ops.push({ kind: "expected", ch: expected[j++] });
    }
  }
  while (i < n) ops.push({ kind: "typed", ch: typed[i++] });
  while (j < m) ops.push({ kind: "expected", ch: expected[j++] });
  return ops;
}

function spans(parts: { cls: string; text: string }[]): string {
  // Aynı sınıftaki ardışık karakterleri birleştir
  const merged: { cls: string; text: string }[] = [];
  for (const p of parts) {
    const prev = merged[merged.length - 1];
    if (prev && prev.cls === p.cls) prev.text += p.text;
    else merged.push({ ...p });
  }
  return merged.map((p) => `<span class="${p.cls}">${escapeHtml(p.text)}</span>`).join("");
}

export function compareTypedAnswer(expected: string, typed: string): string {
  const exp = expected.normalize("NFC").trim();
  const got = typed.normalize("NFC").trim();
  if (exp === got) return `<code id="typeans">${spans([{ cls: "typeGood", text: exp }])}</code>`;
  if (!got) return `<code id="typeans">${spans([{ cls: "typeMissed", text: exp }])}</code>`;

  const ops = diff([...got], [...exp]);
  const typedLine = ops
    .filter((o) => o.kind !== "expected")
    .map((o) => ({ cls: o.kind === "same" ? "typeGood" : "typeBad", text: o.ch }));
  const expectedLine = ops
    .filter((o) => o.kind !== "typed")
    .map((o) => ({ cls: o.kind === "same" ? "typeGood" : "typeMissed", text: o.ch }));
  return `<code id="typeans">${spans(typedLine)}<br><span id="typearrow">&darr;</span><br>${spans(expectedLine)}</code>`;
}
