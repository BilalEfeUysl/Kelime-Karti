// Testler için sanal cihaz: kendine ait (sahte) IndexedDB, kendi saati,
// istenince "internetsiz" moda geçebilen bağlantı.
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { type LocalDB, openLocalDB } from "@/lib/db/database";
import { SyncEngine } from "@/lib/sync/engine";
import type { MediaTransport } from "@/lib/sync/transport";
import type { TestServer, TestTransport } from "./server";

/** Tüm sanal cihazların paylaştığı "gerçek" zaman. Testte elle ilerletilir. */
export class TestTime {
  now = Date.UTC(2026, 9, 13, 9, 0, 0);
  advance(ms: number) {
    this.now += ms;
  }
}

export interface TestClient {
  name: string;
  db: LocalDB;
  engine: SyncEngine;
  transport: TestTransport;
  /** Resim yükleme taklidi (testte davranışı değiştirilebilir) */
  media: MediaTransport;
  goOffline(): void;
  goOnline(): void;
  sync(): ReturnType<SyncEngine["sync"]>;
}

export async function createTestClient(
  server: TestServer,
  uid: string,
  time: TestTime,
  opts: { name: string; skewMs?: number; pushBatchSize?: number; pullPageSize?: number } = { name: "cihaz" },
): Promise<TestClient> {
  const skew = opts.skewMs ?? 0;
  const db = await openLocalDB(uid, {
    // Her cihazın ayrı IndexedDB'si olsun
    dexie: { indexedDB: new IDBFactory(), IDBKeyRange },
    now: () => time.now + skew,
  });
  const transport = server.transportFor(uid);
  const media = server.mediaFor(uid, () => transport.online);
  const engine = await new SyncEngine({
    db,
    transport,
    media,
    isOnline: () => transport.online,
    pushBatchSize: opts.pushBatchSize,
    pullPageSize: opts.pullPageSize,
  }).load();
  return {
    name: opts.name,
    db,
    engine,
    transport,
    media,
    goOffline: () => {
      transport.online = false;
    },
    goOnline: () => {
      transport.online = true;
    },
    sync: () => engine.sync(),
  };
}

/** Verilen cihazları sırayla iki tur eşler (herkes herkesin değişikliğini görsün). */
export async function syncAll(...clients: TestClient[]) {
  for (let round = 0; round < 2; round++) {
    for (const c of clients) {
      const status = await c.sync();
      if (status.phase !== "idle") {
        throw new Error(`${c.name} eşlenemedi: ${status.phase} ${status.error ?? ""}`);
      }
    }
  }
}
