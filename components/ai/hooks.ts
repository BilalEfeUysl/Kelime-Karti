"use client";
// Gemini anahtar durumu (tüm ekranlar paylaşır)
import { useEffect, useSyncExternalStore } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useOnline } from "@/components/app/hooks";
import { type KeyStatus, keyStore } from "@/lib/ai/client";

let loaded = false;

export function useKeyStatus(): { status: KeyStatus | null; online: boolean; ready: boolean } {
  const { hasSession } = useApp();
  const online = useOnline();
  const status = useSyncExternalStore(keyStore.subscribe, keyStore.get, () => null);
  useEffect(() => {
    if (online && hasSession && !loaded) {
      loaded = true;
      void keyStore.refresh();
    }
  }, [online, hasSession]);
  return { status, online, ready: online && !!hasSession && !!status?.hasKey };
}
