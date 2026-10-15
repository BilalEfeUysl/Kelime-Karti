"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { SyncEngine, SyncStatus } from "@/lib/sync/engine";
import { useApp } from "./AppProvider";

const IDLE: SyncStatus = {
  phase: "idle",
  lastSyncedAt: null,
  error: null,
  errorKind: null,
  progress: null,
  initialSyncDone: false,
};

/** Senkron motorunun anlık durumu */
export function useSyncStatus(engine: SyncEngine | null): SyncStatus {
  return useSyncExternalStore(
    (cb) => (engine ? engine.subscribe(cb) : () => {}),
    () => engine?.getStatus() ?? IDLE,
    () => IDLE,
  );
}

/** Gönderilmeyi bekleyen ve sunucunun reddettiği değişiklik sayıları (canlı) */
export function useOutboxCounts() {
  const { db } = useApp();
  return (
    useLiveQuery(async () => {
      if (!db) return { pending: 0, failed: 0 };
      const all = await db.outbox.toArray();
      const failed = all.filter((e) => e.failed_hlc && e.failed_hlc === e.hlc).length;
      return { pending: all.length - failed, failed };
    }, [db]) ?? { pending: 0, failed: 0 }
  );
}

/** Tarayıcı çevrimiçi mi? */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/** Belirli aralıklarla yeniden çizim (ör. "3 dk önce" yazısı için) */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
