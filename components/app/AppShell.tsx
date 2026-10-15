"use client";
// Giriş yapılmış sayfaların ortak çerçevesi: üst çubuk (ad + senkron
// göstergesi), bantlar, içerik ve menü (telefonda altta, bilgisayarda üstte).
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { APP_NAME } from "@/lib/config";
import { Spinner } from "@/components/ui";
import { useApp } from "./AppProvider";
import { InitialSyncProgress, InstallBanner, SessionBanner, UpdateBanner } from "./Banners";
import { SyncIndicator } from "./SyncIndicator";
import { useUndo, useUndoEvents } from "./undo";
import { useKeyStatus } from "@/components/ai/hooks";
import { aiRunner } from "@/lib/ai/runner";
import { maybeAutoBackup } from "@/lib/backup";

interface NavItem {
  href: string;
  label: string;
  /** telefondaki alt menüde (dar yer) */
  short: string;
  icon: ReactNode;
}

const icon = (d: string) => (
  <svg aria-hidden viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const NAV: NavItem[] = [
  { href: "/", label: "Desteler", short: "Desteler", icon: icon("M4 8h12v12H4zM8 4h12v12h-4") },
  { href: "/ekle", label: "Kart ekle", short: "Ekle", icon: icon("M12 5v14M5 12h14") },
  { href: "/kartlar", label: "Kartlar", short: "Kartlar", icon: icon("M4 5h16M4 10h16M4 15h10M4 20h7M17 17l3 3M15.5 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z") },
  { href: "/istatistikler", label: "İstatistikler", short: "İstatistik", icon: icon("M5 20V11M12 20V4M19 20v-6") },
  { href: "/ayarlar", label: "Ayarlar", short: "Ayarlar", icon: icon("M4 6h9M17 6h3M15 4v4M4 12h3M11 12h9M9 10v4M4 18h11M19 18h1M17 16v4") },
];

/** Çalışma ekranı gibi tam odaklı ekranlar alt menüyü gizleyebilir;
 *  kart tarayıcı gibi ekranlar geniş düzen isteyebilir. */
const ShellContext = createContext<{ setImmersive: (v: boolean) => void; setWide: (v: boolean) => void }>({
  setImmersive: () => {},
  setWide: () => {},
});
export const useShell = () => useContext(ShellContext);

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

/** Haftalık otomatik yedek: açılıştan 1 dakika sonra (internet + oturum varsa) dener */
function AutoBackupMount() {
  const { db, hasSession, engine } = useApp();
  useEffect(() => {
    if (!db || !hasSession) return;
    const t = setTimeout(() => {
      if (!navigator.onLine || !engine?.getStatus().initialSyncDone) return;
      void maybeAutoBackup(db).catch(() => {
        // sessizce; bir sonraki açılışta tekrar denenir
      });
    }, 60_000);
    return () => clearTimeout(t);
  }, [db, hasSession, engine]);
  return null;
}

/** Gemini anahtarı olan kullanıcıda toplu örnek cümle işlerini arka planda yürütür */
function AiRunnerMount() {
  const { db } = useApp();
  const { ready } = useKeyStatus();
  useEffect(() => {
    if (db && ready) aiRunner.start(db);
  }, [db, ready]);
  return null;
}

/** Her sayfada: Ctrl/Cmd+Z geri al, Ctrl/Cmd+Shift+Z (veya Ctrl+Y) yinele; sonuç kısa bir bildirimle gösterilir */
function UndoKeys() {
  const undo = useUndo();
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useUndoEvents((e) => {
    setToast(`${e.type === "undo" ? "Geri alındı" : "Yinelendi"}: ${e.step.label}`);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isEditable(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        void undo.manager?.undo();
      } else if ((k === "z" && e.shiftKey) || (k === "y" && e.ctrlKey)) {
        e.preventDefault();
        void undo.manager?.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo.manager]);
  if (!toast) return null;
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 md:bottom-6 md:pl-60">
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-rule bg-surface px-3.5 py-2 text-sm shadow-lg">
        {toast}
        {undo.canRedo && toast.startsWith("Geri") && (
          <button type="button" className="font-semibold text-accent" onClick={() => void undo.manager?.redo()}>
            Yinele
          </button>
        )}
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { ready, user, db } = useApp();
  const [immersive, setImmersive] = useState(false);
  const [wide, setWide] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Giriş yapılmamışsa giriş sayfasına
  useEffect(() => {
    if (ready && !user) router.replace("/giris");
  }, [ready, user, router]);

  // Alt sayfalar ait oldukları menü öğesini işaretler (ör. çalışma → Desteler, etiketler → Ayarlar)
  const section = (p: string) => {
    if (p === "/" || ["/calis", "/deste-ayarlari", "/iceaktar"].some((x) => p.startsWith(x))) return "/";
    const top = NAV.find((n) => n.href !== "/" && p.startsWith(n.href));
    return top?.href ?? "/ayarlar";
  };
  const isActive = (href: string) => section(pathname) === href;

  return (
    <ShellContext.Provider value={{ setImmersive, setWide }}>
      {/* Bilgisayarda solda sabit menü: genişliği hiçbir sayfada değişmez */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-rule bg-surface md:flex">
        <Link href="/" className="flex h-16 shrink-0 items-center px-5 font-display text-[19px] font-semibold tracking-tight">
          {APP_NAME}
        </Link>
        <nav aria-label="Ana menü" className="flex-1 overflow-y-auto px-3">
          <ul className="space-y-0.5">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-[15px] font-medium text-ink-soft hover:bg-ink/5 hover:text-ink aria-[current=page]:bg-accent/10 aria-[current=page]:text-accent"
                >
                  {item.icon}
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="shrink-0 border-t border-rule p-3">{user && <SyncIndicator className="w-full" />}</div>
      </aside>

      <div className="flex min-h-dvh flex-col md:pl-56">
        {/* Telefonda üst çubuk */}
        <header className="sticky top-0 z-20 border-b border-rule bg-paper/95 pt-safe backdrop-blur md:hidden">
          <div className="flex h-14 items-center gap-3 px-safe">
            <Link href="/" className="font-display text-[19px] font-semibold tracking-tight">
              {APP_NAME}
            </Link>
            <div className="ml-auto min-w-0">{user && <SyncIndicator />}</div>
          </div>
        </header>

        <main className={`mx-auto w-full flex-1 px-safe pb-28 pt-5 md:px-8 md:pb-12 md:pt-8 ${wide ? "max-w-[1600px]" : "max-w-3xl md:max-w-[52rem]"}`}>
          <div className="space-y-2 empty:hidden [&:not(:empty)]:mb-5">
            <UpdateBanner />
            <SessionBanner />
            <InitialSyncProgress />
            {!immersive && <InstallBanner />}
          </div>
          {ready && user && db ? children : <Spinner />}
        </main>
      </div>
      {db && <UndoKeys />}
      {db && <AiRunnerMount />}
      {db && <AutoBackupMount />}

      <nav
        aria-label="Ana menü"
        className={`fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-paper/95 pb-safe backdrop-blur md:hidden ${immersive ? "hidden" : ""}`}
      >
        <ul className="mx-auto flex max-w-lg">
          {NAV.map((item) => (
            <li key={item.href} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-ink-soft aria-[current=page]:text-accent"
              >
                {item.icon}
                <span className="max-w-full truncate px-0.5">{item.short}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </ShellContext.Provider>
  );
}

/** Giriş gerektirmeyen sayfalar (giriş, kayıt, kurulum) için sade çerçeve */
export function PublicShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const width = wide ? "max-w-2xl" : "max-w-md";
  return (
    <div className="flex min-h-dvh flex-col pt-safe pb-safe">
      <header className={`mx-auto flex h-16 w-full items-center px-safe ${width}`}>
        <Link href="/" className="font-display text-[19px] font-semibold tracking-tight">
          {APP_NAME}
        </Link>
      </header>
      <main className={`mx-auto w-full flex-1 px-safe pb-12 pt-6 ${width}`}>
        <div className="mb-5 empty:hidden">
          <UpdateBanner />
        </div>
        {children}
      </main>
    </div>
  );
}
