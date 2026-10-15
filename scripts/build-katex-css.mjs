// KaTeX stilini yazı tipleri GÖMÜLÜ olarak üretir (kart iframe'i internetsiz
// ve kendi kökeni olmadan çalıştığı için yazı tipleri dışarıdan yüklenemez).
// Çıktı: lib/generated/katex-css.ts  (npm run katex-css)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("katex/dist/katex.min.css"));
let css = readFileSync(join(dist, "katex.min.css"), "utf8");
// Her @font-face'te sadece woff2'yi bırak ve data: adresine çevir
css = css.replace(/src:([^;}]+)/g, (m, list) => {
  const woff2 = /url\(fonts\/([^)]+\.woff2)\)/.exec(list);
  if (!woff2) return m;
  const data = readFileSync(join(dist, "fonts", woff2[1])).toString("base64");
  return `src:url(data:font/woff2;base64,${data}) format("woff2")`;
});
writeFileSync(
  "lib/generated/katex-css.ts",
  `// OTOMATİK ÜRETİLDİ (scripts/build-katex-css.mjs) — elle düzenleme.\nexport const KATEX_CSS = ${JSON.stringify(css)};\n`,
);
console.log(`katex-css: ${(css.length / 1024).toFixed(0)} KB`);
