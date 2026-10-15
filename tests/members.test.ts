import { describe, expect, it } from "vitest";
import { findMember, normalizeName } from "@/lib/server/members";

describe("isimle giriş", () => {
  it("Türkçe karakterleri ve büyük/küçük harfi tolere eder", () => {
    expect(normalizeName("  ÖMERHAN ")).toBe("omerhan");
    expect(normalizeName("İsa")).toBe("isa");
    expect(normalizeName("ISA")).toBe("isa");
    expect(normalizeName("YILMAZ")).toBe("yilmaz");
    expect(normalizeName("yılmaz")).toBe("yilmaz");
  });

  it("listedeki herkes farklı yazımlarla bulunur", () => {
    for (const input of ["Bilal", "bilal efe", "EMRE", "isa", "İSA", "Yilmaz", "arda", "Omerhan", "ömerhan"]) {
      expect(findMember(input), input).not.toBeNull();
    }
    expect(findMember("Ömerhan")?.displayName).toBe("Ömerhan");
    expect(findMember("Bilal")?.role).toBe("admin");
    expect(findMember("Emre")?.role).toBe("user");
  });

  it("listede olmayan adlar reddedilir", () => {
    for (const input of ["", "   ", "Ahmet", "bil", "emree", "admin"]) {
      expect(findMember(input), input).toBeNull();
    }
  });
});
