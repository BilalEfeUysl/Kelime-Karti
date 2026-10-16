"use client";
// Ayarlar → Görünüm: kart yazı boyutu, ölçek, koyu modda kart renkleri, sade çalışma,
// çalışma kısayollarını değiştirme. Bu cihaza özeldir.
import { useEffect, useState } from "react";
import { SelectField } from "@/components/ui";
import { ACTION_LABELS, DEFAULT_SHORTCUTS, keyLabel, setAppearance, type StudyAction, useAppearance } from "@/lib/appearance";

const RESERVED = new Set(["Enter", "?", "Escape", "Tab"]);

export function AppearanceSettings() {
  const a = useAppearance();
  const [capture, setCapture] = useState<StudyAction | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Yeni tuşu yakala
  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setCapture(null);
      if (e.ctrlKey || e.metaKey || e.altKey || RESERVED.has(e.key) || (e.key.length > 1 && e.key !== " ")) {
        setMsg("Bu tuş kullanılamaz (Ctrl/Alt'lı tuşlar, Enter, ? ve Esc ayrılmış). Tek bir tuşa bas.");
        return;
      }
      const clash = (Object.entries(a.shortcuts) as [StudyAction, string][]).find(([act, k]) => act !== capture && k.toLowerCase() === e.key.toLowerCase());
      const next = { ...a.shortcuts, [capture]: e.key };
      if (clash) next[clash[0]] = a.shortcuts[capture]; // yer değiştir
      setAppearance({ shortcuts: next });
      setMsg(clash ? `“${keyLabel(e.key)}” ${ACTION_LABELS[clash[0]]} için kullanılıyordu; ikisi yer değiştirdi.` : null);
      setCapture(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capture, a.shortcuts]);

  return (
    <div id="gorunum" className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Kart yazı boyutu"
          value={String(a.fontScale)}
          onChange={(v) => setAppearance({ fontScale: Number(v) })}
          options={[0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6].map((x) => ({ value: String(x), label: `%${Math.round(x * 100)}` }))}
        />
        <SelectField
          label="Kart ölçeği (resimler dahil)"
          value={String(a.cardZoom)}
          onChange={(v) => setAppearance({ cardZoom: Number(v) })}
          options={[0.8, 0.9, 1, 1.1, 1.25, 1.5].map((x) => ({ value: String(x), label: `%${Math.round(x * 100)}` }))}
        />
        <SelectField
          label="Koyu temada kartlar"
          value={a.darkCards}
          onChange={(v) => setAppearance({ darkCards: v as typeof a.darkCards })}
          options={[
            { value: "auto", label: "Kartın kendi koyu stili" },
            { value: "force", label: "Her zaman koyu zemin (beyaz kartları da kararttır)" },
            { value: "off", label: "Kartlar açık renk kalsın" },
          ]}
        />
      </div>
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" className="mt-0.5 size-4" checked={a.minimal} onChange={(e) => setAppearance({ minimal: e.target.checked })} />
        <span>
          Sade çalışma modu
          <span className="block text-ink-soft">Çalışırken sayılar ve işlem düğmeleri gizlenir; sadece kart ve cevap düğmeleri kalır.</span>
        </span>
      </label>

      <details className="group">
        <summary className="cursor-pointer text-sm font-semibold">Klavye kısayollarını değiştir</summary>
        <ul className="mt-2 divide-y divide-rule rounded-lg border border-rule text-sm">
          {(Object.keys(ACTION_LABELS) as StudyAction[]).map((act) => (
            <li key={act} className="flex items-center gap-2 px-3 py-1.5">
              <span className="flex-1">{ACTION_LABELS[act]}</span>
              <button
                type="button"
                onClick={() => {
                  setMsg(null);
                  setCapture(capture === act ? null : act);
                }}
                className="min-w-20 rounded-md border border-rule bg-surface px-2 py-1 font-mono text-xs aria-pressed:border-accent aria-pressed:bg-accent/10"
                aria-pressed={capture === act}
              >
                {capture === act ? "tuşa bas…" : keyLabel(a.shortcuts[act])}
              </button>
            </li>
          ))}
        </ul>
        {msg && <p className="mt-1.5 text-sm text-warn">{msg}</p>}
        <button type="button" onClick={() => setAppearance({ shortcuts: DEFAULT_SHORTCUTS })} className="mt-2 text-sm text-accent underline">
          Varsayılan kısayollara dön
        </button>
      </details>
    </div>
  );
}
