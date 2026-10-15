"use client";
// KART EKLEME: not tipi ve deste seç, alanları doldur, etiket ve örnek
// cümle ekle. Ctrl/Cmd+Enter ile ekler. İnternetsiz de çalışır.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useUndo } from "@/components/app/undo";
import { useDeckList, useNoteTypes } from "@/components/app/data";
import { NoteForm } from "@/components/editor/NoteForm";
import { Button, Notice, SelectField } from "@/components/ui";
import { updateRow } from "@/lib/db/mutations";
import { addNote, type ExampleDraft } from "@/lib/notes";
import { defaultDeckId } from "@/lib/notetypes/builtins";
import { readJSON, writeJSON } from "@/lib/storage";
import { AskButton, AskPanel, PREFILL_KEY } from "@/components/ai/AskPanel";
import { escapeHtml, stripHtml } from "@/lib/text";
import { noteTypeLabel } from "@/lib/notetypes/labels";

const LAST_TYPE = "kk.add.noteType";
const LAST_DECK = "kk.add.deck";

export function AddNoteScreen() {
  const { db } = useApp();
  const undo = useUndo();
  const params = useSearchParams();
  const noteTypes = useNoteTypes();
  const decks = useDeckList();
  const [noteTypeId, setNoteTypeId] = useState<string>("");
  const [deckId, setDeckId] = useState<string>("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [tags, setTags] = useState<string[]>([]);
  const [examples, setExamples] = useState<ExampleDraft[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Varsayılan seçimler: adres çubuğundaki deste → son kullanılan → varsayılan
  useEffect(() => {
    if (!noteTypes?.length || noteTypeId) return;
    const last = readJSON<string>(LAST_TYPE);
    setNoteTypeId(noteTypes.find((n) => n.id === last)?.id ?? noteTypes.find((n) => n.name === "Basic")?.id ?? noteTypes[0].id);
  }, [noteTypes, noteTypeId]);
  useEffect(() => {
    if (!decks?.length || deckId || !db) return;
    const wanted = params.get("deste") ?? readJSON<string>(LAST_DECK) ?? defaultDeckId(db.userId);
    setDeckId(decks.find((d) => d.id === wanted)?.id ?? decks[0].id);
  }, [decks, deckId, params, db]);

  const noteType = useMemo(() => noteTypes?.find((n) => n.id === noteTypeId), [noteTypes, noteTypeId]);
  const [ask, setAsk] = useState(false);

  // Gemini panelindeki "Bundan kart oluştur": ilk iki alanı ve örnekleri doldur
  useEffect(() => {
    if (!noteType || params.get("doldur") !== "1") return;
    const pre = readJSON<{ front: string; back: string; examples: ExampleDraft[] }>(PREFILL_KEY);
    if (!pre) return;
    writeJSON(PREFILL_KEY, null);
    const [f1, f2] = noteType.fields;
    setFields((cur) => ({ ...cur, ...(f1 ? { [f1.id]: escapeHtml(pre.front) } : {}), ...(f2 ? { [f2.id]: escapeHtml(pre.back) } : {}) }));
    setExamples(pre.examples ?? []);
    setResetKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteType?.id, params]);

  const changeType = (id: string) => {
    const next = noteTypes?.find((n) => n.id === id);
    if (!next || !noteType) return setNoteTypeId(id);
    // Aynı adlı alanların içeriğini koru
    const byName = new Map(noteType.fields.map((f) => [f.name, fields[f.id] ?? ""]));
    setFields(Object.fromEntries(next.fields.map((f) => [f.id, byName.get(f.name) ?? ""])));
    setNoteTypeId(id);
    setResetKey((k) => k + 1);
  };

  const submit = async (tagsNow: string[] = tags) => {
    if (!db || !noteType || !deckId || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const { cards } = await undo.run("Not ekleme", () => addNote(db, { noteType, deckId, fields, tags: tagsNow, examples }));
      writeJSON(LAST_TYPE, noteType.id);
      writeJSON(LAST_DECK, deckId);
      // Yapışkan alanlar dışındakileri temizle; etiketler kalır (Anki'deki gibi)
      setFields(Object.fromEntries(noteType.fields.filter((f) => f.sticky).map((f) => [f.id, fields[f.id] ?? ""])));
      setExamples([]);
      setResetKey((k) => k + 1);
      setMessage({ tone: "ok", text: `Eklendi (${cards.length} kart).` });
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!noteTypes || !decks) return null;
  if (!noteTypes.length) {
    return <Notice tone="info">Not tipleri hazırlanıyor… İlk eşleme bitince burada görünecek.</Notice>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-[28px] font-semibold leading-tight">Kart ekle</h1>
        {noteType && stripHtml(fields[noteType.fields[0]?.id ?? ""] ?? "").trim() && <AskButton onClick={() => setAsk(true)} />}
      </div>
      {ask && noteType && (
        <AskPanel
          target={{ word: stripHtml(fields[noteType.fields[0]?.id ?? ""] ?? "").trim(), meaning: stripHtml(fields[noteType.fields[1]?.id ?? ""] ?? "") }}
          onClose={() => setAsk(false)}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Not tipi"
          value={noteTypeId}
          onChange={changeType}
          options={noteTypes.map((n) => ({ value: n.id, label: noteTypeLabel(n.name) }))}
        />
        <SelectField
          label="Deste"
          value={deckId}
          onChange={setDeckId}
          options={decks.map((d) => ({ value: d.id, label: d.name }))}
        />
      </div>

      {noteType && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-5"
        >
          <NoteForm
            noteType={noteType}
            fields={fields}
            onFieldsChange={setFields}
            tags={tags}
            onTagsChange={setTags}
            examples={examples}
            onExamplesChange={setExamples}
            onSubmitShortcut={(t) => void submit(t)}
            resetKey={resetKey}
            onToggleSticky={(fid) =>
              void updateRow(db!, "note_types", noteType.id, {
                fields: noteType.fields.map((f) => (f.id === fid ? { ...f, sticky: !f.sticky } : f)),
              })
            }
          />
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          <div className="sticky bottom-20 z-10 flex items-center gap-3 rounded-xl border border-rule bg-paper/95 p-2 backdrop-blur md:bottom-4">
            <Button type="submit" disabled={busy} className="flex-1 sm:flex-none">
              Ekle
            </Button>
            <span className="hidden text-sm text-ink-soft sm:inline">Kısayol: Ctrl/Cmd + Enter</span>
            <Link href="/" className="ml-auto rounded-md px-3 py-2 text-sm text-ink-soft hover:text-ink">
              Destelere dön
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
