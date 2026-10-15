/// <reference lib="webworker" />
// SERVICE WORKER: tarayıcının arka planda çalıştırdığı küçük program.
// Görevi: uygulamanın dosyalarını (sayfalar, JS, CSS, yazı tipleri, ikonlar)
// cihazda saklamak; böylece internet yokken de uygulama açılır.
//
// Not: Supabase istekleri (veri, giriş) ASLA önbelleğe alınmaz; veri zaten
// cihazdaki IndexedDB'de duruyor.
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  // Derleme sırasında oluşturulan dosya listesi (uygulama kabuğu)
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    cleanupOutdatedCaches: true,
    // "/?x=1" gibi adresler de önbellekteki "/" sayfasıyla eşleşsin
    ignoreURLParametersMatching: [/.*/],
  },
  // Yeni sürüm hemen devreye girmez; "Yeni sürüm hazır" bandında kullanıcı
  // "Yenile"ye basınca girer (çalışma yarıda kesilmesin).
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    // Başka sitelere (Supabase vb.) giden istekler: önbellek yok
    { matcher: ({ sameOrigin }) => !sameOrigin, handler: new NetworkOnly() },
    // Kendi API'miz: önbellek yok
    { matcher: ({ url }) => url.pathname.startsWith("/api/"), handler: new NetworkOnly() },
    // Next.js sayfa verisi (RSC): önce ağ, olmazsa önbellek
    {
      matcher: ({ request }) => request.headers.get("RSC") === "1",
      handler: new NetworkFirst({
        cacheName: "pages-rsc",
        networkTimeoutSeconds: 4,
        plugins: [new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 7 * 86_400 })],
      }),
    },
    // Sayfalar: önce ağ, olmazsa önbellek
    {
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: "pages",
        networkTimeoutSeconds: 4,
        plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 30 * 86_400 })],
      }),
    },
    // Derlenmiş dosyalar (adlarında içerik özeti var, değişmezler)
    {
      matcher: ({ url }) => url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: "next-static",
        plugins: [new ExpirationPlugin({ maxEntries: 256, maxAgeSeconds: 60 * 86_400 })],
      }),
    },
    // Diğer kendi dosyalarımız (ikonlar vb.)
    {
      matcher: ({ sameOrigin }) => sameOrigin,
      handler: new NetworkFirst({ cacheName: "others", networkTimeoutSeconds: 4 }),
    },
  ],
  // Önbellekte olmayan bir sayfa internetsiz açılırsa: "Çevrimdışısın" sayfası
  fallbacks: {
    entries: [{ url: "/cevrimdisi", matcher: ({ request }) => request.destination === "document" }],
  },
});

serwist.addEventListeners();
