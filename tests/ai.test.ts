// Gemini: anahtar şifreleme ve cevap doğrulama (gerçek Gemini çağrılmaz)
import { describe, expect, it } from "vitest";
import { parseBatch, parseExplanation, sentenceHasWord } from "@/lib/ai/prompts";
import { decryptSecret, encryptSecret } from "@/lib/server/ai/crypto";
import { quotaDay } from "@/lib/server/ai/gemini";

describe("anahtar şifreleme", () => {
  it("şifreler/çözer; her seferinde farklı çıktı; yanlış sır ile açılmaz", () => {
    process.env.GEMINI_KEY_SECRET = "test-sırrı-en-az-16-karakter";
    const a = encryptSecret("AIzaSyTEST1234567890");
    expect(a).not.toContain("AIza");
    expect(encryptSecret("AIzaSyTEST1234567890")).not.toBe(a);
    expect(decryptSecret(a)).toBe("AIzaSyTEST1234567890");
    process.env.GEMINI_KEY_SECRET = "başka-bir-sır-1234567";
    expect(() => decryptSecret(a)).toThrow();
  });
});

describe("Gemini cevabını doğrulama", () => {
  const words = [
    { id: "n1", word: "abandon" },
    { id: "n2", word: "acquire" },
    { id: "n3", word: "take off" },
  ];
  const opts = { count: 2, level: "B1", translate: true };

  it("geçerli cümleleri alır; kelimeyi içermeyen/boş/tekrar/fazla cümleyi atar; bilinmeyen id'yi yok sayar", () => {
    const raw = JSON.stringify({
      items: [
        { id: "n1", sentences: [{ en: "They abandoned the old car.", tr: "Eski arabayı terk ettiler." }, { en: "Nothing here matches.", tr: "x" }, { en: "They abandoned the old car.", tr: "tekrar" }, { en: "She abandons hope.", tr: "Umudunu yitirir." }, { en: "He abandoned it again.", tr: "fazla" }] },
        { id: "zz", sentences: [{ en: "abandon ship now", tr: "" }] },
        { id: "n3", sentences: [{ en: "The plane will take off soon.", tr: "Uçak birazdan kalkacak." }] },
      ],
    });
    const { results, missing } = parseBatch(raw, words, opts);
    expect(results.get("n1")!.map((s) => s.en)).toEqual(["They abandoned the old car.", "She abandons hope."]);
    expect(results.get("n3")).toHaveLength(1);
    expect(results.has("zz")).toBe(false);
    expect(missing).toEqual(["n2"]);
  });

  it("bozuk JSON'da hepsi eksik sayılır; ```json bloğu içindeki JSON okunur", () => {
    expect(parseBatch("tamam işte cümleler", words, opts).missing).toHaveLength(3);
    const wrapped = '```json\n{"items":[{"id":"n2","sentences":[{"en":"She acquired a skill.","tr":"Beceri edindi."}]}]}\n```';
    expect(parseBatch(wrapped, words, opts).results.get("n2")).toHaveLength(1);
  });

  it("çeviri istenmediyse tr boş kalır", () => {
    const raw = JSON.stringify({ items: [{ id: "n2", sentences: [{ en: "We acquired land.", tr: "Arazi aldık." }] }] });
    expect(parseBatch(raw, words, { ...opts, translate: false }).results.get("n2")![0].tr).toBe("");
  });

  it("açıklama: alanlar temizlenir, anlamı yoksa reddedilir", () => {
    const e = parseExplanation(
      JSON.stringify({ word: "abandon", partOfSpeech: "fiil", meaningsTr: ["terk etmek", "terk etmek", " bırakmak "], definitionEn: "to leave", examples: [{ en: "They abandoned the plan.", tr: "Planı bıraktılar." }], synonyms: ["desert"], antonyms: [], collocations: ["abandon hope"], ydsNote: "Sık çıkar." }),
      "abandon",
    )!;
    expect(e.meaningsTr).toEqual(["terk etmek", "bırakmak"]);
    expect(e.examples).toHaveLength(1);
    expect(parseExplanation(JSON.stringify({ word: "x" }), "x")).toBeNull();
  });

  it("kelime kontrolü çekimleri kabul eder", () => {
    expect(sentenceHasWord("Prices have risen sharply.", "rise")).toBe(true);
    expect(sentenceHasWord("They were acquiring land.", "acquire")).toBe(true);
    expect(sentenceHasWord("Completely unrelated.", "acquire")).toBe(false);
  });

  it("kota günü Pasifik saatine göre", () => {
    // 15 Ekim 2026 08:00 UTC = Pasifik'te hâlâ 15 Ekim 01:00; 06:00 UTC = 14 Ekim 23:00
    expect(quotaDay(new Date(Date.UTC(2026, 9, 15, 8)))).toBe("2026-10-15");
    expect(quotaDay(new Date(Date.UTC(2026, 9, 15, 6)))).toBe("2026-10-14");
  });
});
