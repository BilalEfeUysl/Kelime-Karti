"use client";
// Çalışırken notu düzenleme penceresi (E tuşu)
import { useEffect, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useUndo } from "@/components/app/undo";
import { NoteForm } from "@/components/editor/NoteForm";
import { Button, Modal, Notice } from "@/components/ui";
import type { NoteRow, NoteTypeRow } from "@/lib/db/types";
import { approvedExamples, type ExampleDraft, saveExamples, updateNote } from "@/lib/notes";

export function EditNoteModal({ note, noteType, onClose }: { note: NoteRow; noteType: NoteTypeRow; onClose: () => void }) {
  const { db } = useApp();
  const undo = useUndo();
  const [fields, setFields] = useState(note.fields);
  const [tags, setTags] = useState(note.tags);
  const [examples, setExamples] = useState<ExampleDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db) return;
    void approvedExamples(db, note.id).then((rows) =>
      setExamples(rows.map((e) => ({ id: e.id, text: e.text, translation: e.translation }))),
    );
  }, [db, note.id]);

  const save = async (tagsNow: string[] = tags) => {
    if (!db || !examples) return;
    try {
      await undo.run("Not düzenleme", async () => {
        await updateNote(db, note.id, { fields, tags: tagsNow });
        await saveExamples(db, note.id, examples);
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal title="Notu düzenle" onClose={onClose}>
      {examples && (
        <div className="space-y-4">
          <NoteForm
            noteType={noteType}
            fields={fields}
            onFieldsChange={setFields}
            tags={tags}
            onTagsChange={setTags}
            examples={examples}
            onExamplesChange={setExamples}
            onSubmitShortcut={(t) => void save(t)}
            noteId={note.id}
            toolbarClassName="top-[58px]"
          />
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex gap-2">
            <Button onClick={() => void save()}>Kaydet</Button>
            <Button variant="ghost" onClick={onClose}>
              Vazgeç
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
