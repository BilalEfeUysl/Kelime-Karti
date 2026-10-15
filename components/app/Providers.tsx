"use client";
// Tüm sayfaları saran sağlayıcılar: service worker (PWA) + uygulama durumu.
import { SerwistProvider } from "@serwist/turbopack/react";
import type { ReactNode } from "react";
import { AppProvider } from "./AppProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      // Geliştirme modunda service worker kapalı (önbellek kafa karıştırmasın)
      disable={process.env.NODE_ENV === "development"}
      // İnternet gelince sayfayı yenileme! (çalışırken kesinti olmasın)
      reloadOnOnline={false}
      cacheOnNavigation={false}
    >
      <AppProvider>{children}</AppProvider>
    </SerwistProvider>
  );
}
