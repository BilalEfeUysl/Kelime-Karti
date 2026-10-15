// RESİM MASKELEME (Image Occlusion) — Anki ile aynı saklama biçimi:
//   {{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.1:oi=1}}
//   {{c2::image-occlusion:ellipse:left=.4:top=.4:rx=.05:ry=.03:oi=1}}
//   {{c3::image-occlusion:polygon:points=.1,.2 .3,.4 .5,.6:oi=1}}
// Koordinatlar resmin genişliğine/yüksekliğine göre 0–1 arası. Aynı numaralı
// (cN) maskeler bir gruptur → bir kart. oi=1: "hepsini gizle, birini sor"
// (diğer maskeler de kapalı kalır); oi yoksa "birini gizle, birini sor".

export type IoKind = "rect" | "ellipse" | "polygon";

export interface IoShape {
  group: number; // cN
  kind: IoKind;
  left: number;
  top: number;
  width: number; // rect
  height: number; // rect
  rx: number; // ellipse
  ry: number; // ellipse
  points: [number, number][]; // polygon
  hideAll: boolean; // oi=1
}

const SHAPE_RE = /\{\{c(\d+)::image-occlusion:(rect|ellipse|polygon)((?::[a-z]+=[^:}]*)*)\}\}/g;

const num = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
};

export function parseOcclusions(text: string): IoShape[] {
  const out: IoShape[] = [];
  for (const m of text.matchAll(SHAPE_RE)) {
    const attrs = new Map<string, string>();
    for (const part of m[3].split(":").filter(Boolean)) {
      const i = part.indexOf("=");
      if (i > 0) attrs.set(part.slice(0, i), part.slice(i + 1));
    }
    const points = (attrs.get("points") ?? "")
      .trim()
      .split(/\s+/)
      .map((p) => p.split(",").map(Number) as [number, number])
      .filter((p) => p.length === 2 && p.every(Number.isFinite))
      .map(([x, y]) => [num(String(x)), num(String(y))] as [number, number]);
    out.push({
      group: Number(m[1]),
      kind: m[2] as IoKind,
      left: num(attrs.get("left")),
      top: num(attrs.get("top")),
      width: num(attrs.get("width")),
      height: num(attrs.get("height")),
      rx: num(attrs.get("rx")),
      ry: num(attrs.get("ry")),
      points,
      hideAll: attrs.get("oi") === "1",
    });
  }
  return out;
}

const f = (n: number) => String(Math.round(n * 10000) / 10000).replace(/^0\./, ".");

export function serializeOcclusions(shapes: IoShape[]): string {
  return shapes
    .map((s) => {
      const oi = s.hideAll ? ":oi=1" : "";
      if (s.kind === "rect") return `{{c${s.group}::image-occlusion:rect:left=${f(s.left)}:top=${f(s.top)}:width=${f(s.width)}:height=${f(s.height)}${oi}}}`;
      if (s.kind === "ellipse") return `{{c${s.group}::image-occlusion:ellipse:left=${f(s.left)}:top=${f(s.top)}:rx=${f(s.rx)}:ry=${f(s.ry)}${oi}}}`;
      return `{{c${s.group}::image-occlusion:polygon:points=${s.points.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}${oi}}}`;
    })
    .join("\n");
}

const S = 1000; // SVG koordinat ölçeği

function shapeSvg(s: IoShape, cls: string): string {
  if (s.kind === "rect") return `<rect class="${cls}" x="${s.left * S}" y="${s.top * S}" width="${s.width * S}" height="${s.height * S}" rx="6"/>`;
  if (s.kind === "ellipse") return `<ellipse class="${cls}" cx="${s.left * S}" cy="${s.top * S}" rx="${s.rx * S}" ry="${s.ry * S}"/>`;
  return `<polygon class="${cls}" points="${s.points.map(([x, y]) => `${x * S},${y * S}`).join(" ")}"/>`;
}

/**
 * Kartın maske katmanı (SVG). ord1: aktif grup (c1 → 1).
 *  - Soru: aktif grup turuncu kapalı; "hepsini gizle" modunda diğerleri gri kapalı
 *  - Cevap: aktif grup açılır (sadece çerçeve); diğerleri soru tarafındaki gibi
 */
export function renderOcclusionSvg(text: string, ord1: number, side: "question" | "answer"): string {
  const shapes = parseOcclusions(text);
  if (!shapes.length) return "";
  const hideAll = shapes.some((s) => s.group === ord1 && s.hideAll);
  const parts: string[] = [];
  for (const s of shapes) {
    if (s.group === ord1) parts.push(shapeSvg(s, side === "question" ? "kk-io-active" : "kk-io-revealed"));
    else if (hideAll) parts.push(shapeSvg(s, "kk-io-other"));
  }
  return `<svg class="kk-io-mask" viewBox="0 0 ${S} ${S}" preserveAspectRatio="none" aria-hidden="true">${parts.join("")}</svg>`;
}

export const IO_CSS = `
.kk-io { position: relative; display: inline-block; max-width: 100%; line-height: 0; }
.kk-io img { display: block; max-width: 100%; height: auto; }
.kk-io-mask { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.kk-io-active { fill: #ff8e3c; stroke: #b4501d; stroke-width: 3; vector-effect: non-scaling-stroke; }
.kk-io-other { fill: #ffeba2; stroke: #8a7a3d; stroke-width: 2; vector-effect: non-scaling-stroke; }
.kk-io-revealed { fill: transparent; stroke: #e5484d; stroke-width: 3; vector-effect: non-scaling-stroke; }
.kk-io-header { margin-bottom: 10px; }
`;
