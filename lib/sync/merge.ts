// Çakışma kuralları — sunucudaki private.apply_change ile AYNI mantık.
// Pull sırasında sunucudan gelen satırı cihazdaki satırla birleştirmek için
// kullanılır. Saf fonksiyondur (veritabanına dokunmaz), kolayca test edilir.
import type { BaseRow } from "@/lib/db/types";
import { APPEND_ONLY_TABLES, CARD_SCHED_FIELDS, type SyncTable } from "./tables";

const NEVER_COPIED = new Set(["id", "user_id", "created_at", "server_seq"]);
const CARD_SCHED_KEYS = new Set<string>([...CARD_SCHED_FIELDS, "sched_updated_at"]);

export interface MergeResult<R> {
  row: R;
  /** Yerel satır değişti mi (yazılması gerekiyor mu)? */
  changed: boolean;
}

/**
 * Yerel satır (local) ile uzaktan gelen satırı (remote) birleştirir.
 *  - Yerelde yoksa: uzaktaki alınır.
 *  - review_logs: sadece eklenir; içerik değişmez (sadece "geri al" işareti eşlenir).
 *  - Diğerleri: updated_at (HLC) daha yeni olan kazanır.
 *  - cards: zamanlama alanları sched_updated_at'e, diğerleri updated_at'e göre
 *    ayrı ayrı karşılaştırılır. Böylece bir cihazda çalışılan, diğerinde
 *    destesi değiştirilen kartta iki değişiklik de korunur.
 */
export function mergeRow<R extends BaseRow>(
  table: SyncTable,
  local: R | undefined,
  remote: R,
): MergeResult<R> {
  if (!local) return { row: { ...remote }, changed: true };
  if (APPEND_ONLY_TABLES.has(table)) {
    // İçerik asla değişmez; tek istisna "Geri al" ile silindi işareti
    if (remote.deleted_at !== null && local.deleted_at === null) {
      return { row: { ...local, deleted_at: remote.deleted_at }, changed: true };
    }
    return { row: local, changed: false };
  }

  const isCard = table === "cards";
  const localRec = local as unknown as Record<string, unknown>;
  const remoteRec = remote as unknown as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...localRec };
  let changed = false;

  // Meta grup (kart dışındaki tablolarda satırın tamamı)
  if (remote.updated_at > local.updated_at) {
    for (const [key, value] of Object.entries(remoteRec)) {
      if (NEVER_COPIED.has(key)) continue;
      if (isCard && CARD_SCHED_KEYS.has(key)) continue;
      merged[key] = value;
    }
    changed = true;
  }

  // Zamanlama grubu (sadece kartlar)
  if (isCard) {
    const remoteSched = remoteRec.sched_updated_at as string | undefined;
    const localSched = localRec.sched_updated_at as string | undefined;
    if (remoteSched && (!localSched || remoteSched > localSched)) {
      for (const key of CARD_SCHED_KEYS) {
        if (key in remoteRec) merged[key] = remoteRec[key];
      }
      changed = true;
    }
  }

  if (changed) {
    merged.server_seq = Math.max(local.server_seq ?? 0, remote.server_seq ?? 0);
  }
  return { row: merged as unknown as R, changed };
}
