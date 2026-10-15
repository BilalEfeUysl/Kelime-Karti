"use client";
// KART TARAYICI SAĞ PANELİ: seçili notu düzenle / kartı önizle / kart bilgisi
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useOptionsResolver } from "@/components/app/data";
import { useUndo } from "@/components/app/undo";
import { CardFrame } from "@/components/card/CardFrame";
import { NoteForm } from "@/components/editor/NoteForm";
import { CardInfoModal } from "@/components/study/CardInfoModal";
import { Button, Notice } from "@/components/ui";
import type { CardRow, DeckRow, NoteRow, NoteTypeRow } from "@/lib/db/types";
import { resolveMediaInHtml } from "@/lib/media-url";
import { approvedExamples, type ExampleDraft, saveExamples, updateNote } from "@/lib/notes";
import { renderCard } from "@/lib/template/render";
import { AskButton, AskPanel } from "@/components/ai/AskPanel";
import { noteWord } from "@/lib/ai/local";
import { stripHtml } from "@/lib/text";
import { noteTypeLabel } from "@/lib/notetypes/labels";

function useNight(): boolean {
  const [night, setNight] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setNight(root.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return night;
}

export function CardPreview({ card, note, noteType, deckName }: { card: CardRow; note: NoteRow; noteType: NoteTypeRow; deckName: string }) {
  const { db, media } = useApp();
  const night = useNight();
  const [side, setSide] = useState<"question" | "answer">("question");
  const examples = useLiveQuery(async () => (db ? approvedExamples(db, note.id) : []), [db, note.id, note.updated_at]);
  const rendered = useMemo(() => {
    if (!examples) return null;
    try {
      return renderCard(
        { noteType, note, cardOrd: card.ord, deckName, flags: card.flags, examples, chosenExampleId: examples[0]?.id ?? null },
        { typed: "" },
      );
    } catch (err) {
      return { error: (err as Error).message };
    }
  }, [card.ord, card.flags, note, noteType, deckName, examples]);
  const [html, setHtml] = useState<{ key: string; value: string } | null>(null);
  const key = `${card.id}:${side}:${note.updated_at}:${noteType.updated_at}:${examples?.length ?? 0}`;

  useEffect(() => {
    if (!rendered || "error" in rendered || !db) return;
    let cancelled = false;
    void resolveMediaInHtml(side === "question" ? rendered.question : rendered.answer, db, media).then((v) => {
      if (!cancelled) setHtml({ key, value: v });
    });
    return () => {
      cancelled = true;
    };
  }, [rendered, side, db, media, key]);

  if (rendered && "error" in rendered) return <Notice tone="error">Şablon hatası: {rendered.error}</Notice>;
  return (
    <div>
      <div className="mb-2 flex gap-1 text-sm" role="tablist">
        {(["question", "answer"] as const).map((s) => (
          <button
            key={s}
            role="tab"
            type="button"
            aria-selected={side === s}
            onClick={() => setSide(s)}
            className="rounded-md px-2.5 py-1 text-ink-soft hover:text-ink aria-selected:bg-accent/15 aria-selected:text-ink"
          >
            {s === "question" ? "Soru" : "Cevap"}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-rule bg-surface">
        {html?.key === key && rendered && !("error" in rendered) ? (
          <CardFrame html={html.value} css={rendered.css} cardOrd={card.ord} night={night} minHeight={140} />
        ) : (
          <div style={{ height: 140 }} />
        )}
      </div>
    </div>
  );
}

function InlineEditor({ note, noteType, onSaved }: { note: NoteRow; noteType: NoteTypeRow; onSaved?: () => void }) {
  const { db } = useApp();
  const undo = useUndo();
  const [fields, setFields] = useState(note.fields);
  const [tags, setTags] = useState(note.tags);
  const [examples, setExamples] = useState<ExampleDraft[] | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const dirty = JSON.stringify(fields) !== JSON.stringify(note.fields) || JSON.stringify(tags) !== JSON.stringify(note.tags);
  const [examplesDirty, setExamplesDirty] = useState(false);

  useEffect(() => {
    if (!db) return;
    void approvedExamples(db, note.id).then((rows) => setExamples(rows.map((e) => ({ id: e.id, text: e.text, translation: e.translation }))));
  }, [db, note.id]);

  const save = async (tagsNow: string[] = tags) => {
    if (!db || !examples) return;
    try {
      await undo.run("Not düzenleme", async () => {
        await updateNote(db, note.id, { fields, tags: tagsNow });
        await saveExamples(db, note.id, examples);
      });
      setExamplesDirty(false);
      setMessage({ tone: "ok", text: "Kaydedildi." });
      onSaved?.();
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    }
  };

  if (!examples) return null;
  return (
    <div className="space-y-3">
      <NoteForm
        noteType={noteType}
        fields={fields}
        onFieldsChange={(f) => {
          setFields(f);
          setMessage(null);
        }}
        tags={tags}
        onTagsChange={setTags}
        examples={examples}
        onExamplesChange={(e) => {
          setExamples(e);
          setExamplesDirty(true);
        }}
        onSubmitShortcut={(t) => void save(t)}
        noteId={note.id}
        toolbarClassName="top-0"
        autoFocus={false}
      />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="sticky bottom-0 flex items-center gap-2 bg-paper/95 py-2">
        <Button onClick={() => void save()} disabled={!dirty && !examplesDirty}>
          Kaydet
        </Button>
        <span className="text-xs text-ink-soft">Ctrl/Cmd + Enter</span>
      </div>
    </div>
  );
}

export function DetailPanel({
  card,
  note,
  noteType,
  deckName,
  decks,
}: {
  card: CardRow;
  note: NoteRow;
  noteType: NoteTypeRow | undefined;
  deckName: string;
  decks: DeckRow[];
}) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [info, setInfo] = useState(false);
  const [ask, setAsk] = useState(false);
  const optionsFor = useOptionsResolver(decks);
  if (!noteType) return <Notice tone="error">Bu notun tipi bulunamadı.</Notice>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 text-sm" role="tablist">
        {(
          [
            ["edit", "Düzenle"],
            ["preview", "Önizleme"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className="rounded-md px-3 py-1.5 font-medium text-ink-soft hover:text-ink aria-selected:bg-surface aria-selected:text-ink aria-selected:shadow-sm"
          >
            {label}
          </button>
        ))}
        <button type="button" onClick={() => setInfo(true)} className="ml-auto rounded-md px-3 py-1.5 text-ink-soft hover:bg-ink/5 hover:text-ink">
          Kart bilgisi
        </button>
        <AskButton onClick={() => setAsk(true)} />
      </div>
      {tab === "edit" ? (
        <InlineEditor key={`${note.id}:${note.updated_at}`} note={note} noteType={noteType} />
      ) : (
        <CardPreview card={card} note={note} noteType={noteType} deckName={deckName} />
      )}
      {ask && (
        <AskPanel
          target={{
            ...noteWord(note, noteType),
            noteId: note.id,
            context: noteType.fields.map((f) => `${f.name}: ${stripHtml(note.fields[f.id] ?? "")}`).join("\n"),
          }}
          onClose={() => setAsk(false)}
        />
      )}
      {info && optionsFor && (
        <CardInfoModal card={card} deckName={deckName} noteTypeName={noteTypeLabel(noteType.name)} options={optionsFor(card.deck_id)} onClose={() => setInfo(false)} />
      )}
    </div>
  );
}
