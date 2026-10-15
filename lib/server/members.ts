// Uygulamaya girebilecek kişiler. SADECE SUNUCUDA kullanılır; bu liste
// tarayıcıya hiç gönderilmez ve sitede hiçbir yerde gösterilmez.
//
// Yeni bir arkadaş eklemek için listeye bir satır ekle ve yeniden yayınla.
// Birini çıkarmak için satırını sil (ya da Yönetim sayfasından devre dışı bırak).

export interface Member {
  slug: string; // giriş için kullanılan sade ad (küçük harf, Türkçe karaktersiz)
  displayName: string;
  role: "admin" | "user";
}

export const MEMBERS: Member[] = [
  { slug: "bilal", displayName: "Bilal", role: "admin" },
  { slug: "emre", displayName: "Emre", role: "user" },
  { slug: "isa", displayName: "İsa", role: "user" },
  { slug: "yilmaz", displayName: "Yılmaz", role: "user" },
  { slug: "arda", displayName: "Arda", role: "user" },
  { slug: "omerhan", displayName: "Ömerhan", role: "user" },
];

// Hesapların arka plandaki (görünmeyen) e-posta adresi. Bu adreslere hiç
// e-posta gönderilmez; sadece Supabase Auth bir e-posta istediği için var.
const EMAIL_DOMAIN = "kelime-karti.app";

export function memberEmail(member: Member): string {
  return `${member.slug}@${EMAIL_DOMAIN}`;
}

const TR_MAP: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

/** "  ÖMERHAN " → "omerhan", "İsa" → "isa", "YILMAZ" → "yilmaz" */
export function normalizeName(input: string): string {
  return input
    .trim()
    .toLocaleLowerCase("tr")
    .normalize("NFC")
    .replace(/[çğıöşüâîû]/g, (ch) => TR_MAP[ch] ?? ch)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // kalan şapka/nokta işaretleri
    .replace(/\s+/g, " ");
}

/** Yazılan ada karşılık gelen kişiyi bulur. "Bilal Efe" gibi tam ad da kabul edilir (ilk kelime). */
export function findMember(input: string): Member | null {
  const name = normalizeName(input);
  if (!name) return null;
  return (
    MEMBERS.find((m) => m.slug === name) ?? MEMBERS.find((m) => m.slug === name.split(" ")[0]) ?? null
  );
}
