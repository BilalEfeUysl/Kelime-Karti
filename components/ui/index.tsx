"use client";
// Küçük, tekrar kullanılan arayüz parçaları (buton, metin kutusu, bölüm, uyarı).
import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-strong",
  secondary: "bg-surface text-ink border border-rule hover:border-ink-soft",
  ghost: "text-accent hover:bg-accent/10",
  danger: "bg-danger text-white hover:opacity-90 dark:text-paper",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function TextField({
  label,
  hint,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      <input
        className="block min-h-11 w-full rounded-lg border border-rule bg-surface px-3 text-base text-ink placeholder:text-ink-soft/70 focus:border-accent focus:outline-none"
        {...props}
      />
      {hint && <span className="mt-1 block text-sm text-ink-soft">{hint}</span>}
    </label>
  );
}

export function Section({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-rule bg-surface p-4 sm:p-5 ${className}`}>
      {title && <h2 className="mb-3 font-display text-lg font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "ok" | "warn";
  children: ReactNode;
}) {
  const tones = {
    info: "border-accent/30 bg-accent/5",
    error: "border-danger/40 bg-danger/5 text-danger",
    ok: "border-ok/40 bg-ok/5",
    warn: "border-warn/40 bg-warn/10",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-3 py-2.5 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

/** Anahtar-değer satırı (Ayarlar ekranındaki bilgiler için) */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule py-2 last:border-b-0">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{children}</dd>
    </div>
  );
}

export function Spinner({ label = "Yükleniyor…" }: { label?: string }) {
  return (
    <div className="flex min-h-[40dvh] items-center justify-center text-ink-soft" role="status">
      {label}
    </div>
  );
}

/** Açılır pencere (telefonda alttan çıkar, bilgisayarda ortada) */
/** Açık pencereler (en sondaki en üstte) */
const openModals: object[] = [];

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Esc her yerden kapatır (iç içe pencerelerde sadece en üstteki); açılınca
  // odak pencereye taşınır (içeride kendiliğinden odaklanan bir alan yoksa)
  useEffect(() => {
    const token = {};
    openModals.push(token);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openModals[openModals.length - 1] === token) {
        e.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    const el = dialogRef.current;
    if (el && !el.contains(document.activeElement)) el.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      openModals.splice(openModals.indexOf(token), 1);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-rule bg-paper pb-safe outline-none sm:rounded-2xl ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-rule bg-paper px-4 py-3">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-md text-ink-soft hover:bg-ink/5"
            aria-label="Kapat"
          >
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

/** Basit seçim kutusu */
export function SelectField({
  label,
  value,
  onChange,
  options,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block min-h-11 w-full rounded-lg border border-rule bg-surface px-3 text-base text-ink focus:border-accent focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Açılır menü. Menü sayfanın en üstünde (portal) ve ekrana sabit konumda
 * çizilir: kutuların kenarında kesilmez, altta yer yoksa yukarı açılır,
 * ekranın sağından/solundan taşmaz. Dışarı tıklayınca ya da Esc'ye basınca
 * kapanır.
 */
export function Dropdown({
  trigger,
  children,
  align = "right",
  width = 224,
  label,
  className = "",
}: {
  /** Düğmenin içeriği */
  trigger: ReactNode;
  /** Menünün içeriği; close() ile kapatılır */
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  width?: number;
  /** Ekran okuyucu için düğme adı */
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const place = () => {
      const r = btnRef.current!.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(width, vw - 16);
      let left = align === "right" ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      // Telefonda alttaki menü / cevap çubuğu (~60-80px + güvenli alan) da hesaba katılır
      const bottomReserve = vw < 768 ? 96 : 8;
      const below = vh - r.bottom - bottomReserve;
      const above = r.top - 8;
      if (below >= 240 || below >= above) setPos({ left, top: r.bottom + 4, maxHeight: Math.max(120, below - 4) });
      else setPos({ left, bottom: vh - r.top + 4, maxHeight: Math.max(120, above - 4) });
    };
    place();
    // Sayfa kayarsa menü düğmenin yanında kalsın (menünün kendi içindeki kaydırma hariç)
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && document.getElementById("kk-dropdown")?.contains(e.target)) return;
      place();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, align, width]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className={className}
      >
        {trigger}
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[60]" onMouseDown={close} onTouchStart={close} aria-hidden />
            <div
              id="kk-dropdown"
              role="menu"
              className="fixed z-[61] overflow-y-auto rounded-lg border border-rule bg-surface p-1 text-ink shadow-lg"
              style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: Math.min(width, window.innerWidth - 16), maxHeight: pos.maxHeight }}
            >
              {children(close)}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

/** Dropdown içindeki bir satır */
export function MenuItem({ onClick, children, danger }: { onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-ink/5 ${danger ? "text-danger" : ""}`}
    >
      {children}
    </button>
  );
}
