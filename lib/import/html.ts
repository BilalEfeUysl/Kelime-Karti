// İçe aktarılan HTML'i uygulamaya uyarlama:
//  - Resim yolları ("kedi.png") → uygulamanın resim sistemi ("kk-media/<sha256>.png")
//  - Ses ve video: [sound:…] etiketleri, <audio>, <video> öğeleri temizlenir
import { decodeEntities } from "@/lib/text";

export const MEDIA_PREFIX = "kk-media/";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);
const SOUND_EXT = new Set([
  "mp3", "ogg", "oga", "wav", "m4a", "flac", "opus", "aac", "spx", "amr",
  "mp4", "webm", "mov", "mkv", "avi", "3gp", "mpg", "mpeg", "ogv", "m4v",
]);

export function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}
export const isImageFile = (name: string) => IMAGE_EXT.has(fileExt(name));
export const isSoundOrVideoFile = (name: string) => SOUND_EXT.has(fileExt(name));

export function mimeForImage(name: string): string {
  const ext = fileExt(name);
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "svg") return "image/svg+xml";
  return `image/${ext}`;
}

/** Ses/video etiketlerini temizler; kaç tane temizlendiğini döndürür */
export function stripSoundAndVideo(html: string): { html: string; removed: number } {
  let removed = 0;
  const count = () => {
    removed++;
    return "";
  };
  const out = html
    .replace(/\[sound:[^\]]*\]/gi, count)
    .replace(/<(audio|video)\b[\s\S]*?<\/\1\s*>/gi, count)
    .replace(/<(audio|video)\b[^>]*\/?>/gi, count);
  return { html: out, removed };
}

/** <img src="ad"> içindeki adları eşleme tablosuna göre değiştirir */
export function rewriteImageSources(html: string, map: Map<string, string>): string {
  if (!map.size || !/<img/i.test(html)) return html;
  const resolve = (raw: string): string | undefined => {
    const name = decodeEntities(raw);
    if (map.has(name)) return map.get(name);
    try {
      return map.get(decodeURIComponent(name));
    } catch {
      return undefined;
    }
  };
  return html.replace(/<img\b[^>]*>/gi, (tag) =>
    tag.replace(/(\bsrc\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i, (m, pre: string, dq?: string, sq?: string, uq?: string) => {
      const target = resolve(dq ?? sq ?? uq ?? "");
      return target ? `${pre}"${target}"` : m;
    }),
  );
}
