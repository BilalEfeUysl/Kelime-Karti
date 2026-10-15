// sql.js'in tarayıcı WASM dosyasını public/ klasörüne kopyalar
// (npm run dev / npm run build öncesi otomatik çalışır).
import fs from "node:fs";

fs.copyFileSync("node_modules/sql.js/dist/sql-wasm-browser.wasm", "public/sql-wasm-browser.wasm");
