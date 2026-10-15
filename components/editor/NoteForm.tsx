"use client";
// Not formu: araç çubuğu + alanlar + etiketler + örnek cümleler.
// "Kart ekle" ekranında, çalışırken düzenleme penceresinde ve kart tarayıcıda kullanılır.
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import type { NoteTypeRow } from "@/lib/db/types";
import type { ExampleDraft } from "@/lib/notes";
import { stripHtml } from "@/lib/text";
import { maxClozeNumber, wrapCloze } from "./commands";
import { EditorToolbar } from "./EditorToolbar";
import { ExamplesEditor } from "./ExamplesEditor";
import { FieldEditor } from "./FieldEditor";
import { OcclusionEditor } from "./OcclusionEditor";
import { TagInput } from "./TagInput";
import { fieldLabel } from "@/lib/notetypes/labels";

interface Props {
  noteType: NoteTypeRow;
  fields: Record<string, string>;
  onFieldsChange: (fields: Record<string, string>) => void;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  examples: ExampleDraft[];
  onExamplesChange: (examples: ExampleDraft[]) => void;
  /** Ctrl/Cmd+Enter; etiket kutusundan gelirse güncel etiketlerle */
  onSubmitShortcut?: (tags?: string[]) => void;
  /** Formu sıfırlamak için değiştirilen anahtar */
  resetKey?: number;
  /** Yapışkan alan düğmeleri (kart ekleme ekranı) */
  onToggleSticky?: (fieldId: string) => void;
  /** Kopya kontrolünde bu not hariç tutulur (düzenlerken) */
  noteId?: string;
  /** Araç çubuğunun yapışacağı üst boşluk (sayfa başlığının altı) */
  toolbarClassName?: string;
  /** İlk alana otomatik odaklan (kart tarayıcıda kapalı: tablo klavyesi bozulmasın) */
  autoFocus?: boolean;
}

export function NoteForm(p: Props) {
  const { db } = useApp();
  const [active, setActive] = useState<string | null>(p.noteType.fields[0]?.id ?? null);
  const [htmlFields, setHtmlFields] = useState<Set<string>>(new Set());
  const isCloze = p.noteType.kind === "cloze";
  const isIo = p.noteType.kind === "image_occlusion";
  const ioImage = isIo ? p.noteType.fields.find((f) => f.name === "Image") : undefined;
  const ioOcc = isIo ? p.noteType.fields.find((f) => f.name === "Occlusion") : undefined;

  // Kopya uyarısı: aynı not tipinde ilk alanı aynı olan başka not var mı
  const firstField = p.noteType.fields[0];
  const firstText = useDeferredValue(firstField ? stripHtml(p.fields[firstField.id] ?? "").trim() : "");
  const sameType = useLiveQuery(
    async () => (db ? db.notes.where("note_type_id").equals(p.noteType.id).toArray() : []),
    [db, p.noteType.id],
  );
  const dupes = useMemo(() => {
    if (!firstField || !firstText || !sameType || p.noteType.kind === "image_occlusion") return 0;
    const want = firstText.toLocaleLowerCase("tr");
    return sameType.filter(
      (n) => n.deleted_at === null && n.id !== p.noteId && stripHtml(n.fields[firstField.id] ?? "").trim().toLocaleLowerCase("tr") === want,
    ).length;
  }, [firstField, firstText, sameType, p.noteId]);

  const cloze = (same: boolean) => {
    const max = maxClozeNumber(Object.values(p.fields));
    wrapCloze(same ? Math.max(1, max) : max + 1);
  };

  const toggleHtml = () => {
    if (!active) return;
    setHtmlFields((prev) => {
      const next = new Set(prev);
      if (next.has(active)) next.delete(active);
      else next.add(active);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <EditorToolbar
        htmlMode={!!active && htmlFields.has(active)}
        onToggleHtml={toggleHtml}
        cloze={isCloze ? { onNew: () => cloze(false), onSame: () => cloze(true) } : undefined}
        disabled={!active}
        className={`sticky z-10 ${p.toolbarClassName ?? "top-[calc(var(--top-offset)+0.5rem)]"}`}
      />
      {isCloze && (
        <p className="rounded-lg bg-accent/5 px-3 py-2 text-sm text-ink-soft">
          Boşluk yapmak istediğin yeri seçip <kbd>Alt+C</kbd>'ye bas (aynı numara için <kbd>Alt+Shift+C</kbd>) ya da{" "}
          <code>{"{{c1::kelime}}"}</code> şeklinde yaz. İpucu: <code>{"{{c1::kelime::ipucu}}"}</code>
        </p>
      )}
      {isIo && ioImage && ioOcc && (
        <OcclusionEditor
          image={p.fields[ioImage.id] ?? ""}
          occlusion={p.fields[ioOcc.id] ?? ""}
          onChange={(image, occ) => p.onFieldsChange({ ...p.fields, [ioImage.id]: image, [ioOcc.id]: occ })}
        />
      )}
      {p.noteType.fields.filter((f) => !isIo || (f.id !== ioImage?.id && f.id !== ioOcc?.id)).map((f, i) => (
        <FieldEditor
          key={`${p.noteType.id}-${f.id}-${p.resetKey ?? 0}`}
          label={fieldLabel(f.name)}
          value={p.fields[f.id] ?? ""}
          autoFocus={i === 0 && p.autoFocus !== false}
          htmlMode={htmlFields.has(f.id)}
          onFocus={() => setActive(f.id)}
          onChange={(html) => p.onFieldsChange({ ...p.fields, [f.id]: html })}
          onSubmitShortcut={p.onSubmitShortcut && (() => p.onSubmitShortcut?.())}
          onCloze={isCloze ? cloze : undefined}
          sticky={p.onToggleSticky ? { on: !!f.sticky, toggle: () => p.onToggleSticky!(f.id) } : undefined}
          warning={
            i === 0 && dupes > 0 ? (
              <p role="status" className="mt-1 text-sm text-warn">
                Aynı “{fieldLabel(firstField.name)}” ile {dupes} not daha var.{" "}
                <Link
                  className="font-medium underline"
                  href={`/kartlar?q=${encodeURIComponent(`"dupe:${p.noteType.id},${firstText.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)}`}
                >
                  Göster
                </Link>
              </p>
            ) : undefined
          }
        />
      ))}
      <TagInput value={p.tags} onChange={p.onTagsChange} onSubmitShortcut={p.onSubmitShortcut} />
      <ExamplesEditor value={p.examples} onChange={p.onExamplesChange} />
    </div>
  );
}
