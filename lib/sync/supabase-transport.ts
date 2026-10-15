// Senkron motorunun gerçek uygulamadaki sunucu bağlantısı (Supabase).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type MediaTransport,
  type PulledRow,
  type PushChange,
  type PushResult,
  SyncError,
  type SyncTransport,
  toSyncError,
} from "./transport";

export class SupabaseSyncTransport implements SyncTransport {
  constructor(private readonly client: SupabaseClient) {}

  async prepare() {
    // Oturum geçerli mi? (Süresi dolmuşsa supabase-js burada yeniler.)
    const { data, error } = await this.client.auth.getSession();
    if (error) throw toSyncError(error);
    if (!data.session) throw new SyncError("auth", "Oturum yok, tekrar giriş yapmalısın");
  }

  async push(changes: PushChange[], deviceId: string): Promise<PushResult> {
    const { data, error } = await this.client.rpc("push_changes", { p_changes: changes, p_device: deviceId });
    if (error) throw toSyncError(error);
    return data as PushResult;
  }

  async pull(since: number, limit: number): Promise<PulledRow[]> {
    const { data, error } = await this.client.rpc("pull_changes", { p_since: since, p_limit: limit });
    if (error) throw toSyncError(error);
    return ((data ?? []) as PulledRow[]).map((r) => ({ ...r, seq: Number(r.seq) }));
  }

  async pullCount(since: number): Promise<number> {
    const { data, error } = await this.client.rpc("pull_count", { p_since: since });
    if (error) throw toSyncError(error);
    return Number(data ?? 0);
  }

  async syncShared(): Promise<number> {
    const { data, error } = await this.client.rpc("sync_shared_decks");
    if (error) throw toSyncError(error);
    return Number(data ?? 0);
  }
}

export class SupabaseMediaTransport implements MediaTransport {
  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket = "media",
  ) {}

  async upload(path: string, data: ArrayBuffer, mime: string) {
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(path, new Blob([data], { type: mime }), { contentType: mime, upsert: true });
    if (error) throw toSyncError(error);
  }

  async download(path: string): Promise<ArrayBuffer> {
    const { data, error } = await this.client.storage.from(this.bucket).download(path);
    if (error || !data) throw toSyncError(error ?? new Error("Resim indirilemedi"));
    return data.arrayBuffer();
  }
}

/** sync_heads tablosunu Realtime ile dinler: başka cihaz bir şey gönderince haber verir. */
export function subscribeRemoteChanges(
  client: SupabaseClient,
  userId: string,
  deviceId: string,
  onChange: () => void,
): () => void {
  const channel = client
    .channel(`sync-heads-${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "sync_heads", filter: `user_id=eq.${userId}` },
      (payload) => {
        const device = (payload.new as { device_id?: string } | null)?.device_id;
        if (device !== deviceId) onChange();
      },
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
