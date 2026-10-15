// Service worker dosyasını (/serwist/sw.js) üreten route.
// Derleme sırasında bir kez çalışır; app/sw.ts'yi paketler ve önbelleğe
// alınacak dosyaların listesini içine yerleştirir.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createSerwistRoute } from "@serwist/turbopack";

// İnternetsiz açılması gereken sayfalar (dinamik adres kullanmıyoruz;
// parametreler ?deste=... gibi sorgu ile verilir, böylece hepsi önbelleğe girer).
const APP_ROUTES = [
  "/",
  "/giris",
  "/calis",
  "/ekle",
  "/iceaktar",
  "/deste-ayarlari",
  "/kartlar",
  "/not-tipleri",
  "/etiketler",
  "/ornek-cumleler",
  "/istatistikler",
  "/disa-aktar",
  "/bakim",
  "/ayarlar",
  "/kurulum",
  "/admin",
  "/cevrimdisi",
];

/** Bu derlemeye özgü sürüm: derlenmiş dosya adları değişince değişir. */
function buildRevision(): string {
  const dir = path.join(process.cwd(), ".next", "static");
  const files = fs.existsSync(dir) ? (fs.readdirSync(dir, { recursive: true }) as string[]).sort() : [];
  return createHash("sha256")
    .update(files.join("|"))
    .update(process.env.VERCEL_GIT_COMMIT_SHA ?? "")
    .digest("hex")
    .slice(0, 16);
}

const revision = buildRevision();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "app/sw.ts",
  useNativeEsbuild: true,
  globPatterns: [".next/static/**/*.{js,css,woff,woff2,png,svg,ico,webp,json,wasm}", "public/**/*"],
  // sql.js WASM (~650 KB) içe aktarmanın internetsiz çalışması için önbelleğe alınır
  maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
  additionalPrecacheEntries: [
    ...APP_ROUTES.map((url) => ({ url, revision })),
    { url: "/manifest.webmanifest", revision },
  ],
});
