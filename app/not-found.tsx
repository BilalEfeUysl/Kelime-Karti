import Link from "next/link";
import { PublicShell } from "@/components/app/AppShell";

// Olmayan bir adres açılınca (ör. eski bir bağlantı) gösterilir.
export default function NotFound() {
  return (
    <PublicShell>
      <h1 className="font-display text-[28px] font-semibold leading-tight">Bu sayfa yok</h1>
      <p className="mt-3 text-ink-soft">Adres yanlış ya da bu sayfa kaldırılmış.</p>
      <Link href="/" className="mt-6 inline-block font-semibold text-accent hover:underline">
        Ana sayfaya git
      </Link>
    </PublicShell>
  );
}
