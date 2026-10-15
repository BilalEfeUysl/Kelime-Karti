// Resimler: içerik SHA-256 ile tanımlanır. Aynı resim kullanıcı başına bir
// kez saklanır (media satırının id'si hash'ten türetilir, iki cihaz aynı
// resmi internetsizken eklese bile tek satır olur).
//
// Akış:
//  1) addMediaFile: resim cihazda media_blobs tablosuna yazılır
//     (pending_upload=1) ve bir media satırı eklenir (uploaded_at=null).
//  2) uploadPendingMedia (senkron sırasında): bekleyen resimler Storage'a
//     yüklenir, media satırına uploaded_at yazılır (o da eşlenir).
//  3) getMediaData: önce cihaza bakılır; yoksa ve yüklenmişse Storage'dan
//     indirilip cihazda saklanır (sonraki gösterimler internetsiz çalışır).
import type { LocalDB } from "@/lib/db/database";
import { deterministicId, insertRow, updateRow } from "@/lib/db/mutations";
import type { MediaRow } from "@/lib/db/types";
import { type MediaTransport, toSyncError } from "./transport";

/** Sunucudaki resim kovasının (bucket) sınırı ile aynı: 10 MB */
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

/** Resim eklenemiyorsa nedenini söyleyen hata (çok büyük / resim değil) */
export class MediaRejectedError extends Error {}

export function checkMedia(size: number, mime: string): void {
  if (!mime.startsWith("image/")) throw new MediaRejectedError("Sadece resim eklenebilir.");
  if (size > MAX_MEDIA_BYTES) {
    throw new MediaRejectedError(`Resim çok büyük (${(size / 1024 / 1024).toFixed(1)} MB). En fazla 10 MB olabilir.`);
  }
}

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/bmp": "bmp",
};

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function extensionFor(mime: string, filename = ""): string {
  const fromName = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  return MIME_EXT[mime] ?? (fromName || "bin");
}

export function mediaIdFor(hash: string, userId: string): string {
  return deterministicId(`media:${hash}`, userId);
}

/** Yeni bir resmi cihaza ekler (aynısı varsa var olanı döndürür). */
export async function addMediaFile(
  db: LocalDB,
  data: ArrayBuffer,
  filename: string,
  mime: string,
): Promise<MediaRow> {
  checkMedia(data.byteLength, mime);
  const hash = await sha256Hex(data);
  const id = mediaIdFor(hash, db.userId);
  const existing = await db.media.get(id);

  if (!(await db.media_blobs.get(hash))) {
    await db.media_blobs.put({
      hash,
      data,
      mime,
      size: data.byteLength,
      pending_upload: existing?.uploaded_at ? 0 : 1,
      added_at: db.now(),
    });
  }

  if (existing && existing.deleted_at === null) return existing;
  if (existing) return (await updateRow(db, "media", id, { deleted_at: null }))!;
  return insertRow(db, "media", {
    id,
    hash,
    filename,
    mime,
    size: data.byteLength,
    storage_path: `${db.userId}/${hash}.${extensionFor(mime, filename)}`,
    uploaded_at: null,
  });
}

/** Yüklenmeyi bekleyen resimleri Storage'a gönderir. Yüklenen sayısını döndürür. */
export async function uploadPendingMedia(
  db: LocalDB,
  transport: MediaTransport,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const pending = await db.media_blobs.where("pending_upload").equals(1).toArray();
  let done = 0;
  for (const blob of pending) {
    const row = await db.media.get(mediaIdFor(blob.hash, db.userId));
    if (!row) continue; // satırı olmayan içerik (ör. silinmiş) — yükleme
    if (!row.uploaded_at) {
      const path = row.storage_path ?? `${db.userId}/${blob.hash}.${extensionFor(blob.mime)}`;
      try {
        checkMedia(blob.size, blob.mime);
        await transport.upload(path, blob.data, blob.mime);
      } catch (err) {
        // İnternet/oturum sorunu: eşlemeyi durdur (sonra tekrar denenir).
        // Diğer hatalar (çok büyük, reddedildi…): bu resmi atla ama notların
        // ve cevapların gönderilmesini ENGELLEME.
        const e = err instanceof MediaRejectedError ? null : toSyncError(err);
        if (e && (e.kind === "offline" || e.kind === "auth")) throw e;
        if (!e || isPermanentUploadError(err)) await db.media_blobs.update(blob.hash, { pending_upload: 0 });
        console.warn("Resim yüklenemedi:", blob.hash, err);
        continue;
      }
      await updateRow(db, "media", row.id, { uploaded_at: db.now(), storage_path: path });
    }
    await db.media_blobs.update(blob.hash, { pending_upload: 0 });
    done += 1;
    onProgress?.(done, pending.length);
  }
  return done;
}

/** Tekrar denemenin anlamsız olduğu yükleme hataları (boyut, dosya türü) */
function isPermanentUploadError(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: string | number; message?: string } | null;
  const status = Number(e?.status ?? e?.statusCode ?? 0);
  return status === 413 || status === 415 || /too large|exceeded|maximum allowed size|mime type/i.test(e?.message ?? "");
}

/** Resim içeriğini getirir: önce cihazdan, yoksa Storage'dan (ve cihaza kaydeder). */
export async function getMediaData(
  db: LocalDB,
  hash: string,
  transport: MediaTransport | null,
): Promise<{ data: ArrayBuffer; mime: string } | null> {
  const local = await db.media_blobs.get(hash);
  if (local) return { data: local.data, mime: local.mime };
  const row = await db.media.get(mediaIdFor(hash, db.userId));
  if (!row || !row.uploaded_at || !row.storage_path || !transport) return null;
  const data = await transport.download(row.storage_path);
  await db.media_blobs.put({
    hash,
    data,
    mime: row.mime,
    size: data.byteLength,
    pending_upload: 0,
    added_at: db.now(),
  });
  return { data, mime: row.mime };
}
