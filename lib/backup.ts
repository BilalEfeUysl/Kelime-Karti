// YEDEK: tüm verinin (desteler, notlar, kartlar, cevap geçmişi, ayarlar; istenirse
// resimler) sıkıştırılmış JSON kopyası.
//   - "Şimdi yedekle": dosya olarak indirilir
//   - Haftalık otomatik yedek: sunucuya ("backups" deposu), en fazla son 3 tane
//   - Geri yükle: yedekteki kayıtlar yeni değişiklik olarak yazılır ve eşlenir
import { gunzipSync, gzipSync } from "fflate";
import type { LocalDB } from "@/lib/db/database";
import { getSetting, insertRows, setSetting, updateRows } from "@/lib/db/mutations";
import type { BaseRow, TableRowMap } from "@/lib/db/types";
import { getSupabase } from "@/lib/supabase/client";
import { addMediaFile } from "@/lib/sync/media";

const TABLES = ["deck_configs", "decks", "note_types", "notes", "note_examples", "cards", "review_logs", "app_settings"] as const;
type BackupTable = (typeof TABLES)[number];

export interface BackupFile {
  app: "kelime-karti";
  version: 1;
  createdAt: number;
  userId: string;
  tables: { [T in BackupTable]: TableRowMap[T][] };
  media?: { hash: string; mime: string; name: string; data: string }[]; // base64
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Yedek dosyası oluşturur (gzip'li JSON). Silinmiş kayıtlar dahil edilmez. */
export async function createBackup(db: LocalDB, opts: { includeMedia: boolean }): Promise<{ bytes: Uint8Array; summary: Record<string, number> }> {
  const tables = {} as BackupFile["tables"];
  const summary: Record<string, number> = {};
  for (const t of TABLES) {
    const rows = ((await db.syncTable(t).toArray()) as BaseRow[]).filter((r) => r.deleted_at === null).map((r) => {
      const { server_seq: _s, ...rest } = r;
      void _s;
      return rest;
    });
    (tables as Record<string, unknown[]>)[t] = rows;
    summary[t] = rows.length;
  }
  const file: BackupFile = { app: "kelime-karti", version: 1, createdAt: db.now(), userId: db.userId, tables };
  if (opts.includeMedia) {
    const media = (await db.media.toArray()).filter((m) => m.deleted_at === null);
    file.media = [];
    for (const m of media) {
      const blob = await db.media_blobs.get(m.hash);
      if (blob) file.media.push({ hash: m.hash, mime: m.mime, name: m.filename, data: toBase64(new Uint8Array(blob.data)) });
    }
    summary.media = file.media.length;
  }
  return { bytes: gzipSync(new TextEncoder().encode(JSON.stringify(file)), { level: 6 }), summary };
}

export function readBackup(bytes: Uint8Array): BackupFile {
  let json: string;
  try {
    json = new TextDecoder().decode(bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes);
  } catch {
    throw new Error("Dosya açılamadı: yedek dosyası değil ya da bozuk.");
  }
  const file = JSON.parse(json) as BackupFile;
  if (file?.app !== "kelime-karti" || file.version !== 1 || !file.tables) throw new Error("Bu bir Kelime Kartı yedeği değil.");
  return file;
}

/**
 * Yedeği geri yükler: cihazda olmayan kayıtlar eklenir, farklı olanlar
 * yedekteki hâline döndürülür (cevap geçmişinde sadece eksikler eklenir).
 * Yedekte olmayan yeni kayıtlar silinmez.
 */
export async function restoreBackup(db: LocalDB, file: BackupFile, onProgress?: (label: string) => void): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const t of TABLES) {
    onProgress?.(t);
    const rows = (file.tables[t] ?? []) as BaseRow[];
    const existing = await db.syncTable(t).bulkGet(rows.map((r) => r.id));
    const toInsert: BaseRow[] = [];
    const toUpdate: { id: string; patch: Record<string, unknown> }[] = [];
    rows.forEach((r, i) => {
      const cur = existing[i] as BaseRow | undefined;
      const { id: _id, user_id: _u, updated_at: _up, created_at: _c, ...data } = r as BaseRow & Record<string, unknown>;
      void _id;
      void _u;
      void _up;
      void _c;
      if (!cur) toInsert.push({ ...r, user_id: db.userId });
      else if (t !== "review_logs") {
        const differs = Object.entries(data).some(([k, v]) => k !== "sched_updated_at" && JSON.stringify((cur as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v));
        if (differs) toUpdate.push({ id: r.id, patch: { ...data, deleted_at: null } });
      }
    });
    for (let i = 0; i < toInsert.length; i += 500) await insertRows(db, t, toInsert.slice(i, i + 500) as never[]);
    for (let i = 0; i < toUpdate.length; i += 500) await updateRows(db, t, toUpdate.slice(i, i + 500) as never[]);
    result[t] = toInsert.length + toUpdate.length;
  }
  if (file.media?.length) {
    onProgress?.("media");
    let n = 0;
    for (const m of file.media) {
      if (await db.media_blobs.get(m.hash)) continue;
      const bytes = fromBase64(m.data);
      await addMediaFile(db, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, m.name, m.mime);
      n++;
    }
    result.media = n;
  }
  return result;
}

// ------------------------------------------------------------ otomatik yedek

export const AUTO_BACKUP_SETTING = "autoBackup";
const WEEK = 7 * 86_400_000;
const KEEP = 3;
const BUCKET = "backups";

export interface AutoBackupState {
  enabled: boolean;
  lastAt: number | null;
}

export async function listServerBackups(userId: string): Promise<{ name: string; created: string; size: number }[]> {
  const { data, error } = await getSupabase().storage.from(BUCKET).list(userId, { sortBy: { column: "name", order: "desc" } });
  if (error) throw new Error(error.message);
  return (data ?? []).map((f) => ({ name: f.name, created: f.created_at ?? "", size: Number(f.metadata?.size ?? 0) }));
}

/** Sunucuya yedek yükler ve en yeni 3'ü dışındakileri siler */
export async function uploadServerBackup(db: LocalDB): Promise<string> {
  const { bytes } = await createBackup(db, { includeMedia: false }); // resimler zaten sunucuda
  const name = `${new Date(db.now()).toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json.gz`;
  const sb = getSupabase();
  const { error } = await sb.storage.from(BUCKET).upload(`${db.userId}/${name}`, new Blob([bytes as BlobPart], { type: "application/gzip" }), { contentType: "application/gzip", upsert: true });
  if (error) throw new Error(error.message);
  const all = await listServerBackups(db.userId);
  const old = all.slice(KEEP).map((f) => `${db.userId}/${f.name}`);
  if (old.length) await sb.storage.from(BUCKET).remove(old);
  const state = await getSetting<AutoBackupState>(db, AUTO_BACKUP_SETTING, { enabled: true, lastAt: null });
  await setSetting(db, AUTO_BACKUP_SETTING, { ...state, lastAt: db.now() });
  return name;
}

export async function downloadServerBackup(userId: string, name: string): Promise<Uint8Array> {
  const { data, error } = await getSupabase().storage.from(BUCKET).download(`${userId}/${name}`);
  if (error || !data) throw new Error(error?.message ?? "İndirilemedi");
  return new Uint8Array(await data.arrayBuffer());
}

/** Açık ve 7 günden eskiyse otomatik yedek al (sessizce; hata olursa sonra tekrar dener) */
export async function maybeAutoBackup(db: LocalDB): Promise<boolean> {
  const state = await getSetting<AutoBackupState>(db, AUTO_BACKUP_SETTING, { enabled: true, lastAt: null });
  if (!state.enabled) return false;
  if (state.lastAt && db.now() - state.lastAt < WEEK) return false;
  await uploadServerBackup(db);
  return true;
}
