"use client";
// Örnek cümleler bölümü: istediğin kadar İngilizce cümle + isteğe bağlı
// Türkçe çeviri; ekle, sil, yukarı/aşağı taşı.
import type { ExampleDraft } from "@/lib/notes";

const inputCls =
  "block w-full rounded-md border border-rule bg-surface px-2.5 py-2 text-base focus:border-accent focus:outline-none";

export function ExamplesEditor({ value, onChange }: { value: ExampleDraft[]; onChange: (v: ExampleDraft[]) => void }) {
  const update = (i: number, patch: Partial<ExampleDraft>) => onChange(value.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold">Örnek cümleler</legend>
      {value.length === 0 && (
        <p className="mb-2 text-sm text-ink-soft">
          İstersen kelimeyi cümle içinde gösteren örnekler ekle; çalışırken her seferinde bunlardan biri görünür.
        </p>
      )}
      <ol className="space-y-2.5">
        {value.map((ex, i) => (
          <li key={ex.id ?? `new-${i}`} className="rounded-lg border border-rule bg-surface p-2.5">
            <div className="flex items-start gap-2">
              <span className="mt-2 w-5 shrink-0 text-right text-sm tabular-nums text-ink-soft">{i + 1}.</span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <textarea
                  aria-label={`${i + 1}. örnek cümle`}
                  rows={2}
                  value={ex.text}
                  onChange={(e) => update(i, { text: e.target.value })}
                  placeholder="İngilizce cümle"
                  className={inputCls}
                />
                <input
                  aria-label={`${i + 1}. cümlenin çevirisi`}
                  value={ex.translation ?? ""}
                  onChange={(e) => update(i, { translation: e.target.value })}
                  placeholder="Türkçe çeviri (isteğe bağlı)"
                  className={inputCls}
                />
              </div>
              <div className="flex shrink-0 flex-col">
                <button type="button" aria-label="Yukarı taşı" disabled={i === 0} onClick={() => move(i, -1)} className="grid size-8 place-items-center rounded text-ink-soft hover:bg-ink/5 disabled:opacity-30">↑</button>
                <button type="button" aria-label="Aşağı taşı" disabled={i === value.length - 1} onClick={() => move(i, 1)} className="grid size-8 place-items-center rounded text-ink-soft hover:bg-ink/5 disabled:opacity-30">↓</button>
                <button type="button" aria-label="Cümleyi sil" onClick={() => onChange(value.filter((_, j) => j !== i))} className="grid size-8 place-items-center rounded text-danger hover:bg-danger/10">×</button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => onChange([...value, { text: "", translation: null }])}
        className="mt-2 rounded-md px-2.5 py-1.5 text-sm font-semibold text-accent hover:bg-accent/10"
      >
        + Cümle ekle
      </button>
    </fieldset>
  );
}
