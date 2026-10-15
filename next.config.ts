import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // FSRS optimizasyonu yerel (native) Node modülü kullanır: paketlenmeden yüklensin
  serverExternalPackages: ["@open-spaced-repetition/binding"],
  async headers() {
    return [
      {
        // Service worker her zaman tazesi alınsın (güncellemeler fark edilsin)
        source: "/serwist/:path*",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
