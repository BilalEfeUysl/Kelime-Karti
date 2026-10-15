// sql.js (tarayıcıda çalışan SQLite) yükleyici. WASM dosyası /public'ten gelir
// ve service worker ile önbelleğe alınır; içe aktarma internetsiz de çalışır.
import type { SqlJsStatic } from "sql.js";

let promise: Promise<SqlJsStatic> | null = null;

export function loadSql(): Promise<SqlJsStatic> {
  promise ??= import("sql.js").then((m) => {
    const init = (m as unknown as { default: (cfg: object) => Promise<SqlJsStatic> }).default;
    return init({ locateFile: () => "/sql-wasm-browser.wasm" });
  });
  return promise;
}
