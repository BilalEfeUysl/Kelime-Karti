// Kart HTML'indeki "kk-media/<sha256>.<uzantı>" resim yollarını gösterilebilir
// adreslere (data: URL) çevirir. Resim önce cihazdan, yoksa sunucudan okunur
// ve cihazda saklanır; sonraki gösterimler internetsiz çalışır.
//
// Not: Kartlar kum havuzlu (sandbox) iframe'de çizildiği için blob: adresleri
// her tarayıcıda çalışmaz; data: URL her yerde çalışır.
import type { LocalDB } from "@/lib/db/database";
import { getMediaData } from "@/lib/sync/media";
import type { MediaTransport } from "@/lib/sync/transport";

const MEDIA_RE = /kk-media\/([0-9a-f]{64})\.([a-z0-9]+)/g;
const MAX_CACHE_CHARS = 40_000_000; // ~30 MB resim önbelleği
const cache = new Map<string, string>();
let cacheSize = 0;

function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function mediaDataUrl(db: LocalDB, hash: string, transport: MediaTransport | null): Promise<string | null> {
  const hit = cache.get(hash);
  if (hit) {
    cache.delete(hash); // en son kullanılan sona
    cache.set(hash, hit);
    return hit;
  }
  try {
    const media = await getMediaData(db, hash, transport);
    if (!media) return null;
    const url = `data:${media.mime};base64,${toBase64(media.data)}`;
    cache.set(hash, url);
    cacheSize += url.length;
    while (cacheSize > MAX_CACHE_CHARS && cache.size > 1) {
      const [oldest, value] = cache.entries().next().value as [string, string];
      cache.delete(oldest);
      cacheSize -= value.length;
    }
    return url;
  } catch {
    return null; // internetsiz ve cihazda yok
  }
}

/** HTML içindeki tüm resim yollarını çözer (bulunamayanlar olduğu gibi kalır) */
export async function resolveMediaInHtml(html: string, db: LocalDB, transport: MediaTransport | null): Promise<string> {
  const hashes = new Set([...html.matchAll(MEDIA_RE)].map((m) => m[1]));
  if (!hashes.size) return html;
  const urls = new Map<string, string>();
  await Promise.all(
    [...hashes].map(async (h) => {
      const url = await mediaDataUrl(db, h, transport);
      if (url) urls.set(h, url);
    }),
  );
  return html.replace(MEDIA_RE, (m, h: string) => urls.get(h) ?? m);
}
