import { describe, expect, it } from "vitest";
import { clozeAnswers, clozeNumbers, renderCloze } from "@/lib/template/cloze";
import { parseTemplate } from "@/lib/template/parser";
import { type RenderInput, renderCard } from "@/lib/template/render";
import { compareTypedAnswer } from "@/lib/template/typeanswer";

function input(over: Partial<RenderInput> & { front?: string; back?: string; values?: Record<string, string> }): RenderInput {
  const names = Object.keys(over.values ?? { Front: "", Back: "" });
  return {
    noteType: {
      name: "Basic",
      kind: "standard",
      fields: names.map((n) => ({ id: `id-${n}`, name: n })),
      templates: [{ name: "Card 1", front: over.front ?? "{{Front}}", back: over.back ?? "{{FrontSide}}<hr id=answer>{{Back}}" }],
      css: ".card{}",
      word_field: null,
      ...over.noteType,
    },
    note: {
      fields: Object.fromEntries(Object.entries(over.values ?? {}).map(([k, v]) => [`id-${k}`, v])),
      tags: [],
      ...over.note,
    },
    cardOrd: over.cardOrd ?? 0,
    deckName: over.deckName ?? "YDS::Fiiller",
    flags: over.flags,
    examples: over.examples,
    chosenExampleId: over.chosenExampleId,
  };
}

describe("şablon ayrıştırıcı", () => {
  it("metin, alan, filtre ve koşulları ağaca çevirir", () => {
    expect(parseTemplate("a {{text:hint:Ön Yüz}} {{#X}}b{{/X}}")).toEqual([
      { type: "text", text: "a " },
      { type: "replacement", field: "Ön Yüz", filters: ["text", "hint"] },
      { type: "text", text: " " },
      { type: "conditional", field: "X", negated: false, children: [{ type: "text", text: "b" }] },
    ]);
  });

  it("kapatılmamış ve yanlış kapatılmış bölümler hata verir", () => {
    expect(() => parseTemplate("{{#A}}x")).toThrow();
    expect(() => parseTemplate("{{#A}}x{{/B}}")).toThrow();
    expect(() => parseTemplate("x{{/A}}")).toThrow();
  });
});

describe("temel çizim", () => {
  it("alanları yerleştirir, FrontSide cevapta soruyu gösterir", () => {
    const r = renderCard(input({ values: { Front: "abandon", Back: "terk etmek" } }));
    expect(r.question).toBe("abandon");
    expect(r.answer).toBe("abandon<hr id=answer>terk etmek");
  });

  it("{{#Alan}} doluysa, {{^Alan}} boşsa gösterir; <br> ve boşluk 'boş' sayılır", () => {
    const tpl = "{{#Back}}var{{/Back}}{{^Back}}yok{{/Back}}";
    expect(renderCard(input({ front: tpl, values: { Front: "x", Back: "y" } })).question).toBe("var");
    expect(renderCard(input({ front: tpl, values: { Front: "x", Back: " <br> <div></div>" } })).question).toBe("yok");
    expect(renderCard(input({ front: tpl, values: { Front: "x", Back: '<img src="a.png">' } })).question).toBe("var");
  });

  it("iç içe koşullar", () => {
    const tpl = "{{#A}}a{{#B}}b{{/B}}{{^B}}!b{{/B}}{{/A}}";
    expect(renderCard(input({ front: tpl, values: { A: "1", B: "" } })).question).toBe("a!b");
    expect(renderCard(input({ front: tpl, values: { A: "", B: "1" } })).question).toBe("");
  });

  it("text filtresi HTML'i temizler, hint tıklanabilir ipucu yapar", () => {
    expect(renderCard(input({ front: "{{text:Front}}", values: { Front: "<b>bold</b> &amp; x" } })).question).toBe("bold & x");
    const hint = renderCard(input({ front: "{{hint:Back}}", values: { Front: "", Back: "gizli" } })).question;
    expect(hint).toContain('class="hint"');
    expect(hint).toContain("gizli");
    expect(renderCard(input({ front: "{{hint:Back}}", values: { Front: "", Back: "" } })).question).toBe("");
  });

  it("özel alanlar: Tags, Deck, Subdeck, Card, CardFlag, Type", () => {
    const r = renderCard(
      input({
        front: "{{Tags}}|{{Deck}}|{{Subdeck}}|{{Card}}|{{CardFlag}}|{{Type}}",
        values: { Front: "" },
        note: { fields: {}, tags: ["yds", "fiil"] },
        flags: 3,
      }),
    );
    expect(r.question).toBe("yds fiil|YDS::Fiiller|Fiiller|Card 1|flag3|Basic");
  });

  it("alan adında büyük/küçük harf farkını tolere eder; bilinmeyen alanı belirtir", () => {
    expect(renderCard(input({ front: "{{front}}", values: { Front: "x" } })).question).toBe("x");
    expect(renderCard(input({ front: "{{Yok}}", values: { Front: "x" } })).question).toContain("Bilinmeyen alan: Yok");
  });

  it("şablon hatası kartı bozmaz, mesaj gösterir", () => {
    expect(renderCard(input({ front: "{{#Front}}x", values: { Front: "x" } })).question).toContain("Şablon hatası");
  });
});

describe("cloze", () => {
  const text = "The {{c1::cat}} sat on the {{c2::mat::yer}}. {{c1::Kedi}}";

  it("numaraları bulur", () => {
    expect([...clozeNumbers(text)].sort()).toEqual([1, 2]);
    expect([...clozeNumbers("{{c1,3::x}} {{c2::{{c4::y}}}}")].sort()).toEqual([1, 2, 3, 4]);
  });

  it("soru tarafında etkin olanı gizler, ipucunu gösterir, diğerlerini açık bırakır", () => {
    const q1 = renderCloze(text, 1, "question");
    expect(q1).toContain('<span class="cloze" data-cloze="cat" data-ordinal="1">[...]</span>');
    expect(q1).toContain('<span class="cloze-inactive" data-ordinal="2">mat</span>');
    expect(q1).not.toContain(">cat<");
    const q2 = renderCloze(text, 2, "question");
    expect(q2).toContain("[yer]");
    expect(q2).toContain(">cat</span>");
  });

  it("cevap tarafında etkin olanı vurgular", () => {
    expect(renderCloze(text, 1, "answer")).toContain('<span class="cloze" data-ordinal="1">cat</span>');
  });

  it("çoklu numara ve iç içe cloze", () => {
    expect(renderCloze("{{c1,2::x}}", 2, "question")).toContain("[...]");
    const nested = "{{c1::dış {{c2::iç}} son}}";
    expect(renderCloze(nested, 2, "question")).toContain('dış <span class="cloze" data-cloze="iç" data-ordinal="2">[...]</span> son');
    const outer = renderCloze(nested, 1, "question");
    expect(outer).toContain("[...]");
    expect(outer.replace(/data-cloze="[^"]*"/g, "")).not.toContain("dış"); // ekranda görünmez
  });

  it("cevabı yaz için gizli cevaplar", () => {
    expect(clozeAnswers(text, 1)).toBe("cat, Kedi");
    expect(clozeAnswers(text, 2)).toBe("mat");
  });

  it("cloze not tipinde kart numarası c1, c2'ye karşılık gelir", () => {
    const base = input({
      values: { Text: text, "Back Extra": "" },
      noteType: {
        name: "Cloze",
        kind: "cloze",
        fields: [
          { id: "id-Text", name: "Text" },
          { id: "id-Back Extra", name: "Back Extra" },
        ],
        templates: [{ name: "Cloze", front: "{{cloze:Text}}", back: "{{cloze:Text}}<br>{{Back Extra}}" }],
        css: "",
      },
    });
    expect(renderCard({ ...base, cardOrd: 1 }).question).toContain("[yer]");
    expect(renderCard({ ...base, cardOrd: 0 }).answer).toContain('<span class="cloze" data-ordinal="1">cat</span>');
  });
});

describe("cevabı yaz", () => {
  it("soruda giriş kutusu, cevapta karşılaştırma; FrontSide'da kutu olmaz", () => {
    const base = input({ front: "{{Front}} {{type:Back}}", back: "{{FrontSide}}<hr>{{type:Back}}", values: { Front: "abandon", Back: "<b>terk</b> etmek" } });
    const r = renderCard(base, { typed: "terk etmek" });
    expect(r.question).toContain('id="typeans"');
    expect(r.typeAnswer).toEqual({ expected: "terk etmek" });
    expect(r.answer).not.toContain("<input");
    expect(r.answer).toContain('class="typeGood">terk etmek<');
  });

  it("yanlış yazımda renkli fark", () => {
    const html = compareTypedAnswer("abandon", "abondan");
    expect(html).toContain("typeBad");
    expect(html).toContain("typeMissed");
    expect(html).toContain("typearrow");
    expect(compareTypedAnswer("x", "")).toContain("typeMissed");
  });

  it("type:cloze gizli kısmı bekler", () => {
    const r = renderCard(
      input({
        values: { Text: "I {{c1::gave up}} smoking", Extra: "" },
        noteType: {
          name: "Cloze",
          kind: "cloze",
          fields: [{ id: "id-Text", name: "Text" }, { id: "id-Extra", name: "Extra" }],
          templates: [{ name: "Cloze", front: "{{cloze:Text}}{{type:cloze:Text}}", back: "{{cloze:Text}}{{type:cloze:Text}}" }],
          css: "",
        },
      }),
      { typed: "gave up" },
    );
    expect(r.typeAnswer).toEqual({ expected: "gave up" });
    expect(r.answer).toContain("typeGood");
  });
});

describe("örnek cümleler ({{Example}} / {{Examples}})", () => {
  const examples = [
    { id: "e1", text: "They abandoned the car.", translation: "Arabayı terk ettiler." },
    { id: "e2", text: "Never abandon hope.", translation: null },
    { id: "e3", text: "The plan was abandoned.", translation: "Plan bırakıldı." },
  ];
  const base = input({
    front: "{{Front}}{{#Example}}<p>{{Example}}</p>{{/Example}}",
    back: "{{FrontSide}}<hr>{{Back}}",
    values: { Front: "abandon", Back: "terk etmek" },
    examples,
    chosenExampleId: "e2",
  });
  base.noteType.word_field = "id-Front";

  it("soruda seçilen cümle (çevirisiz), kelime kalın", () => {
    const r = renderCard(base);
    expect(r.question).toContain('Never <b class="kk-hl">abandon</b> hope.');
    expect(r.question).not.toContain("terk ettiler");
    expect(r.question).not.toContain("Diğer örnekleri");
  });

  it("cevapta 'Diğer örnekleri göster' aç/kapa ve çeviriler", () => {
    const r = renderCard({ ...base, noteType: { ...base.noteType, templates: [{ name: "c", front: "{{Front}}", back: "{{Example}}" }] } });
    expect(r.answer).toContain("<details");
    expect(r.answer).toContain("Diğer örnekleri göster (2)");
    expect(r.answer).toContain("Arabayı terk ettiler.");
    expect(r.answer).toContain('They <b class="kk-hl">abandoned</b> the car.');
  });

  it("{{Examples}} hepsini listeler; örnek yoksa koşul boş", () => {
    const all = renderCard({ ...base, noteType: { ...base.noteType, templates: [{ name: "c", front: "{{Examples}}", back: "" }] } });
    expect(all.question.match(/<li>/g)).toHaveLength(3);
    const none = renderCard({ ...base, examples: [] });
    expect(none.question).toBe("abandon");
  });

  it("not tipinde 'Example' adında gerçek bir alan varsa o kullanılır", () => {
    const r = renderCard(input({ front: "{{Example}}", values: { Example: "alan içeriği" }, examples }));
    expect(r.question).toBe("alan içeriği");
  });
});
