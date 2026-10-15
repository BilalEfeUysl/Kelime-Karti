// Metin/HTML yardımcıları (tarayıcıya ihtiyaç duymaz; testlerde de çalışır).

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** &amp; &lt; &#39; &#x27; gibi HTML karakter kodlarını çözer. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** HTML etiketlerini atıp düz metin bırakır (sıralama, arama, {{text:}} için). */
export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(div|p|li)>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Anki'deki gibi: alan sadece boşluk, <br> ve <div> içeriyorsa "boş" sayılır.
 *  (Sadece resim içeren alan boş DEĞİLDİR.) */
export function fieldIsEmpty(html: string | undefined | null): boolean {
  if (!html) return true;
  return /^(?:\s|&nbsp;|​|<\/?(?:br|div)\s*\/?>)*$/i.test(html);
}

/** Etiket listesini düzenler: boşlukla ayrılmış, tekrarsız (büyük/küçük harf duyarsız). */
export function normalizeTags(input: string | string[]): string[] {
  const parts = (Array.isArray(input) ? input : input.split(/\s+/)).flatMap((t) => t.split(/\s+/));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const tag = raw.trim();
    if (!tag) continue;
    const key = tag.toLocaleLowerCase("tr");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Kısa rastgele kimlik (alan/şablon kimlikleri için) */
export function shortId(length = 8): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Anki'deki gibi 10 karakterlik not GUID'i */
export function newGuid(): string {
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
