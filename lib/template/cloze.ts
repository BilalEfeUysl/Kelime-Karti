// CLOZE (boşluk doldurma) — Anki ile uyumlu.
//   {{c1::cevap}}            → 1. kartta gizlenir
//   {{c1::cevap::ipucu}}     → soru tarafında [ipucu] yazar
//   {{c1,2::cevap}}          → hem 1. hem 2. kartta gizlenir
//   İç içe cloze desteklenir: {{c1::dış {{c2::iç}} kısım}}
import { escapeHtml, stripHtml } from "@/lib/text";

type ClozeNode = string | { ords: number[]; children: ClozeNode[]; hint: string | null };

function parseCloze(text: string): ClozeNode[] {
  const root: ClozeNode[] = [];
  const stack: { ords: number[]; children: ClozeNode[] }[] = [];
  const re = /\{\{c(\d+(?:,\d+)*)::|\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const target = () => (stack.length ? stack[stack.length - 1].children : root);

  while ((m = re.exec(text))) {
    if (m[0] === "}}") {
      if (!stack.length) continue; // cloze dışındaki "}}" düz metindir
      if (m.index > last) target().push(text.slice(last, m.index));
      last = m.index + 2;
      const open = stack.pop()!;
      // İpucu: son metin parçasındaki ilk "::" sonrası
      let hint: string | null = null;
      const lastChild = open.children[open.children.length - 1];
      if (typeof lastChild === "string") {
        const i = lastChild.indexOf("::");
        if (i >= 0) {
          hint = lastChild.slice(i + 2);
          open.children[open.children.length - 1] = lastChild.slice(0, i);
        }
      }
      target().push({ ords: open.ords, children: open.children, hint });
    } else {
      if (m.index > last) target().push(text.slice(last, m.index));
      last = m.index + m[0].length;
      stack.push({ ords: m[1].split(",").map(Number), children: [] });
    }
  }
  // Kapatılmamış clozeleri düz metin gibi geri koy
  let tail = text.slice(last);
  while (stack.length) {
    const open = stack.pop()!;
    const inner = open.children.map((c) => (typeof c === "string" ? c : "")).join("");
    tail = `{{c${open.ords.join(",")}::${inner}${tail}`;
  }
  if (tail) target().push(tail);
  return root;
}

/** Metindeki tüm cloze numaraları (1'den başlar) */
export function clozeNumbers(text: string): Set<number> {
  const out = new Set<number>();
  const walk = (nodes: ClozeNode[]) => {
    for (const n of nodes) {
      if (typeof n === "string") continue;
      n.ords.forEach((o) => out.add(o));
      walk(n.children);
    }
  };
  walk(parseCloze(text));
  return out;
}

function plain(nodes: ClozeNode[]): string {
  return nodes.map((n) => (typeof n === "string" ? n : plain(n.children))).join("");
}

/**
 * Cloze alanını belirli bir kart (ord: 1'den başlar) için çizer.
 * Soru tarafında etkin cloze "[...]" olur; cevap tarafında vurgulanır.
 */
export function renderCloze(text: string, ord: number, side: "question" | "answer"): string {
  const render = (nodes: ClozeNode[]): string =>
    nodes
      .map((n) => {
        if (typeof n === "string") return n;
        const active = n.ords.includes(ord);
        if (active && side === "question") {
          const answer = render(n.children);
          return `<span class="cloze" data-cloze="${escapeHtml(answer)}" data-ordinal="${ord}">[${n.hint ?? "..."}]</span>`;
        }
        if (active) return `<span class="cloze" data-ordinal="${ord}">${render(n.children)}</span>`;
        return `<span class="cloze-inactive" data-ordinal="${n.ords.join(",")}">${render(n.children)}</span>`;
      })
      .join("");
  return render(parseCloze(text));
}

/** "Cevabı yaz" için: bu karttaki gizli cevapların düz metni (virgülle) */
export function clozeAnswers(text: string, ord: number): string {
  const out: string[] = [];
  const walk = (nodes: ClozeNode[]) => {
    for (const n of nodes) {
      if (typeof n === "string") continue;
      if (n.ords.includes(ord)) out.push(stripHtml(plain(n.children)));
      else walk(n.children);
    }
  };
  walk(parseCloze(text));
  return out.join(", ");
}
