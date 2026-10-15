import { describe, expect, it } from "vitest";
import { compareHlc, formatHlc, HybridClock, parseHlc } from "@/lib/sync/hlc";

describe("HLC (hybrid logical clock)", () => {
  it("biçim sabit uzunlukta ve metin olarak doğru sıralanıyor", () => {
    const a = formatHlc({ wall: 9, counter: 2, node: "aaaaaaaaaaaaaaaa" });
    const b = formatHlc({ wall: 10, counter: 0, node: "aaaaaaaaaaaaaaaa" });
    expect(a.length).toBe(b.length);
    expect(compareHlc(a, b)).toBe(-1);
    expect(parseHlc(b)).toEqual({ wall: 10, counter: 0, node: "aaaaaaaaaaaaaaaa" });
  });

  it("saat geri gitse bile damgalar hep artar", () => {
    let t = 1000;
    const clock = new HybridClock("aaaaaaaaaaaaaaaa", null, () => t);
    const first = clock.tick();
    t = 500; // saat geri alındı
    const second = clock.tick();
    const third = clock.tick();
    expect(second > first).toBe(true);
    expect(third > second).toBe(true);
  });

  it("uzak damgayı gördükten sonra üretilen damga ondan büyük olur (saat geride olsa bile)", () => {
    const remote = new HybridClock("bbbbbbbbbbbbbbbb", null, () => 10_000).tick();
    const local = new HybridClock("aaaaaaaaaaaaaaaa", null, () => 5_000); // 5 sn geride
    local.receive(remote);
    expect(local.tick() > remote).toBe(true);
  });

  it("kaldığı damgadan devam eder (uygulama yeniden açılınca)", () => {
    const c1 = new HybridClock("aaaaaaaaaaaaaaaa", null, () => 2_000);
    const last = c1.tick();
    const c2 = new HybridClock("aaaaaaaaaaaaaaaa", last, () => 1_000);
    expect(c2.tick() > last).toBe(true);
  });

  it("farklı cihazların aynı andaki damgaları cihaz kimliğiyle ayrışır", () => {
    const a = new HybridClock("aaaaaaaaaaaaaaaa", null, () => 1).tick();
    const b = new HybridClock("bbbbbbbbbbbbbbbb", null, () => 1).tick();
    expect(a).not.toBe(b);
    expect(compareHlc(a, b)).toBe(-1);
  });
});
