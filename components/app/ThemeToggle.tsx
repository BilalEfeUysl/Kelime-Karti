"use client";
// Açık / koyu tema düğmesi: açıkken ay (koyuya geç), koyuyken güneş (açığa geç).
// Tercih bu cihazda saklanır.
import { useEffect, useState } from "react";
import { setThemePref } from "@/lib/theme";

/** Sayfa şu an koyu temada mı? (tema değişince güncellenir) */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const dark = useIsDark();
  const label = dark ? "Açık temaya geç" : "Koyu temaya geç";
  return (
    <button
      type="button"
      onClick={() => setThemePref(dark ? "light" : "dark")}
      title={label}
      aria-label={label}
      className={`grid size-9 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-ink/5 hover:text-ink ${className}`}
    >
      {dark ? (
        // Güneş
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
        </svg>
      ) : (
        // Ay
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        </svg>
      )}
    </button>
  );
}
