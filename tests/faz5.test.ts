// Faz 5: resim maskeleme, furigana, formüller
import { describe, expect, it } from "vitest";
import { cardOrdsForNote } from "@/lib/cards/generate";
import { parseOcclusions, renderOcclusionSvg, serializeOcclusions } from "@/lib/io";
import { hasMath, renderMath } from "@/lib/math";
import { BUILTIN_NOTE_TYPES } from "@/lib/notetypes/builtins";
import { renderCard } from "@/lib/template/render";

const io = BUILTIN_NOTE_TYPES.find((t) => t.key === "image-occlusion")!;
const ioType = { ...io, fields: io.fields.map((f) => ({ ...f })), word_field: null };
const OCC =
  "{{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.1:oi=1}}\n" +
  "{{c1::image-occlusion:ellipse:left=.5:top=.5:rx=.05:ry=.04:oi=1}}\n" +
  "{{c2::image-occlusion:polygon:points=.1,.1 .2,.1 .15,.3:oi=1}}";

describe("resim maskeleme", () => {
  it("Anki biçimini okur ve aynen yazar", () => {
    const shapes = parseOcclusions(OCC);
    expect(shapes.map((s) => [s.group, s.kind])).toEqual([[1, "rect"], [1, "ellipse"], [2, "polygon"]]);
    expect(shapes[2].points).toEqual([[0.1, 0.1], [0.2, 0.1], [0.15, 0.3]]);
    expect(serializeOcclusions(shapes)).toBe(OCC);
  });

  it("grup başına bir kart", () => {
    expect(cardOrdsForNote(ioType as never, { occlusion: OCC, image: "<img src=x>" })).toEqual([0, 1]);
    expect(cardOrdsForNote(ioType as never, { occlusion: "", image: "<img src=x>" })).toEqual([]);
  });

  it("soruda aktif grup kapalı, hepsini gizle modunda diğerleri de; cevapta aktif grup açılır", () => {
    const q = renderOcclusionSvg(OCC, 1, "question");
    expect(q.match(/kk-io-active/g)).toHaveLength(2);
    expect(q.match(/kk-io-other/g)).toHaveLength(1);
    const a = renderOcclusionSvg(OCC, 1, "answer");
    expect(a.match(/kk-io-revealed/g)).toHaveLength(2);
    const one = renderOcclusionSvg(OCC.replace(/:oi=1/g, ""), 2, "question");
    expect(one).not.toContain("kk-io-other"); // birini gizle modu
  });

  it("kart çizimi: resim + maske katmanı", () => {
    const r = renderCard({ noteType: ioType as never, note: { fields: { occlusion: OCC, image: '<img src="kk-media/a.png">', header: "Kalp" }, tags: [] }, cardOrd: 1, deckName: "D" });
    expect(r.question).toContain('<div class="kk-io"><img src="kk-media/a.png"><svg class="kk-io-mask"');
    expect(r.question).toContain("Kalp");
  });
});

describe("furigana ve formüller", () => {
  const nt = { name: "J", kind: "standard", fields: [{ id: "f", name: "F" }], css: "", templates: [{ name: "C", front: "{{furigana:F}}|{{kana:F}}|{{kanji:F}}", back: "" }] };
  it("furigana / kana / kanji filtreleri", () => {
    const r = renderCard({ noteType: nt, note: { fields: { f: "日本語[にほんご]を 話[はな]す" }, tags: [] }, cardOrd: 0, deckName: "D" });
    expect(r.question).toBe("<ruby><rb>日本語</rb><rt>にほんご</rt></ruby>を<ruby><rb>話</rb><rt>はな</rt></ruby>す|にほんごをはなす|日本語を話す");
  });

  it("\\( \\) ve \\[ \\] KaTeX ile çizilir", async () => {
    const html = "Alan: \\(x^2 + 1\\) ve \\[\\frac{a}{b}\\]";
    expect(hasMath(html)).toBe(true);
    const r = await renderMath(html);
    expect(r.html).toContain('class="katex"');
    expect(r.html).toContain("katex-display");
    expect(r.css).toContain("data:font/woff2;base64");
  });
});
