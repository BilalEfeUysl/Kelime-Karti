import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/app/AppShell";

export const metadata: Metadata = { title: "Çevrimdışı" };

// Önbellekte olmayan bir sayfa internetsiz açılmaya çalışılırsa bu gösterilir.
export default function Page() {
  return (
    <PublicShell>
      <h1 className="font-display text-[28px] font-semibold leading-tight">Bu sayfa internetsiz açılamıyor</h1>
      <p className="mt-3 text-ink-soft">
        İnternet bağlantın yok ve bu sayfa cihazda kayıtlı değil. Desteler ve çalışma ekranı internetsiz de çalışır.
      </p>
      <Link href="/" className="mt-6 inline-block font-semibold text-accent hover:underline">
        Destelere git
      </Link>
    </PublicShell>
  );
}
