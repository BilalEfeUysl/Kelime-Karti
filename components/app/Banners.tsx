"use client";
// Üstte çıkan bantlar: yeni sürüm hazır, ana ekrana ekle önerisi,
// oturum süresi doldu, ilk eşleme tamamlanmadı.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { isStandalone, readJSON, writeJSON } from "@/lib/storage";
import { useApp } from "./AppProvider";
import { useOnline, useSyncStatus } from "./hooks";

function Banner({ children, actions, className = "" }: { children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-rule bg-surface py-2 pr-2 pl-4 text-sm ${className}`}>
      <p className="min-w-0 flex-1 py-1">{children}</p>
      {actions && <div className="flex shrink-0 gap-1">{actions}</div>}
    </div>
  );
}

const linkBtn = "rounded-md px-2.5 py-1.5 font-semibold text-accent hover:bg-accent/10";

/** Yeni service worker beklemedeyse "Yeni sürüm hazır" bandı.
 *  Not: Tarayıcı yeni sürümü sayfa açılırken kendiliğinden indirmeye
 *  başlayabilir; bu yüzden hem "bekleyen" hem "inmekte olan" sürümü izliyoruz. */
export function UpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const openedAt = useRef(Date.now());

  // Uygulama yeni açıldıysa (ilk 20 saniye) yeni sürüm sormadan devreye girer:
  // kullanıcı henüz bir şey yapmadı, kaybedecek bir şey yok. Sonradan bulunan
  // güncellemeler için bant çıkar (çalışma yarıda kesilmesin).
  useEffect(() => {
    if (!waiting || Date.now() - openedAt.current > 20_000) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, [waiting]);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV === "development") return;
    let reg: ServiceWorkerRegistration | undefined;
    const check = () => {
      // controller varsa bu bir güncellemedir (ilk kurulum değil)
      if (reg?.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
    };
    const track = (sw: ServiceWorker | null | undefined) => sw?.addEventListener("statechange", check);
    const onUpdateFound = () => track(reg?.installing);
    const onVisible = () => {
      // Uygulama öne geldikçe yeni sürüm var mı diye bak
      if (document.visibilityState === "visible") void reg?.update().catch(() => {});
    };
    void navigator.serviceWorker.ready.then((r) => {
      reg = r;
      check();
      track(r.installing);
      r.addEventListener("updatefound", onUpdateFound);
    });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      reg?.removeEventListener("updatefound", onUpdateFound);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const reload = () => {
    if (!waiting) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    waiting.postMessage({ type: "SKIP_WAITING" });
  };
  if (!waiting) return null;
  return (
    <Banner
      actions={
        <button type="button" className={linkBtn} onClick={reload}>
          Yenile
        </button>
      }
    >
      Yeni sürüm hazır. Yenileyince güncel sürüm açılır; verilerin kaybolmaz.
    </Banner>
  );
}

const INSTALL_KEY = "kk.installBannerHiddenAt";

/** Ana ekrana eklenmemişse öneri bandı (14 günde bir tekrar gösterilir) */
export function InstallBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const hiddenAt = readJSON<number>(INSTALL_KEY);
    const recentlyHidden = hiddenAt && Date.now() - hiddenAt < 14 * 86_400_000;
    setShow(!isStandalone() && !recentlyHidden);
  }, []);
  if (!show) return null;
  return (
    <Banner
      className="md:hidden"
      actions={
        <>
          <Link href="/kurulum" className={linkBtn}>
            Nasıl?
          </Link>
          <button
            type="button"
            className="rounded-md px-2.5 py-1.5 text-ink-soft hover:bg-ink/5"
            onClick={() => {
              writeJSON(INSTALL_KEY, Date.now());
              setShow(false);
            }}
          >
            Kapat
          </button>
        </>
      }
    >
      Uygulamayı ana ekrana ekle: internetsiz de sorunsuz açılır ve verilerin telefonda kalıcı olur.
    </Banner>
  );
}

/** Oturum bitmişse uyarı */
export function SessionBanner() {
  const { user, hasSession } = useApp();
  const online = useOnline();
  if (!user || hasSession !== false || !online) return null;
  return (
    <Banner
      actions={
        <Link href="/giris" className={linkBtn}>
          Giriş yap
        </Link>
      }
    >
      Oturumun sona erdi. Değişikliklerin bu cihazda duruyor; diğer cihazlarınla eşlemek için tekrar giriş yap.
    </Banner>
  );
}

/** İlk indirme sürerken ilerleme çubuğu */
export function InitialSyncProgress() {
  const { engine } = useApp();
  const status = useSyncStatus(engine);
  if (status.initialSyncDone || status.phase !== "syncing" || !status.progress) return null;
  const { done, total, label } = status.progress;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-rule bg-surface px-4 py-3">
      <div>
        <div className="mb-1.5 flex justify-between text-sm">
          <span>{label}</span>
          <span className="tabular-nums text-ink-soft">
            {done} / {total}
          </span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-rule"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
