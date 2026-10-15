import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // PGlite (WASM Postgres) ilk açılışta birkaç saniye sürebilir
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
