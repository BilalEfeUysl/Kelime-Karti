"use client";
// Her zaman görünen küçük senkron durum göstergesi.
// Tıklayınca hemen eşler (oturum bittiyse giriş sayfasına götürür).
import Link from "next/link";
import { useApp } from "./AppProvider";
import { useOnline, useOutboxCounts, useSyncStatus } from "./hooks";

type Tone = "ok" | "busy" | "wait" | "off" | "bad";

const DOT: Record<Tone, string> = {
  ok: "bg-ok",
  busy: "bg-accent animate-pulse",
  wait: "bg-warn",
  off: "bg-ink-soft",
  bad: "bg-danger",
};

/** compact: dar yan menüde sadece renkli nokta görünür (yazı, menü açılınca) */
export function SyncIndicator({ className: extra = "", compact = false }: { className?: string; compact?: boolean }) {
  const { engine } = useApp();
  const status = useSyncStatus(engine);
  const { pending, failed } = useOutboxCounts();
  const online = useOnline();

  let tone: Tone;
  let text: string;
  const waiting = pending > 0 ? `${pending} değişiklik bekliyor` : null;

  if (!online || status.phase === "offline") {
    tone = "off";
    text = waiting ? `İnternet yok • ${waiting}` : "İnternet yok";
  } else if (status.phase === "syncing") {
    tone = "busy";
    const p = status.progress;
    text = p && p.total > 0 ? `Eşleniyor… ${p.done}/${p.total}` : "Eşleniyor…";
  } else if (status.phase === "auth") {
    tone = "bad";
    text = "Eşlemek için giriş yap";
  } else if (status.phase === "error") {
    tone = "bad";
    text = "Eşlenemedi • tekrar dene";
  } else if (waiting) {
    tone = "wait";
    text = waiting;
  } else {
    tone = failed > 0 ? "wait" : "ok";
    text = failed > 0 ? `${failed} değişiklik gönderilemedi` : "Eşlendi";
  }

  const className = compact
    ? `inline-flex min-h-9 min-w-9 items-center justify-center gap-2 rounded-full border border-rule bg-surface text-[13px] font-medium text-ink sidebar-open:justify-start sidebar-open:px-3 ${extra}`
    : `inline-flex min-h-9 max-w-[60vw] items-center gap-2 rounded-full border border-rule bg-surface px-3 text-[13px] font-medium text-ink md:max-w-none ${extra}`;
  const content = (
    <>
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[tone]}`} />
      <span className={compact ? "sr-only truncate sidebar-open:not-sr-only" : "truncate"}>{text}</span>
    </>
  );

  if (status.phase === "auth") {
    return (
      <Link href="/giris" className={className} title={status.error ?? text}>
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={() => void engine?.sync()}
      title={status.error ?? (compact ? `${text} (tıkla: şimdi eşle)` : "Şimdi eşle")}
      aria-live="polite"
    >
      {content}
    </button>
  );
}
