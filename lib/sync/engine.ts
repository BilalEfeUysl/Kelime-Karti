// SENKRON MOTORU
//
// Bir "eşleme turu" şu adımlardan oluşur:
//   1) Bekleyen resimleri Storage'a yükle
//   2) PUSH: outbox'taki değişiklikleri paketler halinde sunucuya gönder
//   3) PULL: sunucuda "en son gördüğüm server_seq"ten sonra değişen satırları
//      çek ve çakışma kurallarıyla (merge.ts) cihazdaki satırlarla birleştir
//
// Motor arayüzden bağımsızdır: sadece LocalDB ve SyncTransport'u bilir.
// Aynı anda tek tur çalışır; tur sürerken yeni istek gelirse tur bitince
// bir tur daha yapılır.
import type { LocalDB } from "@/lib/db/database";
import type { BaseRow, OutboxEntry } from "@/lib/db/types";
import { uploadPendingMedia } from "./media";
import { mergeRow } from "./merge";
import { SYNC_TABLES, type SyncTable } from "./tables";
import {
  type MediaTransport,
  type PulledRow,
  type PushChange,
  type SyncErrorKind,
  type SyncTransport,
  toSyncError,
} from "./transport";

export type SyncPhase = "idle" | "syncing" | "offline" | "error" | "auth";

export interface SyncProgress {
  label: string;
  done: number;
  total: number;
}

export interface SyncStatus {
  phase: SyncPhase;
  lastSyncedAt: number | null;
  error: string | null;
  errorKind: SyncErrorKind | null;
  progress: SyncProgress | null;
  initialSyncDone: boolean;
}

export interface SyncEngineOptions {
  db: LocalDB;
  transport: SyncTransport;
  media?: MediaTransport | null;
  /** İnternet var mı? (tarayıcıda navigator.onLine) */
  isOnline?: () => boolean;
  pushBatchSize?: number;
  pullPageSize?: number;
  /** Tek pakette gönderilecek yaklaşık en fazla bayt */
  maxBatchBytes?: number;
}

type Listener = (status: SyncStatus) => void;

const TABLE_ORDER = new Map(SYNC_TABLES.map((t, i) => [t, i]));

export class SyncEngine {
  private status: SyncStatus = {
    phase: "idle",
    lastSyncedAt: null,
    error: null,
    errorKind: null,
    progress: null,
    initialSyncDone: false,
  };
  private listeners = new Set<Listener>();
  private running: Promise<SyncStatus> | null = null;
  private again = false;
  private readonly pushBatchSize: number;
  private readonly pullPageSize: number;
  private readonly maxBatchBytes: number;

  constructor(private readonly opts: SyncEngineOptions) {
    this.pushBatchSize = opts.pushBatchSize ?? 200;
    // Supabase'in "Max rows" sınırı (varsayılan 1000) yüzünden sayfa 500 satır
    this.pullPageSize = opts.pullPageSize ?? 500;
    this.maxBatchBytes = opts.maxBatchBytes ?? 900_000;
  }

  get db() {
    return this.opts.db;
  }

  /** Kayıtlı durumu (son eşleme zamanı vb.) yükler. */
  async load(): Promise<this> {
    const { db } = this.opts;
    this.setStatus({
      lastSyncedAt: await db.getState<number | null>("last_sync_at", null),
      initialSyncDone: await db.getState<boolean>("initial_sync_done", false),
    });
    return this;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  /** Tarayıcı "internet gitti" dediğinde göstergeyi hemen güncellemek için. */
  notifyOffline() {
    if (!this.running) this.setStatus({ phase: "offline", progress: null });
  }

  /** Bir eşleme turu başlatır (zaten çalışıyorsa bitince bir tur daha yapar). */
  sync(): Promise<SyncStatus> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.runOnce();
        } while (this.again && this.status.phase === "idle");
        return this.status;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async runOnce() {
    const { db, transport, media } = this.opts;
    const online = this.opts.isOnline?.() ?? true;
    if (!online) {
      this.setStatus({ phase: "offline", progress: null });
      return;
    }
    this.setStatus({ phase: "syncing", error: null, errorKind: null });
    try {
      await transport.prepare?.();
      if (media) {
        await uploadPendingMedia(db, media, (done, total) =>
          this.setStatus({ progress: { label: "Resimler yükleniyor", done, total } }),
        );
      }
      await this.pushAll();
      await this.pullAll();
      const now = db.now();
      await db.setState("last_sync_at", now);
      this.setStatus({ phase: "idle", lastSyncedAt: now, progress: null });
    } catch (err) {
      const e = toSyncError(err);
      const phase: SyncPhase = e.kind === "offline" ? "offline" : e.kind === "auth" ? "auth" : "error";
      this.setStatus({ phase, error: e.message, errorKind: e.kind, progress: null });
    }
  }

  // ---------------------------------------------------------------- PUSH

  private async pushAll() {
    const { db, transport } = this.opts;
    const total = await db.outbox.filter((e) => e.failed_hlc !== e.hlc).count();
    let done = 0;
    if (total > 0) this.setStatus({ progress: { label: "Gönderiliyor", done, total } });

    for (;;) {
      const entries = await db.outbox
        .orderBy("hlc")
        .filter((e) => e.failed_hlc !== e.hlc)
        .limit(this.pushBatchSize)
        .toArray();
      if (entries.length === 0) return;

      const { changes, sent, missing } = await this.buildBatch(entries);
      if (missing.length) await db.outbox.bulkDelete(missing);
      if (changes.length === 0) continue;

      const result = await transport.push(changes, db.deviceId);
      const errors = new Map(result.errors.map((e) => [`${e.table}:${e.id}`, e.message]));

      // Onaylananları kuyruktan sil. Gönderim sırasında satır tekrar
      // değiştiyse (hlc farklı) kayıt kalır ve bir sonraki pakette gider.
      await db.transaction("rw", db.outbox, async () => {
        for (const s of sent) {
          const current = await db.outbox.get(s.key);
          if (!current || current.hlc !== s.hlc) continue;
          const message = errors.get(s.key);
          if (message) await db.outbox.put({ ...current, failed_hlc: current.hlc, error: message });
          else await db.outbox.delete(s.key);
        }
      });
      done += sent.length;
      this.setStatus({ progress: { label: "Gönderiliyor", done: Math.min(done, total), total } });
    }
  }

  private async buildBatch(entries: OutboxEntry[]) {
    const { db } = this.opts;
    const byTable = new Map<SyncTable, OutboxEntry[]>();
    for (const e of entries) byTable.set(e.table, [...(byTable.get(e.table) ?? []), e]);

    const items: { entry: OutboxEntry; row: BaseRow }[] = [];
    const missing: string[] = [];
    for (const [table, list] of byTable) {
      const rows = await db.syncTable(table).bulkGet(list.map((e) => e.id));
      list.forEach((entry, i) => {
        const row = rows[i];
        if (row) items.push({ entry, row });
        else missing.push(entry.key);
      });
    }
    // Üst kayıtlar önce (deste → not → kart ...), sonra damga sırası
    items.sort(
      (a, b) =>
        TABLE_ORDER.get(a.entry.table)! - TABLE_ORDER.get(b.entry.table)! ||
        (a.entry.hlc < b.entry.hlc ? -1 : 1),
    );

    const changes: PushChange[] = [];
    const sent: OutboxEntry[] = [];
    let bytes = 0;
    for (const { entry, row } of items) {
      const size = JSON.stringify(row).length;
      if (changes.length > 0 && bytes + size > this.maxBatchBytes) break;
      bytes += size;
      changes.push({ table: entry.table, row: row as unknown as Record<string, unknown> });
      sent.push(entry);
    }
    return { changes, sent, missing };
  }

  // ---------------------------------------------------------------- PULL

  private async pullAll() {
    const { db, transport } = this.opts;
    let since = await db.getState<number>("last_server_seq", 0);
    const initial = !(await db.getState<boolean>("initial_sync_done", false));
    const label = initial ? "Verilerin indiriliyor" : "Değişiklikler alınıyor";
    const total = initial ? await transport.pullCount(since) : 0;
    let done = 0;
    if (initial && total > 0) this.setStatus({ progress: { label, done, total } });

    for (;;) {
      const rows = await transport.pull(since, this.pullPageSize);
      if (rows.length === 0) break;
      await this.applyPulled(rows);
      since = rows[rows.length - 1].seq;
      done += rows.length;
      if (initial) this.setStatus({ progress: { label, done: Math.min(done, total), total } });
      if (rows.length < this.pullPageSize) break;
    }

    if (initial) {
      await db.setState("initial_sync_done", true);
      this.setStatus({ initialSyncDone: true });
    }
  }

  /** Sunucudan gelen bir sayfayı tek transaction'da cihaza yazar. */
  private async applyPulled(rows: PulledRow[]) {
    const { db } = this.opts;
    const byTable = new Map<SyncTable, Record<string, unknown>[]>();
    for (const r of rows) {
      if (!TABLE_ORDER.has(r.tbl)) continue; // bilinmeyen tablo (yeni sürüm) — atla
      byTable.set(r.tbl, [...(byTable.get(r.tbl) ?? []), r.row_data]);
    }
    const maxSeq = rows.reduce((m, r) => Math.max(m, r.seq), 0);

    await db.transaction("rw", [...SYNC_TABLES.map((t) => db.table(t)), db.sync_state], async () => {
      for (const [table, remotes] of byTable) {
        const store = db.syncTable(table);
        const locals = await store.bulkGet(remotes.map((r) => r.id as string));
        const toPut: BaseRow[] = [];
        remotes.forEach((remoteRec, i) => {
          const remote = remoteRec as unknown as BaseRow;
          db.clock.receive(remote.updated_at);
          db.clock.receive(remoteRec.sched_updated_at as string | undefined);
          const { row, changed } = mergeRow(table, locals[i], remote);
          if (changed) toPut.push(row);
        });
        if (toPut.length) await store.bulkPut(toPut as never[]);
      }
      await db.sync_state.bulkPut([
        { key: "last_server_seq", value: maxSeq },
        { key: "hlc", value: db.clock.current() },
      ]);
    });
  }

  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }
}
