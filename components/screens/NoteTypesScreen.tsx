"use client";
// NOT TİPİ YÖNETİCİSİ (/not-tipleri)
//   Liste: oluştur (kopyalayarak), yeniden adlandır, sil.
//   Düzenleyici (?id=…): alanlar (ekle/sil/yeniden adlandır/sırala, yapışkan,
//   sıralama ve kelime alanı), kart şablonları (ön/arka yüz), CSS + canlı önizleme.
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useNoteTypes } from "@/components/app/data";
import { useUndo } from "@/components/app/undo";
import { CardFrame } from "@/components/card/CardFrame";
import { Button, Modal, Notice, SelectField, TextField } from "@/components/ui";
import { updateRow } from "@/lib/db/mutations";
import type { NoteRow, NoteTypeRow } from "@/lib/db/types";
import {
  blankField,
  blankTemplate,
  createNoteType,
  deleteNoteType,
  type NoteTypeDraft,
  type NoteTypeImpact,
  noteTypeImpact,
  renameFieldInTemplate,
  saveNoteType,
  validateNoteType,
} from "@/lib/notetypes/manage";
import { resolveMediaInHtml } from "@/lib/media-url";
import { renderCard } from "@/lib/template/render";
import { noteTypeLabel } from "@/lib/notetypes/labels";

const KIND_LABEL: Record<string, string> = { standard: "Normal", cloze: "Boşluk doldurma", image_occlusion: "Resim maskeleme" };

export function NoteTypesScreen() {
  const params = useSearchParams();
  const id = params.get("id");
  return id ? <NoteTypeEditor id={id} /> : <NoteTypeList />;
}

// ------------------------------------------------------------------- liste

function NoteTypeList() {
  const { db } = useApp();
  const undo = useUndo();
  const router = useRouter();
  const types = useNoteTypes();
  const counts = useLiveQuery(async () => {
    if (!db) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const n of await db.notes.toArray()) if (n.deleted_at === null) m.set(n.note_type_id, (m.get(n.note_type_id) ?? 0) + 1);
    return m;
  }, [db]);
  const [dialog, setDialog] = useState<{ kind: "new" | "rename" | "delete"; type?: NoteTypeRow } | null>(null);
  const [name, setName] = useState("");
  const [baseId, setBaseId] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!db || !types) return null;

  const close = () => (setDialog(null), setError(null));
  const open = (kind: "new" | "rename" | "delete", type?: NoteTypeRow) => {
    setDialog({ kind, type });
    setName(kind === "rename" ? type!.name : kind === "new" ? (type ? `${type.name} kopyası` : "") : "");
    setBaseId(type?.id ?? types.find((t) => t.name === "Basic")?.id ?? types[0]?.id ?? "");
    setError(null);
  };

  return (
    <div className="space-y-5">
      <div>
        <Link href="/ayarlar" className="text-sm text-ink-soft hover:text-ink">
          ← Ayarlar
        </Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-display text-[28px] font-semibold leading-tight">Not tipleri</h1>
          <Button onClick={() => open("new")}>Yeni not tipi</Button>
        </div>
        <p className="mt-1 text-sm text-ink-soft">Not tipi, bir notun hangi alanlardan oluştuğunu ve hangi kartları ürettiğini belirler.</p>
      </div>

      <ul className="divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-surface">
        {types.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
            <div className="min-w-0 flex-1">
              <Link href={`/not-tipleri?id=${t.id}`} className="font-medium hover:text-accent">
                {noteTypeLabel(t.name)}
              </Link>
              <div className="text-sm text-ink-soft">
                {KIND_LABEL[t.kind] ?? t.kind}, {t.fields.length} alan, {t.kind === "cloze" ? "boşluk başına bir kart" : t.kind === "image_occlusion" ? "maske grubu başına bir kart" : `${t.templates.length} kart şablonu`},{" "}
                {counts?.get(t.id) ?? 0} not
              </div>
            </div>
            <div className="flex gap-1 text-sm">
              <Link href={`/not-tipleri?id=${t.id}`} className="rounded-md px-2.5 py-1.5 text-accent hover:bg-accent/10">
                Düzenle
              </Link>
              <button type="button" onClick={() => open("new", t)} className="rounded-md px-2.5 py-1.5 text-ink-soft hover:bg-ink/5 hover:text-ink">
                Kopyala
              </button>
              <button type="button" onClick={() => open("rename", t)} className="rounded-md px-2.5 py-1.5 text-ink-soft hover:bg-ink/5 hover:text-ink">
                Ad değiştir
              </button>
              <button type="button" onClick={() => open("delete", t)} className="rounded-md px-2.5 py-1.5 text-danger hover:bg-danger/10">
                Sil
              </button>
            </div>
          </li>
        ))}
      </ul>

      {dialog?.kind === "new" && (
        <Modal title="Yeni not tipi" onClose={close}>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const base = types.find((t) => t.id === baseId);
              if (!base) return;
              try {
                const row = await undo.run("Not tipi oluşturma", () => createNoteType(db, base, name));
                close();
                router.push(`/not-tipleri?id=${row.id}`);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <SelectField label="Neyin kopyası olsun?" value={baseId} onChange={setBaseId} options={types.map((t) => ({ value: t.id, label: noteTypeLabel(t.name) }))} />
            <TextField label="Ad" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="ör. YDS Kelime" />
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" disabled={!name.trim()}>
              Oluştur ve düzenle
            </Button>
          </form>
        </Modal>
      )}
      {dialog?.kind === "rename" && dialog.type && (
        <Modal title="Not tipini yeniden adlandır" onClose={close}>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return setError("Ad boş olamaz.");
              await undo.run("Not tipi adı değiştirme", () => updateRow(db, "note_types", dialog.type!.id, { name: name.trim() }));
              close();
            }}
          >
            <TextField label="Yeni ad" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit">Kaydet</Button>
          </form>
        </Modal>
      )}
      {dialog?.kind === "delete" && dialog.type && (
        <Modal title="Not tipini sil" onClose={close}>
          <p>
            “{dialog.type.name}” silinsin mi?
            {(counts?.get(dialog.type.id) ?? 0) > 0 && (
              <strong> Bu tipteki {counts?.get(dialog.type.id)} not ve tüm kartları da silinecek.</strong>
            )}
          </p>
          {types.length === 1 && <Notice tone="error">Son not tipi silinemez.</Notice>}
          <div className="mt-4 flex gap-2">
            <Button
              variant="danger"
              disabled={types.length === 1}
              onClick={async () => {
                await undo.run("Not tipi silme", () => deleteNoteType(db, dialog.type!.id));
                close();
              }}
            >
              Sil
            </Button>
            <Button variant="ghost" onClick={close}>
              Vazgeç
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// -------------------------------------------------------------- düzenleyici

type Tab = "fields" | "templates" | "css";

function toDraft(t: NoteTypeRow): NoteTypeDraft {
  return {
    name: t.name,
    kind: t.kind,
    fields: t.fields.map((f) => ({ ...f })),
    templates: t.templates.map((x) => ({ ...x })),
    css: t.css,
    sort_field: t.sort_field,
    word_field: t.word_field,
  };
}

function NoteTypeEditor({ id }: { id: string }) {
  const { db } = useApp();
  const undo = useUndo();
  const original = useLiveQuery(async () => (db ? db.note_types.get(id) : undefined), [db, id]);
  const sample = useLiveQuery(
    async () => (db ? (await db.notes.where("note_type_id").equals(id).toArray()).find((n) => n.deleted_at === null) ?? null : null),
    [db, id],
  );
  const [draft, setDraft] = useState<NoteTypeDraft | null>(null);
  const [tab, setTab] = useState<Tab>("fields");
  const [tplIndex, setTplIndex] = useState(0);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<NoteTypeImpact | null>(null);
  const [newField, setNewField] = useState("");

  useEffect(() => {
    if (original && !draft) setDraft(toDraft(original));
  }, [original, draft]);

  const dirty = useMemo(() => !!original && !!draft && JSON.stringify(toDraft(original)) !== JSON.stringify(draft), [original, draft]);
  const problem = draft ? validateNoteType(draft) : null;

  if (!db) return null;
  if (original === undefined || !draft) return null;
  if (!original || original.deleted_at !== null) return <Notice tone="error">Not tipi bulunamadı.</Notice>;

  const set = (patch: Partial<NoteTypeDraft>) => {
    setDraft({ ...draft, ...patch });
    setMessage(null);
  };
  const isCloze = draft.kind === "cloze" || draft.kind === "image_occlusion";
  const tpl = draft.templates[Math.min(tplIndex, draft.templates.length - 1)];

  const renameField = (fid: string, name: string) => {
    const old = draft.fields.find((f) => f.id === fid)!.name;
    set({
      fields: draft.fields.map((f) => (f.id === fid ? { ...f, name } : f)),
      // Şablonlardaki {{Eski}} → {{Yeni}} (boşken değil)
      templates: name.trim() && old.trim()
        ? draft.templates.map((t) => ({ ...t, front: renameFieldInTemplate(t.front, old, name), back: renameFieldInTemplate(t.back, old, name) }))
        : draft.templates,
    });
  };
  const moveField = (i: number, d: -1 | 1) => {
    const list = [...draft.fields];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    set({ fields: list });
  };
  const moveTemplate = (i: number, d: -1 | 1) => {
    const list = [...draft.templates];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    set({ templates: list });
    setTplIndex(j);
  };

  const save = async (confirmed = false) => {
    if (problem) return setMessage({ tone: "error", text: problem });
    const impact = await noteTypeImpact(db, original, draft);
    if (!confirmed && (impact.cardsRemoved > 0 || impact.removedFields.length > 0)) return setConfirm(impact);
    try {
      await undo.run(`“${draft.name}” not tipini düzenleme`, () => saveNoteType(db, id, draft));
      setConfirm(null);
      setDraft(null); // kaydedilen sürümden yeniden yüklensin
      setMessage({ tone: "ok", text: "Kaydedildi." });
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Link href="/not-tipleri" className="text-sm text-ink-soft hover:text-ink">
          ← Not tipleri
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <input
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            aria-label="Not tipinin adı"
            className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1 font-display text-[26px] font-semibold leading-tight hover:border-rule focus:border-accent focus:outline-none"
          />
          <span className="text-sm text-ink-soft">{KIND_LABEL[draft.kind]}</span>
        </div>
      </div>

      <div role="tablist" className="flex gap-1 border-b border-rule text-sm">
        {(
          [
            ["fields", "Alanlar"],
            ["templates", isCloze ? "Kart şablonu" : "Kart şablonları"],
            ["css", "Görünüm (CSS)"],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="-mb-px border-b-2 border-transparent px-3 py-2 font-medium text-ink-soft hover:text-ink aria-selected:border-accent aria-selected:text-ink"
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "fields" && (
        <div className="space-y-4">
          <ul className="divide-y divide-rule rounded-xl border border-rule bg-surface">
            {draft.fields.map((f, i) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="w-6 text-right text-sm tabular-nums text-ink-soft">{i + 1}.</span>
                <input
                  value={f.name}
                  onChange={(e) => renameField(f.id, e.target.value)}
                  aria-label={`${i + 1}. alanın adı`}
                  className="min-h-10 min-w-0 flex-1 rounded-lg border border-rule bg-paper px-2.5 focus:border-accent focus:outline-none"
                />
                <label className="flex items-center gap-1.5 text-sm text-ink-soft" title="Kart eklenince temizlenmez">
                  <input type="checkbox" checked={!!f.sticky} onChange={(e) => set({ fields: draft.fields.map((x) => (x.id === f.id ? { ...x, sticky: e.target.checked } : x)) })} className="size-4" />
                  Yapışkan
                </label>
                <div className="flex">
                  <IconBtn label="Yukarı taşı" onClick={() => moveField(i, -1)} disabled={i === 0}>
                    ↑
                  </IconBtn>
                  <IconBtn label="Aşağı taşı" onClick={() => moveField(i, 1)} disabled={i === draft.fields.length - 1}>
                    ↓
                  </IconBtn>
                  <IconBtn label="Alanı sil" onClick={() => set({ fields: draft.fields.filter((x) => x.id !== f.id) })} disabled={draft.fields.length === 1} danger>
                    ×
                  </IconBtn>
                </div>
              </li>
            ))}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newField.trim()) return;
              set({ fields: [...draft.fields, blankField(newField.trim())] });
              setNewField("");
            }}
          >
            <input
              value={newField}
              onChange={(e) => setNewField(e.target.value)}
              placeholder="Yeni alan adı (ör. Telaffuz)"
              aria-label="Yeni alan adı"
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-rule bg-surface px-3 focus:border-accent focus:outline-none"
            />
            <Button type="submit" variant="secondary" disabled={!newField.trim()}>
              Alan ekle
            </Button>
          </form>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Sıralama alanı (kart listesinde görünen)"
              value={draft.sort_field ?? draft.fields[0]?.id ?? ""}
              onChange={(v) => set({ sort_field: v })}
              options={draft.fields.map((f) => ({ value: f.id, label: f.name }))}
            />
            <SelectField
              label="Kelime alanı (örnek cümlede kalın gösterilir)"
              value={draft.word_field ?? ""}
              onChange={(v) => set({ word_field: v || null })}
              options={[{ value: "", label: "Otomatik (ilk alan)" }, ...draft.fields.map((f) => ({ value: f.id, label: f.name }))]}
            />
          </div>
          <p className="text-sm text-ink-soft">
            Alan adını değiştirince kart şablonlarındaki {"{{Ad}}"} de değişir. Silinen alanın içeriği notlarda görünmez olur.
          </p>
        </div>
      )}

      {tab === "templates" && tpl && (
        <div className="space-y-3">
          {!isCloze && (
            <div className="flex flex-wrap items-center gap-1">
              {draft.templates.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={t.id === tpl.id}
                  onClick={() => setTplIndex(i)}
                  className="rounded-md border border-rule px-3 py-1.5 text-sm aria-pressed:border-accent aria-pressed:bg-accent/10"
                >
                  {i + 1}. {t.name}
                </button>
              ))}
              <Button
                variant="ghost"
                onClick={() => {
                  set({ templates: [...draft.templates, blankTemplate(`Card ${draft.templates.length + 1}`, draft.fields)] });
                  setTplIndex(draft.templates.length);
                }}
              >
                + Şablon ekle
              </Button>
            </div>
          )}
          {!isCloze && (
            <div className="flex flex-wrap items-end gap-2">
              <TextField
                label="Şablon adı"
                value={tpl.name}
                onChange={(e) => set({ templates: draft.templates.map((t) => (t.id === tpl.id ? { ...t, name: e.target.value } : t)) })}
                className="min-w-40 flex-1"
              />
              <IconBtn label="Sola taşı" onClick={() => moveTemplate(tplIndex, -1)} disabled={tplIndex === 0}>
                ←
              </IconBtn>
              <IconBtn label="Sağa taşı" onClick={() => moveTemplate(tplIndex, 1)} disabled={tplIndex >= draft.templates.length - 1}>
                →
              </IconBtn>
              <Button
                variant="ghost"
                className="text-danger"
                disabled={draft.templates.length === 1}
                onClick={() => {
                  set({ templates: draft.templates.filter((t) => t.id !== tpl.id) });
                  setTplIndex(0);
                }}
              >
                Şablonu sil
              </Button>
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-3">
              <CodeArea label="Ön yüz" value={tpl.front} onChange={(v) => set({ templates: draft.templates.map((t) => (t.id === tpl.id ? { ...t, front: v } : t)) })} />
              <CodeArea label="Arka yüz" value={tpl.back} onChange={(v) => set({ templates: draft.templates.map((t) => (t.id === tpl.id ? { ...t, back: v } : t)) })} />
              <FieldChips draft={draft} />
            </div>
            <TemplatePreview draft={draft} ord={isCloze ? 0 : Math.min(tplIndex, draft.templates.length - 1)} sample={sample ?? null} />
          </div>
        </div>
      )}

      {tab === "css" && (
        <div className="grid gap-3 lg:grid-cols-2">
          <CodeArea label="Kart stili (CSS)" value={draft.css} onChange={(v) => set({ css: v })} rows={18} />
          <TemplatePreview draft={draft} ord={0} sample={sample ?? null} />
        </div>
      )}

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {problem && dirty && <Notice tone="error">{problem}</Notice>}
      <div className="sticky bottom-20 z-10 flex items-center gap-3 rounded-xl border border-rule bg-paper/95 p-2 backdrop-blur md:bottom-4">
        <Button onClick={() => void save()} disabled={!dirty || !!problem}>
          Kaydet
        </Button>
        <Button variant="ghost" onClick={() => setDraft(toDraft(original))} disabled={!dirty}>
          Değişiklikleri at
        </Button>
        {dirty && <span className="text-sm text-ink-soft">Kaydedilmemiş değişiklik var</span>}
      </div>

      {confirm && (
        <Modal title="Değişiklikler onaylansın mı?" onClose={() => setConfirm(null)}>
          <div className="space-y-3">
            {confirm.cardsRemoved > 0 && (
              <p>
                Silinen şablon(lar): <strong>{confirm.removedTemplates.join(", ")}</strong>. Bu şablonlara ait <strong>{confirm.cardsRemoved} kart</strong>{" "}
                (çalışma geçmişiyle) silinecek.
              </p>
            )}
            {confirm.removedFields.length > 0 && (
              <p>
                Silinen alan(lar): <strong>{confirm.removedFields.join(", ")}</strong>. {confirm.notes} notta bu alanların içeriği artık görünmeyecek.
              </p>
            )}
            <p className="text-sm text-ink-soft">Ctrl/Cmd+Z ile geri alabilirsin.</p>
            <div className="flex gap-2">
              <Button variant="danger" onClick={() => void save(true)}>
                Evet, kaydet
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Vazgeç
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid size-9 place-items-center rounded-md text-lg hover:bg-ink/5 disabled:opacity-30 ${danger ? "text-danger" : "text-ink-soft"}`}
    >
      {children}
    </button>
  );
}

function CodeArea({ label, value, onChange, rows = 7 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        spellCheck={false}
        autoCapitalize="off"
        className="w-full rounded-lg border border-rule bg-surface px-3 py-2 font-mono text-[13px] leading-relaxed focus:border-accent focus:outline-none"
      />
    </label>
  );
}

function FieldChips({ draft }: { draft: NoteTypeDraft }) {
  const special = ["FrontSide", "Tags", "Deck", "Card", "Example", "Examples"];
  return (
    <div className="text-sm text-ink-soft">
      Kullanılabilir:{" "}
      {[...draft.fields.map((f) => f.name), ...special].map((n) => (
        <code key={n} className="mr-1 inline-block rounded bg-ink/5 px-1.5 py-0.5 text-[12px] text-ink">
          {`{{${n}}}`}
        </code>
      ))}
      <span className="block pt-1">
        Koşul: <code>{"{{#Alan}}…{{/Alan}}"}</code> · Cevap yazdır: <code>{"{{type:Alan}}"}</code> · İpucu: <code>{"{{hint:Alan}}"}</code>
      </span>
    </div>
  );
}

function TemplatePreview({ draft, ord, sample }: { draft: NoteTypeDraft; ord: number; sample: NoteRow | null }) {
  const { db, media } = useApp();
  const [side, setSide] = useState<"question" | "answer">("question");
  const [night, setNight] = useState(false);
  useEffect(() => setNight(document.documentElement.classList.contains("dark")), []);
  // Örnek not yoksa alan adlarıyla doldur
  const fields = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of draft.fields) out[f.id] = sample?.fields[f.id] || (draft.kind === "cloze" && f === draft.fields[0] ? `{{c1::${f.name}}} örneği` : `(${f.name})`);
    return out;
  }, [draft, sample]);
  const result = useMemo(() => {
    try {
      const r = renderCard({
        noteType: { ...draft, fields: draft.fields },
        note: { fields, tags: sample?.tags ?? ["örnek"] },
        cardOrd: ord,
        deckName: "Deste",
        examples: [{ id: "x", text: "This is an example sentence.", translation: "Bu bir örnek cümle." }],
        chosenExampleId: "x",
      });
      return { ok: r };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }, [draft, fields, sample, ord]);
  const [html, setHtml] = useState<{ key: string; value: string } | null>(null);
  const raw = "ok" in result && result.ok ? (side === "question" ? result.ok.question : result.ok.answer) : "";
  const key = `${side}:${raw}:${draft.css}`;
  useEffect(() => {
    if (!db || !raw) return;
    let cancelled = false;
    void resolveMediaInHtml(raw, db, media).then((v) => !cancelled && setHtml({ key, value: v }));
    return () => {
      cancelled = true;
    };
  }, [raw, key, db, media]);

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1 text-sm">
        <span className="mr-auto font-semibold">Önizleme{sample ? "" : " (örnek veriyle)"}</span>
        {(["question", "answer"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            onClick={() => setSide(s)}
            className="rounded-md px-2.5 py-1 text-ink-soft aria-pressed:bg-accent/15 aria-pressed:text-ink"
          >
            {s === "question" ? "Soru" : "Cevap"}
          </button>
        ))}
      </div>
      {"error" in result ? (
        <Notice tone="error">{result.error}</Notice>
      ) : (
        <div className="overflow-hidden rounded-xl border border-rule bg-surface">
          {html?.key === key ? <CardFrame html={html.value} css={draft.css} cardOrd={ord} night={night} minHeight={180} /> : <div style={{ height: 180 }} />}
        </div>
      )}
    </div>
  );
}
