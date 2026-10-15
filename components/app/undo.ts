"use client";
// Geri al / yinele için React kancası: yöneticiyi ve güncel durumu verir.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getUndoManager, type UndoEvent, type UndoManager, type UndoMeta } from "@/lib/undo";
import { useApp } from "./AppProvider";

export interface UndoState {
  manager: UndoManager | null;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  /** İşlemi geri alınabilir şekilde çalıştırır */
  run: <T>(label: string, fn: () => Promise<T>, meta?: UndoMeta) => Promise<T>;
}

const EMPTY = { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null };

export function useUndo(): UndoState {
  const { db } = useApp();
  const manager = db ? getUndoManager(db) : null;
  const subscribe = useCallback((cb: () => void) => (manager ? manager.subscribe(cb) : () => {}), [manager]);
  // Etiketleri tek bir dizgede birleştirerek "değişti mi" kontrolü yap
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (manager ? `${manager.undoLabel ?? ""}\u0000${manager.redoLabel ?? ""}\u0000${manager.canUndo}${manager.canRedo}` : ""),
    () => "",
  );
  void snapshot;
  const run = useCallback(
    <T,>(label: string, fn: () => Promise<T>, meta?: UndoMeta) => (manager ? manager.run(label, fn, meta) : fn()),
    [manager],
  );
  if (!manager) return { manager, ...EMPTY, run };
  return {
    manager,
    canUndo: manager.canUndo,
    canRedo: manager.canRedo,
    undoLabel: manager.undoLabel,
    redoLabel: manager.redoLabel,
    run,
  };
}

/** Geri al / yinele olaylarını dinler (ör. çalışma ekranı ilgili kartı göstersin) */
export function useUndoEvents(handler: (e: UndoEvent) => void) {
  const { db } = useApp();
  const [h] = useState(() => ({ current: handler }));
  h.current = handler;
  useEffect(() => {
    if (!db) return;
    return getUndoManager(db).subscribe((e) => e && h.current(e));
  }, [db, h]);
}
