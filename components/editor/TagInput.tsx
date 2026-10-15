"use client";
// Etiket kutusu: boşlukla ayrılmış etiketler + var olan etiketlerden öneriler
import { useMemo, useState } from "react";
import { useAllTags } from "@/components/app/data";

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Ctrl/Cmd+Enter: yazılmakta olan etiket de eklenmiş listeyle çağrılır */
  onSubmitShortcut?: (tags: string[]) => void;
}

export function TagInput({ value, onChange, onSubmitShortcut }: Props) {
  const all = useAllTags();
  const [draft, setDraft] = useState("");

  const suggestions = useMemo(() => {
    const q = draft.trim().toLocaleLowerCase("tr");
    if (!q) return [];
    const have = new Set(value.map((t) => t.toLocaleLowerCase("tr")));
    return all.filter((t) => t.toLocaleLowerCase("tr").startsWith(q) && !have.has(t.toLocaleLowerCase("tr"))).slice(0, 6);
  }, [draft, all, value]);

  const add = (raw: string): string[] => {
    const parts = raw.split(/\s+/).filter(Boolean);
    if (!parts.length) return value;
    const lower = new Set(value.map((t) => t.toLocaleLowerCase("tr")));
    const next = [...value, ...parts.filter((p) => !lower.has(p.toLocaleLowerCase("tr")))];
    onChange(next);
    setDraft("");
    return next;
  };

  return (
    <div>
      <label htmlFor="tag-input" className="mb-1.5 block text-sm font-semibold">
        Etiketler
      </label>
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border border-rule bg-surface px-2 py-1.5 focus-within:border-accent">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-sm">
            {t}
            <button
              type="button"
              aria-label={`${t} etiketini kaldır`}
              className="text-ink-soft hover:text-danger"
              onClick={() => onChange(value.filter((x) => x !== t))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id="tag-input"
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            if (/\s$/.test(v)) add(v);
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && onSubmitShortcut) {
              e.preventDefault();
              onSubmitShortcut(add(draft));
            } else if (e.key === "Enter" && draft.trim()) {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={value.length ? "" : "ör. yds fiil"}
          autoComplete="off"
          autoCapitalize="off"
          className="min-w-24 flex-1 bg-transparent px-1 py-1 text-base outline-none"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(s)}
              className="rounded-md border border-rule bg-surface px-2 py-1 text-sm hover:border-accent"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
