"use client";
// Gemini'nin cevabındaki basit Markdown'ı (kalın, italik, madde, numaralı
// liste, başlık, kod) güvenli şekilde gösterir. HTML olarak değil, React
// metni olarak çizilir; cevapta HTML olsa bile çalıştırılmaz.
import { Fragment, type ReactNode } from "react";

/** Satır içi biçimler: **kalın**, *italik* / _italik_, `kod` */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${keyBase}-${i++}`;
    if (t.startsWith("**") || t.startsWith("__")) out.push(<strong key={k} className="font-semibold text-ink">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="rounded bg-ink/5 px-1 py-0.5 text-[0.9em]">{t.slice(1, -1)}</code>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block = { kind: "p"; lines: string[] } | { kind: "ul"; items: string[] } | { kind: "ol"; items: string[] } | { kind: "h"; text: string };

function parse(src: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of src.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const last = blocks[blocks.length - 1];
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const head = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (!line.trim()) {
      blocks.push({ kind: "p", lines: [] });
    } else if (head) {
      blocks.push({ kind: "h", text: head[1] });
    } else if (bullet) {
      if (last?.kind === "ul") last.items.push(bullet[1]);
      else blocks.push({ kind: "ul", items: [bullet[1]] });
    } else if (num) {
      if (last?.kind === "ol") last.items.push(num[1]);
      else blocks.push({ kind: "ol", items: [num[1]] });
    } else if (last?.kind === "p") {
      last.lines.push(line.trim());
    } else {
      blocks.push({ kind: "p", lines: [line.trim()] });
    }
  }
  return blocks.filter((b) => b.kind !== "p" || b.lines.length > 0);
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 leading-relaxed">
      {parse(text).map((b, i) => {
        const k = `b${i}`;
        if (b.kind === "h") return <p key={k} className="font-semibold text-ink">{inline(b.text, k)}</p>;
        if (b.kind === "ul")
          return (
            <ul key={k} className="list-disc space-y-1 pl-5 marker:text-accent/70">
              {b.items.map((it, j) => (
                <li key={j}>{inline(it, `${k}-${j}`)}</li>
              ))}
            </ul>
          );
        if (b.kind === "ol")
          return (
            <ol key={k} className="list-decimal space-y-1 pl-5 marker:text-ink-soft">
              {b.items.map((it, j) => (
                <li key={j}>{inline(it, `${k}-${j}`)}</li>
              ))}
            </ol>
          );
        return (
          <p key={k}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l, `${k}-${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
