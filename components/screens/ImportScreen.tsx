"use client";
// İÇE AKTARMA: .apkg / .colpkg (Anki) ve .txt / .csv / .tsv
// Adımlar: dosya seç → seçenekler → (Anki) örnek cümle sihirbazı → aktar → özet
// Her şey tarayıcıda, cihaz veritabanına yazılır; sonra eşlemeyle sunucuya gider.
import Link from "next/link";
import { useMemo, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useDeckList, useNoteTypes } from "@/components/app/data";
import { Button, Notice, Section, SelectField, TextField } from "@/components/ui";
import { type AnkiPackage, parseAnkiPackage, readMedia } from "@/lib/import/anki-package";
import {
  type AnkiImportOptions,
  type ImportProgress,
  type ImportSummary,
  importAnkiPackage,
  type NoteTypeExampleChoice,
} from "@/lib/import/anki-writer";
import {
  type ColumnTarget,
  type CsvSummary,
  DELIMITERS,
  detectDelimiter,
  importCsvRows,
  parseDelimited,
  readHeaders,
} from "@/lib/import/csv";
import { guessExampleField, guessWordField, splitExamples } from "@/lib/import/examples";
import { isImageFile, isSoundOrVideoFile, stripSoundAndVideo } from "@/lib/import/html";
import { loadSql } from "@/lib/import/sql";
import { defaultDeckId } from "@/lib/notetypes/builtins";
import { stripHtml } from "@/lib/text";
import { fieldLabel, noteTypeLabel } from "@/lib/notetypes/labels";

type Step =
  | { kind: "pick" }
  | { kind: "apkg"; name: string; bytes: Uint8Array; pkg: AnkiPackage }
  | { kind: "wizard"; name: string; bytes: Uint8Array; pkg: AnkiPackage }
  | { kind: "csv"; name: string; text: string }
  | { kind: "running" }
  | { kind: "done"; anki?: ImportSummary; csv?: CsvSummary };

export function ImportScreen() {
  const { db } = useApp();
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [options, setOptions] = useState<Omit<AnkiImportOptions, "examples">>({
    includeScheduling: false,
    duplicateMode: "update",
  });
  const [choices, setChoices] = useState<Record<number, NoteTypeExampleChoice>>({});

  const pickFile = async (file: File) => {
    setError(null);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    try {
      if (ext === "apkg" || ext === "colpkg") {
        setStep({ kind: "running" });
        setProgress({ label: "Dosya okunuyor", done: 0, total: 1 });
        const bytes = new Uint8Array(await file.arrayBuffer());
        const pkg = parseAnkiPackage(await loadSql(), bytes);
        setOptions({ includeScheduling: ext === "colpkg", duplicateMode: "update" });
        // Sihirbaz tahminleri
        const used = new Set(pkg.notes.map((n) => n.noteTypeId));
        const guesses: Record<number, NoteTypeExampleChoice> = {};
        for (const nt of pkg.noteTypes.filter((n) => used.has(n.ankiId))) {
          const names = nt.fields.map((f) => f.name);
          const ex = guessExampleField(names);
          const word = guessWordField(names);
          guesses[nt.ankiId] = {
            wordFieldOrd: word === null ? null : nt.fields[word].ord,
            exampleFieldOrd: ex === null || ex === word ? null : nt.fields[ex].ord,
            useExampleTag: ex !== null && ex !== word,
          };
        }
        setChoices(guesses);
        setStep({ kind: "apkg", name: file.name, bytes, pkg });
      } else if (["txt", "csv", "tsv"].includes(ext)) {
        setStep({ kind: "csv", name: file.name, text: await file.text() });
      } else {
        setError("Desteklenen dosyalar: .apkg, .colpkg, .txt, .csv, .tsv");
      }
    } catch (err) {
      setStep({ kind: "pick" });
      setError(`Dosya okunamadı: ${(err as Error).message}`);
    }
  };

  const runAnki = async (s: Extract<Step, { kind: "wizard" }>) => {
    if (!db) return;
    setStep({ kind: "running" });
    try {
      const summary = await importAnkiPackage(
        db,
        s.pkg,
        (names) => readMedia(s.bytes, s.pkg.media.filter((m) => names.includes(m.name))),
        { ...options, examples: choices },
        setProgress,
      );
      setStep({ kind: "done", anki: summary });
    } catch (err) {
      setError(`İçe aktarma yarıda kaldı: ${(err as Error).message}`);
      setStep({ kind: "pick" });
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <Link href="/" className="text-sm text-ink-soft hover:text-ink">
          ← Desteler
        </Link>
        <h1 className="mt-1 font-display text-[28px] font-semibold leading-tight">İçe aktar</h1>
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      {step.kind === "pick" && (
        <Section>
          <p className="text-ink-soft">
            İndirdiğin desteyi (.apkg ya da .colpkg) veya bir kelime listesini (.txt, .csv, .tsv) seç. Dosya bu cihazda
            okunur; internet gerekmez.
          </p>
          <label className="mt-4 inline-flex cursor-pointer items-center rounded-lg bg-accent px-4 py-2.5 font-semibold text-accent-ink hover:bg-accent-strong">
            Dosya seç
            <input
              type="file"
              accept=".apkg,.colpkg,.txt,.csv,.tsv"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pickFile(f);
                e.target.value = "";
              }}
            />
          </label>
          <p className="mt-3 text-sm text-ink-soft">
            Destedeki resimler de gelir; ses ve video dosyaları alınmaz.
          </p>
        </Section>
      )}

      {step.kind === "apkg" && (
        <ApkgOptions
          step={step}
          options={options}
          setOptions={setOptions}
          onNext={() => setStep({ ...step, kind: "wizard" })}
          onRun={() => void runAnki({ ...step, kind: "wizard" })}
          onCancel={() => setStep({ kind: "pick" })}
        />
      )}

      {step.kind === "wizard" && (
        <ExampleWizard pkg={step.pkg} choices={choices} setChoices={setChoices} onRun={() => void runAnki(step)} onBack={() => setStep({ ...step, kind: "apkg" })} />
      )}

      {step.kind === "csv" && (
        <CsvImport
          name={step.name}
          text={step.text}
          onRun={async (rows, opts) => {
            if (!db) return;
            setStep({ kind: "running" });
            const summary = await importCsvRows(db, rows, opts, setProgress);
            setStep({ kind: "done", csv: summary });
          }}
          onCancel={() => setStep({ kind: "pick" })}
        />
      )}

      {step.kind === "running" && progress && (
        <Section>
          <div className="mb-2 flex justify-between text-sm">
            <span>{progress.label}…</span>
            <span className="tabular-nums text-ink-soft">
              {progress.total > 1 ? `${progress.done} / ${progress.total}` : ""}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-rule" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress.done / Math.max(1, progress.total)) * 100)}>
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
          <p className="mt-3 text-sm text-ink-soft">Bu sayfayı kapatma. Büyük destelerde birkaç dakika sürebilir.</p>
        </Section>
      )}

      {step.kind === "done" && (
        <Section title="İçe aktarma tamamlandı">
          {step.anki && (
            <ul className="list-disc space-y-1 pl-5">
              <li>{step.anki.notesAdded} not eklendi, {step.anki.cardsAdded} kart oluşturuldu.</li>
              {step.anki.notesUpdated > 0 && <li>{step.anki.notesUpdated} var olan not güncellendi.</li>}
              {step.anki.notesSkipped > 0 && <li>{step.anki.notesSkipped} not zaten vardı, atlandı.</li>}
              {step.anki.reviewLogsAdded > 0 && <li>{step.anki.reviewLogsAdded} çalışma geçmişi kaydı alındı.</li>}
              {step.anki.examplesAdded > 0 && <li>{step.anki.examplesAdded} örnek cümle eklendi.</li>}
              {step.anki.imagesAdded > 0 && <li>{step.anki.imagesAdded} resim eklendi.</li>}
              {step.anki.imagesTooLarge > 0 && <li>{step.anki.imagesTooLarge} resim 10 MB'tan büyük olduğu için atlandı.</li>}
              {step.anki.soundsSkipped > 0 && <li>{step.anki.soundsSkipped} ses/video dosyası alınmadı.</li>}
              {step.anki.otherMediaSkipped > 0 && <li>{step.anki.otherMediaSkipped} desteklenmeyen dosya atlandı.</li>}
            </ul>
          )}
          {step.csv && (
            <ul className="list-disc space-y-1 pl-5">
              <li>{step.csv.notesAdded} not eklendi, {step.csv.cardsAdded} kart oluşturuldu.</li>
              {step.csv.examplesAdded > 0 && <li>{step.csv.examplesAdded} örnek cümle eklendi.</li>}
              {step.csv.rowsSkipped > 0 && <li>{step.csv.rowsSkipped} satır atlandı (kartın soru kısmı boş kalıyordu).</li>}
            </ul>
          )}
          <p className="mt-3 text-sm text-ink-soft">Kartlar internet olduğunda diğer cihazlarına da kendiliğinden gelir.</p>
          <div className="mt-4 flex gap-2">
            <Link href="/" className="rounded-lg bg-accent px-4 py-2.5 font-semibold text-accent-ink">
              Destelere git
            </Link>
            <Button variant="secondary" onClick={() => setStep({ kind: "pick" })}>
              Başka dosya
            </Button>
          </div>
        </Section>
      )}
    </div>
  );
}

function ApkgOptions({
  step,
  options,
  setOptions,
  onNext,
  onRun,
  onCancel,
}: {
  step: Extract<Step, { kind: "apkg" }>;
  options: Omit<AnkiImportOptions, "examples">;
  setOptions: (o: Omit<AnkiImportOptions, "examples">) => void;
  onNext: () => void;
  onRun: () => void;
  onCancel: () => void;
}) {
  const { pkg } = step;
  const usedDecks = new Set(pkg.cards.map((c) => c.originalDeckId || c.deckId));
  return (
    <Section title={step.name}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <dt className="text-ink-soft">Kart</dt>
        <dd className="sm:col-span-2">{pkg.cards.length.toLocaleString("tr-TR")}</dd>
        <dt className="text-ink-soft">Desteler</dt>
        <dd className="sm:col-span-2">
          {pkg.decks.filter((d) => usedDecks.has(d.ankiId)).map((d) => d.name).join(", ") || "—"}
        </dd>
        <dt className="text-ink-soft">Resim</dt>
        <dd className="sm:col-span-2">{pkg.media.filter((m) => isImageFile(m.name)).length}</dd>
        <dt className="text-ink-soft">Ses / video</dt>
        <dd className="sm:col-span-2">{pkg.media.filter((m) => isSoundOrVideoFile(m.name)).length} (alınmayacak)</dd>
      </dl>
      <div className="mt-5 space-y-4">
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={options.includeScheduling}
            onChange={(e) => setOptions({ ...options, includeScheduling: e.target.checked })}
            className="mt-1 size-4"
          />
          <span>
            <span className="font-medium">Çalışma geçmişini de al</span>
            <span className="block text-sm text-ink-soft">
              Bu desteyi daha önce başka bir uygulamada çalıştıysan işaretle: nerede kaldığın da gelir. İşaretlemezsen tüm
              kartlar yeni olarak başlar.
            </span>
          </span>
        </label>
        <SelectField
          label="Bu kartlar daha önce eklendiyse"
          value={options.duplicateMode}
          onChange={(v) => setOptions({ ...options, duplicateMode: v as AnkiImportOptions["duplicateMode"] })}
          options={[
            { value: "update", label: "Yenisiyle güncelle" },
            { value: "skip", label: "Eskisini koru, atla" },
            { value: "duplicate", label: "İkinci bir kopya ekle" },
          ]}
        />
      </div>
      <div className="mt-5 flex gap-2">
        <Button onClick={onRun}>İçe aktar</Button>
        <Button variant="ghost" onClick={onCancel}>
          Vazgeç
        </Button>
      </div>
      <p className="mt-3 text-sm text-ink-soft">
        Kartlar dosyadaki hâliyle gelir.{" "}
        <button type="button" onClick={onNext} className="text-accent underline">
          Örnek cümle ayarları (isteğe bağlı)
        </button>
        : destede ayrı bir örnek cümle alanı varsa, cümleleri ayırıp her tekrarda farklı birini göstermek için.
      </p>
    </Section>
  );
}

function ExampleWizard({
  pkg,
  choices,
  setChoices,
  onRun,
  onBack,
}: {
  pkg: AnkiPackage;
  choices: Record<number, NoteTypeExampleChoice>;
  setChoices: (c: Record<number, NoteTypeExampleChoice>) => void;
  onRun: () => void;
  onBack: () => void;
}) {
  const used = new Set(pkg.notes.map((n) => n.noteTypeId));
  const types = pkg.noteTypes.filter((n) => used.has(n.ankiId));
  return (
    <div className="space-y-4">
      <Notice tone="info">
        Her kart türü için kelimenin ve (varsa) örnek cümlelerin hangi alanda olduğunu seç. Örnek alanındaki cümleler ayrı
        ayrı kaydedilir; çalışırken her seferinde biri gösterilir.
      </Notice>
      {types.map((nt) => {
        const c = choices[nt.ankiId] ?? { wordFieldOrd: null, exampleFieldOrd: null, useExampleTag: false };
        const update = (patch: Partial<NoteTypeExampleChoice>) => setChoices({ ...choices, [nt.ankiId]: { ...c, ...patch } });
        const sample = pkg.notes.find((n) => n.noteTypeId === nt.ankiId && c.exampleFieldOrd !== null && n.fields[c.exampleFieldOrd]?.trim());
        const sampleSplit = sample && c.exampleFieldOrd !== null ? splitExamples(stripSoundAndVideo(sample.fields[c.exampleFieldOrd] ?? "").html) : [];
        const count = pkg.notes.filter((n) => n.noteTypeId === nt.ankiId).length;
        const fieldOptions = nt.fields.map((f) => ({ value: String(f.ord), label: f.name }));
        return (
          <Section key={nt.ankiId} title={`${nt.name} (${count} not)`}>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label="Kelime hangi alanda?"
                value={c.wordFieldOrd === null ? "" : String(c.wordFieldOrd)}
                onChange={(v) =>
                  update({
                    wordFieldOrd: v === "" ? null : Number(v),
                    // aynı alan iki işe seçilemez
                    ...(v !== "" && Number(v) === c.exampleFieldOrd ? { exampleFieldOrd: null, useExampleTag: false } : {}),
                  })
                }
                options={[{ value: "", label: "Yok" }, ...fieldOptions]}
              />
              <SelectField
                label="Örnek cümle hangi alanda?"
                value={c.exampleFieldOrd === null ? "" : String(c.exampleFieldOrd)}
                onChange={(v) =>
                  update({ exampleFieldOrd: v === "" ? null : Number(v), useExampleTag: v !== "" })
                }
                options={[{ value: "", label: "Yok" }, ...fieldOptions.filter((o) => o.value !== String(c.wordFieldOrd))]}
              />
            </div>
            <p className="mt-2 text-sm text-ink-soft">Emin değilsen “Yok” bırak; kartlar dosyadaki gibi gelir.</p>
            {c.exampleFieldOrd !== null && (
              <>
                <label className="mt-3 flex items-start gap-2.5 text-sm">
                  <input type="checkbox" checked={c.useExampleTag} onChange={(e) => update({ useExampleTag: e.target.checked })} className="mt-0.5 size-4" />
                  <span>Kartta bu alanın tamamı yerine her seferinde tek bir cümle göster</span>
                </label>
                {sample && (
                  <div className="mt-3 rounded-lg bg-paper p-3 text-sm">
                    <div className="mb-1 font-medium">Örnek: “{stripHtml(stripSoundAndVideo(sample.fields[c.wordFieldOrd ?? 0] ?? "").html)}”</div>
                    {sampleSplit.length ? (
                      <ol className="list-decimal pl-5 text-ink-soft">
                        {sampleSplit.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ol>
                    ) : (
                      <span className="text-ink-soft">Bu alanda cümle bulunamadı.</span>
                    )}
                  </div>
                )}
              </>
            )}
          </Section>
        );
      })}
      <div className="flex gap-2">
        <Button onClick={onRun}>İçe aktar</Button>
        <Button variant="ghost" onClick={onBack}>
          Geri
        </Button>
      </div>
    </div>
  );
}

function CsvImport({
  name,
  text,
  onRun,
  onCancel,
}: {
  name: string;
  text: string;
  onRun: (rows: string[][], opts: Parameters<typeof importCsvRows>[2]) => Promise<void>;
  onCancel: () => void;
}) {
  const { db } = useApp();
  const noteTypes = useNoteTypes();
  const decks = useDeckList();
  const { headers, body } = useMemo(() => readHeaders(text), [text]);
  const [delimiter, setDelimiter] = useState(() => headers.delimiter ?? detectDelimiter(body));
  const [allowHtml, setAllowHtml] = useState(headers.html ?? false);
  const [skipFirst, setSkipFirst] = useState(false);
  const [noteTypeId, setNoteTypeId] = useState("");
  const [deckId, setDeckId] = useState("");
  const [extraTags, setExtraTags] = useState("");
  const [columns, setColumns] = useState<string[]>([]);

  const rows = useMemo(() => parseDelimited(body, delimiter), [body, delimiter]);
  const width = Math.max(0, ...rows.slice(0, 50).map((r) => r.length));
  const noteType = noteTypes?.find((n) => n.id === noteTypeId) ?? noteTypes?.find((n) => n.name === "Basic") ?? noteTypes?.[0];
  const deck = deckId || (db ? defaultDeckId(db.userId) : "");

  // Varsayılan eşleme: sırayla alanlar; başlıkta etiket sütunu varsa o
  const targets: string[] = Array.from({ length: width }, (_, i) => {
    if (columns[i] !== undefined) return columns[i];
    if (headers.tagsColumn === i) return "tags";
    return noteType?.fields[i] ? `field:${noteType.fields[i].id}` : "ignore";
  });

  if (!noteTypes || !decks || !noteType) return null;
  const targetOptions = [
    { value: "ignore", label: "Yok say" },
    ...noteType.fields.map((f) => ({ value: `field:${f.id}`, label: `Alan: ${fieldLabel(f.name)}` })),
    { value: "tags", label: "Etiketler" },
    { value: "example", label: "Örnek cümle" },
    { value: "translation", label: "Örnek cümlenin çevirisi" },
  ];
  const toTarget = (v: string): ColumnTarget =>
    v.startsWith("field:") ? { kind: "field", fieldId: v.slice(6) } : ({ kind: v } as ColumnTarget);

  return (
    <Section title={name}>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Ayırıcı" value={delimiter} onChange={setDelimiter} options={DELIMITERS} />
        <SelectField label="Not tipi" value={noteType.id} onChange={(v) => { setNoteTypeId(v); setColumns([]); }} options={noteTypes.map((n) => ({ value: n.id, label: noteTypeLabel(n.name) }))} />
        <SelectField label="Deste" value={deck} onChange={setDeckId} options={decks.map((d) => ({ value: d.id, label: d.name }))} />
        <TextField label="Tüm notlara eklenecek etiketler" value={extraTags} onChange={(e) => setExtraTags(e.target.value)} placeholder="ör. yds liste1" />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allowHtml} onChange={(e) => setAllowHtml(e.target.checked)} className="size-4" />
          HTML'e izin ver
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={skipFirst} onChange={(e) => setSkipFirst(e.target.checked)} className="size-4" />
          İlk satır başlık (atla)
        </label>
      </div>

      <h3 className="mt-5 mb-2 text-sm font-semibold">Sütunlar ({rows.length} satır)</h3>
      <div className="overflow-x-auto rounded-lg border border-rule">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              {targets.map((t, i) => (
                <th key={i} className="min-w-40 border-b border-rule p-2 align-bottom font-normal">
                  <select
                    aria-label={`${i + 1}. sütun`}
                    value={t}
                    onChange={(e) => {
                      const next = [...targets];
                      next[i] = e.target.value;
                      setColumns(next);
                    }}
                    className="w-full rounded-md border border-rule bg-surface px-2 py-1.5"
                  >
                    {targetOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(skipFirst ? 1 : 0, (skipFirst ? 1 : 0) + 5).map((r, i) => (
              <tr key={i} className="border-t border-rule">
                {targets.map((_, j) => (
                  <td key={j} className="max-w-56 truncate p-2 text-ink-soft" title={r[j]}>
                    {r[j] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-5 flex gap-2">
        <Button
          disabled={!rows.length}
          onClick={() =>
            void onRun(rows, {
              noteType,
              deckId: deck,
              columns: targets.map(toTarget),
              allowHtml,
              extraTags: extraTags.split(/\s+/).filter(Boolean),
              skipFirstRow: skipFirst,
            })
          }
        >
          İçe aktar
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Vazgeç
        </Button>
      </div>
    </Section>
  );
}
