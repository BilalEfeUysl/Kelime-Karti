"use client";
// KART TARAYICI TOPLU İŞLEMLERİ: seçili kartlar/notlar için çubuk ve pencereler.
// Her işlem geri alınabilir (Ctrl/Cmd+Z).
import { type ReactNode, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/app/AppProvider";
import { AI_SELECTION_KEY } from "@/lib/ai/local";
import { writeJSON } from "@/lib/storage";
import { useDayInfo, useDeckList } from "@/components/app/data";
import { useUndo } from "@/components/app/undo";
import { TagInput } from "@/components/editor/TagInput";
import { Button, Modal, Notice, SelectField, TextField } from "@/components/ui";
import {
  addTags,
  changeDeck,
  changeNoteType,
  findDuplicates,
  findReplace,
  forgetCards,
  removeTags,
  repositionNew,
  setDueDate,
} from "@/lib/browse/ops";
import type { CardRow, NoteRow, NoteTypeRow } from "@/lib/db/types";
import { createDeckPath } from "@/lib/decks";
import { FLAG_COLORS, FLAG_NAMES } from "@/lib/flags";
import { deleteNotes } from "@/lib/notes";
import { buryCards, setFlag, setSuspended, unburyCards } from "@/lib/study/actions";
import { fieldLabel, noteTypeLabel } from "@/lib/notetypes/labels";

export interface Selection {
  cards: CardRow[];
  notes: NoteRow[];
}

type DialogId = "deck" | "addTags" | "removeTags" | "noteType" | "findReplace" | "reposition" | "due" | "forget" | "delete" | "dupes";

interface Props {
  selection: Selection;
  noteTypes: NoteTypeRow[];
  allNotes: NoteRow[];
  onDone: (message: string) => void;
  onSearch: (q: string) => void;
}

function MenuButton({ label, children }: { label: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="rounded-md px-2.5 py-1.5 text-sm font-medium text-ink-soft hover:bg-ink/5 hover:text-ink"
      >
        {label} ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div role="menu" className="absolute left-0 top-full z-40 mt-1 min-w-52 rounded-lg border border-rule bg-surface p-1 shadow-lg">
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ onClick, children, danger }: { onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-ink/5 ${danger ? "text-danger" : ""}`}
    >
      {children}
    </button>
  );
}

export function BulkActions({ selection, noteTypes, allNotes, onDone, onSearch }: Props) {
  const { db } = useApp();
  const undo = useUndo();
  const router = useRouter();
  const { day } = useDayInfo();
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const cardIds = useMemo(() => selection.cards.map((c) => c.id), [selection.cards]);
  const noteIds = useMemo(() => selection.notes.map((n) => n.id), [selection.notes]);
  const n = selection.cards.length;
  const has = n > 0;
  const allSuspended = has && selection.cards.every((c) => c.suspended);
  const anyBuried = selection.cards.some((c) => c.buried_until && c.buried_until > Date.now());

  const run = async (label: string, fn: () => Promise<unknown>, done: string) => {
    if (!db) return;
    try {
      await undo.run(label, async () => {
        await fn();
      });
      onDone(done);
      setDialog(null);
    } catch (err) {
      onDone(`Hata: ${(err as Error).message}`);
    }
  };

  if (!db) return null;
  const close = () => setDialog(null);

  return (
    <>
      <div className="flex flex-wrap items-center gap-0.5">
        <MenuButton label="Kartlar">
          {(c) => (
            <>
              <MenuItem onClick={() => (c(), setDialog("deck"))}>Deste değiştir…</MenuItem>
              <MenuItem onClick={() => (c(), void run(allSuspended ? "Askıdan çıkarma" : "Askıya alma", () => setSuspended(db, cardIds, !allSuspended), allSuspended ? `${n} kart askıdan çıkarıldı` : `${n} kart askıya alındı`))}>
                {allSuspended ? "Askıdan çıkar" : "Askıya al"}
              </MenuItem>
              <MenuItem
                onClick={() => (
                  c(),
                  void run(anyBuried ? "Ertelemeyi kaldırma" : "Erteleme", () => (anyBuried ? unburyCards(db, cardIds) : buryCards(db, cardIds, day.nextDayStart)), anyBuried ? "Erteleme kaldırıldı" : `${n} kart yarına ertelendi`)
                )}
              >
                {anyBuried ? "Ertelemeyi kaldır" : "Yarına ertele"}
              </MenuItem>
              <MenuItem onClick={() => (c(), setDialog("due"))}>Tarih ata…</MenuItem>
              <MenuItem onClick={() => (c(), setDialog("reposition"))}>Yeni kartları yeniden sırala…</MenuItem>
              <MenuItem onClick={() => (c(), setDialog("forget"))}>Unut (yeni karta çevir)…</MenuItem>
            </>
          )}
        </MenuButton>
        <MenuButton label="Notlar">
          {(c) => (
            <>
              <MenuItem onClick={() => (c(), setDialog("addTags"))}>Etiket ekle…</MenuItem>
              <MenuItem onClick={() => (c(), setDialog("removeTags"))}>Etiket çıkar…</MenuItem>
              <MenuItem onClick={() => (c(), setDialog("findReplace"))}>Bul ve değiştir…</MenuItem>
              <MenuItem onClick={() => (c(), setDialog("noteType"))}>Not tipini değiştir…</MenuItem>
              <MenuItem
                onClick={() => {
                  c();
                  writeJSON(AI_SELECTION_KEY, noteIds);
                  router.push("/ornek-cumleler?secim=1");
                }}
              >
                Gemini ile örnek cümle üret…
              </MenuItem>
              <MenuItem onClick={() => (c(), setDialog("delete"))} danger>
                Notları sil…
              </MenuItem>
            </>
          )}
        </MenuButton>
        <MenuButton label="Bayrak">
          {(c) => (
            <>
              {FLAG_NAMES.map((name, i) => (
                <MenuItem key={i} onClick={() => (c(), void run("Bayrak", () => setFlag(db, cardIds, i), i ? `${name} bayrak verildi` : "Bayrak kaldırıldı"))}>
                  <span className="size-3 rounded-full border border-rule" style={{ background: FLAG_COLORS[i] || "transparent" }} />
                  {i ? name : "Bayrağı kaldır"}
                  {i > 0 && <kbd className="ml-auto text-xs text-ink-soft">Ctrl+{i}</kbd>}
                </MenuItem>
              ))}
            </>
          )}
        </MenuButton>
      </div>

      {dialog === "deck" && (
        <DeckDialog
          onClose={close}
          onPick={(target) =>
            run(
              "Deste değiştirme",
              async () => changeDeck(db, cardIds, "id" in target ? target.id : (await createDeckPath(db, target.newName)).id),
              `${n} kart “${"id" in target ? target.label : target.newName.trim()}” destesine taşındı`,
            )
          }
        />
      )}
      {(dialog === "addTags" || dialog === "removeTags") && (
        <TagsDialog
          mode={dialog === "addTags" ? "add" : "remove"}
          onClose={close}
          onApply={(tags) =>
            dialog === "addTags"
              ? run("Etiket ekleme", () => addTags(db, noteIds, tags), `${selection.notes.length} nota etiket eklendi`)
              : run("Etiket çıkarma", () => removeTags(db, noteIds, tags), "Etiketler çıkarıldı")
          }
        />
      )}
      {dialog === "findReplace" && (
        <FindReplaceDialog
          noteTypes={noteTypes.filter((t) => selection.notes.some((x) => x.note_type_id === t.id))}
          onClose={close}
          onApply={async (opts) => {
            let changed = 0;
            await run("Bul ve değiştir", async () => (changed = await findReplace(db, noteIds, opts)), "");
            onDone(`${changed} not değişti`);
          }}
        />
      )}
      {dialog === "noteType" && (
        <ChangeNoteTypeDialog
          notes={selection.notes}
          noteTypes={noteTypes}
          onClose={close}
          onApply={(target, map) => run("Not tipi değiştirme", () => changeNoteType(db, noteIds, target, map), `${selection.notes.length} not “${noteTypeLabel(target.name)}” tipine çevrildi`)}
        />
      )}
      {dialog === "reposition" && (
        <RepositionDialog
          count={selection.cards.filter((c) => c.state === 0).length}
          onClose={close}
          onApply={(opts) => run("Yeniden sıralama", () => repositionNew(db, cardIds, opts), "Yeni kartların sırası değişti")}
        />
      )}
      {dialog === "due" && <DueDialog count={n} onClose={close} onApply={(spec) => run("Tarih atama", () => setDueDate(db, cardIds, spec, day), `${n} karta tarih atandı`)} />}
      {dialog === "forget" && <ForgetDialog count={n} onClose={close} onApply={(opts) => run("Unutma", () => forgetCards(db, cardIds, opts), `${n} kart yeni karta çevrildi`)} />}
      {dialog === "delete" && (
        <Modal title="Notları sil" onClose={close}>
          <p>
            Seçili <strong>{selection.notes.length} not</strong> ve bunlara ait tüm kartlar ({allCardsOf(selection.notes, selection.cards)}) silinecek.
            Ctrl/Cmd+Z ile geri alabilirsin.
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="danger" onClick={() => void run("Not silme", () => deleteNotes(db, noteIds), `${selection.notes.length} not silindi`)}>
              Sil
            </Button>
            <Button variant="ghost" onClick={close}>
              Vazgeç
            </Button>
          </div>
        </Modal>
      )}
      {dialog === "dupes" && <DuplicatesDialog notes={allNotes} noteTypes={noteTypes} onClose={close} onSearch={onSearch} />}
    </>
  );
}

function allCardsOf(notes: NoteRow[], cards: CardRow[]): string {
  const ids = new Set(notes.map((n) => n.id));
  const count = cards.filter((c) => ids.has(c.note_id)).length;
  return count ? `en az ${count} kart` : "kartlarıyla";
}

/** Seçimden bağımsız araçlar (kopyaları bul) */
export function ToolsMenu({ notes, noteTypes, onSearch }: { notes: NoteRow[]; noteTypes: NoteTypeRow[]; onSearch: (q: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-md px-2.5 py-1.5 text-sm font-medium text-ink-soft hover:bg-ink/5 hover:text-ink">
        Kopyaları bul
      </button>
      {open && <DuplicatesDialog notes={notes} noteTypes={noteTypes} onClose={() => setOpen(false)} onSearch={onSearch} />}
    </>
  );
}

// ------------------------------------------------------------------ pencereler

function DeckDialog({ onClose, onPick }: { onClose: () => void; onPick: (t: { id: string; label: string } | { newName: string }) => Promise<void> }) {
  const decks = useDeckList();
  const [deckId, setDeckId] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const chosen = deckId || decks?.[0]?.id || "";
  return (
    <Modal title="Deste değiştir" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newName.trim() && !chosen) return setError("Bir deste seç.");
          await onPick(newName.trim() ? { newName } : { id: chosen, label: decks?.find((d) => d.id === chosen)?.name ?? "" });
        }}
      >
        <SelectField label="Hedef deste" value={chosen} onChange={setDeckId} options={(decks ?? []).map((d) => ({ value: d.id, label: d.name }))} />
        <TextField label="…ya da yeni deste" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ör. YDS::Tekrar" />
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit">Taşı</Button>
      </form>
    </Modal>
  );
}

function TagsDialog({ mode, onClose, onApply }: { mode: "add" | "remove"; onClose: () => void; onApply: (tags: string[]) => void }) {
  const [tags, setTags] = useState<string[]>([]);
  return (
    <Modal title={mode === "add" ? "Etiket ekle" : "Etiket çıkar"} onClose={onClose}>
      <div className="space-y-3">
        <TagInput value={tags} onChange={setTags} onSubmitShortcut={(t) => t.length && onApply(t)} />
        <Button disabled={!tags.length} onClick={() => onApply(tags)}>
          {mode === "add" ? "Ekle" : "Çıkar"}
        </Button>
      </div>
    </Modal>
  );
}

function FindReplaceDialog({
  noteTypes,
  onClose,
  onApply,
}: {
  noteTypes: NoteTypeRow[];
  onClose: () => void;
  onApply: (o: { find: string; replace: string; fieldName: string | null; regex: boolean; matchCase: boolean }) => void;
}) {
  const fieldNames = useMemo(() => [...new Set(noteTypes.flatMap((t) => t.fields.map((f) => f.name)))], [noteTypes]);
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [field, setField] = useState("");
  const [regex, setRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  return (
    <Modal title="Bul ve değiştir" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onApply({ find, replace, fieldName: field || null, regex, matchCase });
        }}
      >
        <TextField label="Bul" value={find} onChange={(e) => setFind(e.target.value)} autoFocus />
        <TextField label="Şununla değiştir" value={replace} onChange={(e) => setReplace(e.target.value)} hint={regex ? "Gruplar için $1, $2 kullanabilirsin." : undefined} />
        <SelectField label="Hangi alanda" value={field} onChange={setField} options={[{ value: "", label: "Tüm alanlar" }, ...fieldNames.map((f) => ({ value: f, label: f }))]} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} className="size-4" /> Düzenli ifade (regex)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} className="size-4" /> Büyük/küçük harfe duyarlı
        </label>
        <p className="text-sm text-ink-soft">Sadece seçili notlarda değiştirilir. HTML içinde de arar (ör. &lt;b&gt;).</p>
        <Button type="submit" disabled={!find}>
          Değiştir
        </Button>
      </form>
    </Modal>
  );
}

function ChangeNoteTypeDialog({
  notes,
  noteTypes,
  onClose,
  onApply,
}: {
  notes: NoteRow[];
  noteTypes: NoteTypeRow[];
  onClose: () => void;
  onApply: (target: NoteTypeRow, map: { fields: Record<string, string | null>; templates: Record<number, number | null> }) => void;
}) {
  const sourceIds = [...new Set(notes.map((n) => n.note_type_id))];
  const source = noteTypes.find((t) => t.id === sourceIds[0]);
  const [targetId, setTargetId] = useState(noteTypes.find((t) => t.id !== source?.id)?.id ?? "");
  const target = noteTypes.find((t) => t.id === targetId);
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({});
  const [tplMap, setTplMap] = useState<Record<number, string>>({});

  if (sourceIds.length !== 1 || !source) {
    return (
      <Modal title="Not tipini değiştir" onClose={onClose}>
        <Notice tone="error">Seçili notlar aynı not tipinden olmalı. Önce tek bir not tipini seç (sol panelden “Not tipleri”).</Notice>
      </Modal>
    );
  }
  // Varsayılan eşleme: aynı ad, yoksa aynı sıra
  const defaultField = (i: number, name: string) =>
    source.fields.find((f) => f.name.toLowerCase() === name.toLowerCase())?.id ?? source.fields[i]?.id ?? "";
  const fieldValue = (id: string, i: number, name: string) => fieldMap[id] ?? defaultField(i, name);
  const toCloze = target?.kind === "cloze";
  const bothCloze = toCloze && source.kind === "cloze";
  const tplValue = (ord: number) => tplMap[ord] ?? (target && ord < target.templates.length ? String(ord) : "");

  return (
    <Modal title="Not tipini değiştir" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm">
          <strong>{notes.length} not</strong>: “{source.name}” →
        </p>
        <SelectField label="Yeni not tipi" value={targetId} onChange={(v) => (setTargetId(v), setFieldMap({}), setTplMap({}))} options={noteTypes.map((t) => ({ value: t.id, label: noteTypeLabel(t.name) }))} />
        {target && (
          <>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Alanlar</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {target.fields.map((f, i) => (
                  <SelectField
                    key={f.id}
                    label={`${fieldLabel(f.name)} ←`}
                    value={fieldValue(f.id, i, f.name)}
                    onChange={(v) => setFieldMap({ ...fieldMap, [f.id]: v })}
                    options={[{ value: "", label: "(boş)" }, ...source.fields.map((sf) => ({ value: sf.id, label: fieldLabel(sf.name) }))]}
                  />
                ))}
              </div>
            </div>
            {!bothCloze && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Kartlar</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {source.templates.map((t, ord) => (
                    <SelectField
                      key={t.id}
                      label={`${t.name} →`}
                      value={tplValue(ord)}
                      onChange={(v) => setTplMap({ ...tplMap, [ord]: v })}
                      options={[{ value: "", label: "(kartı sil)" }, ...target.templates.map((tt, i) => ({ value: String(i), label: tt.name }))]}
                    />
                  ))}
                </div>
                <p className="mt-2 text-sm text-ink-soft">Eşlenen kartların çalışma geçmişi korunur. “Kartı sil” seçilen kartlar silinir.</p>
              </div>
            )}
            <Button
              onClick={() =>
                onApply(target, {
                  fields: Object.fromEntries(target.fields.map((f, i) => [f.id, fieldValue(f.id, i, f.name) || null])),
                  templates: Object.fromEntries(source.templates.map((_, ord) => [ord, tplValue(ord) === "" ? null : Number(tplValue(ord))])),
                })
              }
              disabled={target.id === source.id}
            >
              Değiştir
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

function RepositionDialog({ count, onClose, onApply }: { count: number; onClose: () => void; onApply: (o: { start: number; step: number; randomize: boolean; shift: boolean }) => void }) {
  const [start, setStart] = useState("0");
  const [step, setStep] = useState("1");
  const [randomize, setRandomize] = useState(false);
  const [shift, setShift] = useState(false);
  return (
    <Modal title="Yeni kartları yeniden sırala" onClose={onClose}>
      {count === 0 ? (
        <Notice tone="info">Seçimde yeni kart yok. Bu işlem sadece yeni kartların gösterilme sırasını değiştirir.</Notice>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onApply({ start: Number(start) || 0, step: Number(step) || 1, randomize, shift });
          }}
        >
          <p className="text-sm text-ink-soft">{count} yeni kart. Küçük sıra numarası önce gelir.</p>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Başlangıç" type="number" inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value)} />
            <TextField label="Adım" type="number" min={1} inputMode="numeric" value={step} onChange={(e) => setStep(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={randomize} onChange={(e) => setRandomize(e.target.checked)} className="size-4" /> Karıştır
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)} className="size-4" /> Diğer yeni kartları kaydır
          </label>
          <Button type="submit">Sırala</Button>
        </form>
      )}
    </Modal>
  );
}

function DueDialog({ count, onClose, onApply }: { count: number; onClose: () => void; onApply: (spec: string) => void }) {
  const [spec, setSpec] = useState("0");
  return (
    <Modal title="Tarih ata" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onApply(spec);
        }}
      >
        <TextField label={`${count} kart kaç gün sonra gelsin?`} value={spec} onChange={(e) => setSpec(e.target.value)} autoFocus />
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink-soft">
          <li>
            <code>0</code> bugün, <code>1</code> yarın
          </li>
          <li>
            <code>1-7</code> 1 ile 7 gün arasında rastgele (yükü dağıtır)
          </li>
          <li>
            Sona <code>!</code> eklersen aralık da o gün sayısı olur (ör. <code>30!</code>)
          </li>
        </ul>
        <Button type="submit">Ata</Button>
      </form>
    </Modal>
  );
}

function ForgetDialog({ count, onClose, onApply }: { count: number; onClose: () => void; onApply: (o: { restorePosition: boolean; resetCounts: boolean }) => void }) {
  const [restorePosition, setRestore] = useState(true);
  const [resetCounts, setReset] = useState(false);
  return (
    <Modal title="Unut" onClose={onClose}>
      <div className="space-y-3">
        <p>{count} kart yeni karta çevrilecek; aralıkları sıfırlanır. Cevap geçmişi silinmez.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={restorePosition} onChange={(e) => setRestore(e.target.checked)} className="size-4" /> Eski sırasına koy (kapalıysa en sona)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={resetCounts} onChange={(e) => setReset(e.target.checked)} className="size-4" /> Tekrar ve hata sayılarını sıfırla
        </label>
        <Button onClick={() => onApply({ restorePosition, resetCounts })}>Unut</Button>
      </div>
    </Modal>
  );
}

function DuplicatesDialog({ notes, noteTypes, onClose, onSearch }: { notes: NoteRow[]; noteTypes: NoteTypeRow[]; onClose: () => void; onSearch: (q: string) => void }) {
  const { db } = useApp();
  const undo = useUndo();
  // Varsayılan: en çok notu olan not tipi
  const [typeId, setTypeId] = useState(() => {
    const counts = new Map<string, number>();
    for (const n of notes) if (n.deleted_at === null) counts.set(n.note_type_id, (counts.get(n.note_type_id) ?? 0) + 1);
    return [...noteTypes].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))[0]?.id ?? "";
  });
  const type = noteTypes.find((t) => t.id === typeId);
  const [fieldId, setFieldId] = useState("");
  const field = fieldId || type?.fields[0]?.id || "";
  const groups = useMemo(() => (type ? findDuplicates(notes, type.id, field) : []), [notes, type, field]);
  const [tagged, setTagged] = useState(false);
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return (
    <Modal title="Kopyaları bul" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Not tipi" value={typeId} onChange={(v) => (setTypeId(v), setFieldId(""))} options={noteTypes.map((t) => ({ value: t.id, label: noteTypeLabel(t.name) }))} />
          <SelectField label="Alan" value={field} onChange={setFieldId} options={(type?.fields ?? []).map((f) => ({ value: f.id, label: fieldLabel(f.name) }))} />
        </div>
        {groups.length === 0 ? (
          <Notice tone="ok">Bu alanda kopya yok.</Notice>
        ) : (
          <>
            <p className="text-sm">
              {groups.length} grup, toplam {groups.reduce((s, g) => s + g.noteIds.length, 0)} not.
            </p>
            <ul className="max-h-80 divide-y divide-rule overflow-y-auto rounded-lg border border-rule">
              {groups.map((g) => (
                <li key={g.text} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="truncate">{g.text}</span>
                  <span className="text-ink-soft">({g.noteIds.length})</span>
                  <button
                    type="button"
                    className="ml-auto shrink-0 rounded px-2 py-1 text-accent hover:bg-accent/10"
                    onClick={() => {
                      onSearch(`"dupe:${type!.id},${esc(g.text)}"`);
                      onClose();
                    }}
                  >
                    Göster
                  </button>
                </li>
              ))}
            </ul>
            <Button
              variant="secondary"
              disabled={tagged}
              onClick={async () => {
                await undo.run("Kopyaları etiketleme", () => addTags(db!, groups.flatMap((g) => g.noteIds), ["kopya"]));
                setTagged(true);
              }}
            >
              {tagged ? "“kopya” etiketi eklendi" : "Hepsine “kopya” etiketi ekle"}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
