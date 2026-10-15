// Senkron motorunun sunucuyla konuştuğu arayüz. Motor sadece bu arayüzü
// bilir; gerçek uygulamada Supabase, testlerde PGlite (gerçek Postgres)
// kullanılır. Böylece motor arayüzden ve ağdan bağımsız test edilebilir.
import type { SyncTable } from "./tables";

export interface PushChange {
  table: SyncTable;
  row: Record<string, unknown>;
}

export interface PushResult {
  applied: number;
  skipped: number;
  errors: { table: string; id: string; message: string }[];
}

export interface PulledRow {
  tbl: SyncTable;
  seq: number;
  row_data: Record<string, unknown>;
}

export interface SyncTransport {
  /** Sync başlamadan önce oturumun geçerli olduğundan emin olur (opsiyonel). */
  prepare?(): Promise<void>;
  push(changes: PushChange[], deviceId: string): Promise<PushResult>;
  pull(since: number, limit: number): Promise<PulledRow[]>;
  pullCount(since: number): Promise<number>;
}

/** Resim dosyaları için (Supabase Storage) */
export interface MediaTransport {
  upload(path: string, data: ArrayBuffer, mime: string): Promise<void>;
  download(path: string): Promise<ArrayBuffer>;
}

export type SyncErrorKind = "offline" | "auth" | "forbidden" | "server";

export class SyncError extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

const NETWORK_PATTERNS = /failed to fetch|networkerror|load failed|network request failed|fetch failed|ECONNREFUSED|ENOTFOUND|AuthRetryableFetchError/i;

/** Herhangi bir hatayı motorun anlayacağı türe çevirir. */
export function toSyncError(err: unknown): SyncError {
  if (err instanceof SyncError) return err;
  const e = err as { message?: string; code?: string; status?: number; name?: string } | null;
  const message = e?.message ?? String(err);
  const code = e?.code ?? "";
  if (NETWORK_PATTERNS.test(message) || NETWORK_PATTERNS.test(e?.name ?? "")) {
    return new SyncError("offline", "Sunucuya ulaşılamıyor");
  }
  if (code.startsWith("PGRST30") || e?.status === 401 || /jwt|refresh token|not authenticated/i.test(message)) {
    return new SyncError("auth", "Oturum süresi doldu, tekrar giriş yapmalısın");
  }
  if (code === "42501") {
    return new SyncError("forbidden", "Bu hesabın eşleme izni yok (yönetici devre dışı bırakmış olabilir).");
  }
  return new SyncError("server", message);
}
