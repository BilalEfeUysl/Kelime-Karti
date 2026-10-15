// Kullanıcıların Gemini anahtarlarını şifreler / çözer (sadece sunucuda).
// AES-256-GCM; şifreleme anahtarı GEMINI_KEY_SECRET ortam değişkeninden türetilir.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function secretKey(): Buffer {
  const secret = process.env.GEMINI_KEY_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("Sunucu ayarı eksik: GEMINI_KEY_SECRET (en az 16 karakter) tanımlı değil.");
  }
  return createHash("sha256").update(secret).digest();
}

/** Düz metni şifreler → base64(iv | tag | şifreli) */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
