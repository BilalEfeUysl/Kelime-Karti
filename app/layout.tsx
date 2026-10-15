import type { Metadata, Viewport } from "next";
import { Figtree, Literata } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "@/components/app/Providers";
import { APP_DESCRIPTION, APP_NAME, THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "@/lib/config";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";

// Yazı tipleri derleme sırasında indirilip uygulamayla birlikte sunulur
// (Google'a istek gitmez, internetsiz de çalışır).
const sans = Figtree({ subsets: ["latin", "latin-ext"], variable: "--font-figtree", display: "swap" });
const display = Literata({ subsets: ["latin", "latin-ext"], variable: "--font-literata", display: "swap" });

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s – ${APP_NAME}` },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // iPhone çentik alanını kullan (safe-area ile)
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR_LIGHT },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR_DARK },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" className={`${sans.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
