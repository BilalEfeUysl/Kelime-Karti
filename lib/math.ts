// Formüller: Anki'deki MathJax sözdizimi \( … \) (satır içi) ve \[ … \] (ayrı satır).
// KaTeX ile uygulamanın içinde HTML'e çevrilir (MathJax'tan çok küçük; kart
// çerçevesine sadece sonuç ve gömülü yazı tipli stil gider → internetsiz çalışır).
import { decodeEntities } from "@/lib/text";

export function hasMath(html: string): boolean {
  return /\\\(|\\\[/.test(html);
}

export async function renderMath(html: string): Promise<{ html: string; css: string }> {
  const [{ default: katex }, { KATEX_CSS }] = await Promise.all([import("katex"), import("@/lib/generated/katex-css")]);
  const tex = (raw: string) => decodeEntities(raw.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, ""));
  const render = (raw: string, displayMode: boolean) =>
    katex.renderToString(tex(raw), { displayMode, throwOnError: false, output: "html", strict: "ignore" });
  const out = html
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, t: string) => render(t, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, t: string) => render(t, false));
  return { html: out, css: KATEX_CSS };
}
