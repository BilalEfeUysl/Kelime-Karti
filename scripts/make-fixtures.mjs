// Elle deneme için örnek dosyaları üretir: npm run fixtures
//   fixtures/ornek-eski-format.apkg  (collection.anki2, şema 11)
//   fixtures/ornek-yeni-format.apkg  (collection.anki21b, şema 18, zstd)
//   fixtures/ornek-kelimeler.txt     (sekmeyle ayrılmış, Anki başlıklı)
import fs from "node:fs";
import { buildApkg, SAMPLE_CSV } from "./apkg-builder.mjs";

fs.mkdirSync("fixtures", { recursive: true });
fs.writeFileSync("fixtures/ornek-eski-format.apkg", await buildApkg("legacy"));
fs.writeFileSync("fixtures/ornek-yeni-format.apkg", await buildApkg("latest"));
fs.writeFileSync("fixtures/ornek-kelimeler.txt", SAMPLE_CSV);
console.log("✓ fixtures/ klasörüne 3 örnek dosya yazıldı");
