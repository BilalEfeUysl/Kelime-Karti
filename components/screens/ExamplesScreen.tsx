"use client";
// ÖRNEK CÜMLELER (/ornek-cumleler): Gemini ile toplu üretim + onay bekleyenler.
//   - Kaynak: deste, arama ya da kart tarayıcıda seçilen notlar
//   - İş sunucuda saklanır; uygulama açıkken ilerler (başka cihazdan da devam eder)
//   - Üretilen cümleler "onay bekliyor" olarak gelir (Ayarlar'da otomatik onay açılabilir)
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useKeyStatus } from "@/components/ai/hooks";
import { useApp } from "@/components/app/AppProvider";
import { useDayInfo, useDeckList } from "@/components/app/data";
import { useUndo } from "@/components/app/undo";
import { useBrowseBase } from "@/components/browse/data";
import { Button, Notice, Section, SelectField, TextField } from "@/components/ui";
import { AiClientError } from "@/lib/ai/client";
import { AI_SELECTION_KEY } from "@/lib/ai/local";
import { BATCH_SIZE } from "@/lib/ai/prompts";
import { type AiJob, aiRunner } from "@/lib/ai/runner";
import { softDeleteRows, updateRows } from "@/lib/db/mutations";
import type { NoteExampleRow } from "@/lib/db/types";
import { searchCards } from "@/lib/search/evaluate";
import { quoteSearchValue, SearchError } from "@/lib/search/parser";
import { readJSON, writeJSON } from "@/lib/storage";


export function ExamplesScreen() {
  const { status, online } = useKeyStatus();
  return (
    <div className="space-y-5">
      <div>
        <Link href="/ayarlar" className="text-sm text-ink-soft hover:text-ink">
          ← Ayarlar
        </Link>
        <h1 className="mt-1 font-display text-[28px] font-semibold leading-tight">Örnek cümleler</h1>
        <p className="mt-1 text-sm text-ink-soft">Gemini ile kelimelerine toplu örnek cümle üret, sonra onayla.</p>
      </div>
      {!online && <Notice tone="warn">Üretim için internet gerekiyor. Onay bekleyen cümleleri internetsiz de onaylayabilirsin.</Notice>}
      {online && status && !status.hasKey && (
        <Notice tone="info">
          Önce{" "}
          <Link href="/ayarlar#gemini" className="font-semibold underline">
            Ayarlar → Gemini
          </Link>{" "}
          bölümünden kendi API anahtarını gir.
        </Notice>
      )}
      {status?.hasKey && <NewJob />}
      {status?.hasKey && <Jobs />}
      <Pending />
    </div>
  );
}

// ------------------------------------------------------------------ yeni iş

function NewJob() {
  const params = useSearchParams();
  const base = useBrowseBase();
  const decks = useDeckList();
  const { day, now } = useDayInfo();
  const [selection] = useState<string[] | null>(() => (params.get("secim") === "1" ? readJSON<string[]>(AI_SELECTION_KEY) : null));
  const [source, setSource] = useState<"selection" | "deck" | "search">(selection?.length ? "selection" : "deck");
  const [deckId, setDeckId] = useState("");
  const [query, setQuery] = useState("examples:0");
  const [count, setCount] = useState("2");
  const [level, setLevel] = useState("YDS / B1-B2");
  const [translate, setTranslate] = useState(true);
  const [skipIfHas, setSkipIfHas] = useState("1");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const runner = useSyncExternalStore(aiRunner.subscribe, aiRunner.getState, aiRunner.getState);

  const chosenDeck = deckId || decks?.[0]?.id || "";
  const target = useMemo((): { ids: string[]; error?: string } => {
    if (!base) return { ids: [] };
    if (source === "selection") return { ids: selection ?? [] };
    const q = source === "deck" ? `deck:${quoteSearchValue(decks?.find((d) => d.id === chosenDeck)?.name ?? "")}` : query;
    try {
      const cards = searchCards(q, { ...base, now, day });
      return { ids: [...new Set(cards.map((c) => c.note_id))] };
    } catch (err) {
      return { ids: [], error: err instanceof SearchError ? err.message : String(err) };
    }
  }, [base, source, selection, decks, chosenDeck, query, now, day]);

  const skipN = Number(skipIfHas) || 0;
  const willSkip = useMemo(() => {
    if (!base || !skipN) return 0;
    return target.ids.filter((id) => (base.exampleCounts.get(id) ?? 0) >= skipN).length;
  }, [base, target.ids, skipN]);
  const toDo = target.ids.length - willSkip;
  const requests = Math.ceil(toDo / BATCH_SIZE);
  const days = runner.dailyLimit ? Math.max(1, Math.ceil(requests / runner.dailyLimit)) : null;

  const start = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await aiRunner.create(target.ids, { count: Number(count), level, translate, skipIfHas: skipN, label: describe() });
      if (source === "selection") writeJSON(AI_SELECTION_KEY, null);
      setMessage({ tone: "ok", text: "Başladı. Uygulama açık kaldıkça ilerler; kapatırsan sonra kaldığı yerden devam eder." });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof AiClientError ? err.message : "Başlatılamadı." });
    } finally {
      setBusy(false);
    }
  };
  const describe = () =>
    source === "selection" ? "Kart tarayıcı seçimi" : source === "deck" ? (decks?.find((d) => d.id === chosenDeck)?.name ?? "Deste") : query;

  return (
    <Section title="Yeni toplu üretim">
      <div className="space-y-3">
        <div role="radiogroup" aria-label="Kaynak" className="flex flex-wrap gap-1 text-sm">
          {(
            [
              ["deck", "Deste"],
              ["search", "Arama"],
              ...(selection?.length ? ([["selection", `Seçilen ${selection.length} not`]] as const) : []),
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={source === v}
              onClick={() => setSource(v)}
              className="rounded-md border border-rule px-3 py-1.5 aria-checked:border-accent aria-checked:bg-accent/10"
            >
              {label}
            </button>
          ))}
        </div>
        {source === "deck" && (
          <SelectField label="Deste (alt desteler dahil)" value={chosenDeck} onChange={setDeckId} options={(decks ?? []).map((d) => ({ value: d.id, label: d.name }))} />
        )}
        {source === "search" && (
          <TextField label="Arama (kart tarayıcıdaki gibi)" value={query} onChange={(e) => setQuery(e.target.value)} hint="ör. examples:0 deck:YDS ya da tag:yds::fiil" />
        )}
        {target.error && <Notice tone="error">{target.error}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Kelime başına cümle"
            value={count}
            onChange={setCount}
            options={["1", "2", "3", "4", "5"].map((v) => ({ value: v, label: v }))}
          />
          <TextField label="Seviye" value={level} onChange={(e) => setLevel(e.target.value)} />
          <SelectField
            label="Zaten cümlesi olanlar"
            value={skipIfHas}
            onChange={setSkipIfHas}
            options={[
              { value: "0", label: "Atlama (hepsine üret)" },
              { value: "1", label: "En az 1 cümlesi olanları atla" },
              { value: "2", label: "En az 2 cümlesi olanları atla" },
              { value: "3", label: "En az 3 cümlesi olanları atla" },
            ]}
          />
          <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
            <input type="checkbox" checked={translate} onChange={(e) => setTranslate(e.target.checked)} className="size-4" />
            Türkçe çeviri de üret
          </label>
        </div>
        <p className="text-sm text-ink-soft">
          {target.ids.length} not{willSkip ? `, ${willSkip} tanesi atlanacak` : ""}. Yaklaşık {requests} Gemini isteği
          {days ? ` (günlük hakkınla tahmini ${days} gün)` : ""}.
        </p>
        <Button onClick={() => void start()} disabled={busy || !toDo || !!target.error}>
          {busy ? "Başlatılıyor…" : `${toDo} kelime için başlat`}
        </Button>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
      </div>
    </Section>
  );
}

// -------------------------------------------------------------------- işler

const STATUS_LABEL: Record<AiJob["status"], string> = {
  pending: "Sırada",
  running: "Çalışıyor",
  paused: "Duraklatıldı",
  done: "Bitti",
  failed: "Hata",
  cancelled: "İptal edildi",
};

function Jobs() {
  const runner = useSyncExternalStore(aiRunner.subscribe, aiRunner.getState, aiRunner.getState);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void aiRunner.refreshJobs().catch((e) => setError(e instanceof AiClientError ? e.message : null));
  }, []);
  const act = async (id: string, status: "running" | "paused" | "cancelled") => {
    try {
      await aiRunner.setStatus(id, status);
    } catch (e) {
      setError(e instanceof AiClientError ? e.message : "Yapılamadı.");
    }
  };
  const jobs = runner.jobs.filter((j) => j.status !== "cancelled");
  if (!jobs.length) return null;
  return (
    <Section title="İşler">
      <div className="space-y-3">
        {runner.message && <Notice tone={runner.phase === "limit" || runner.phase === "offline" ? "warn" : runner.phase === "error" ? "error" : "info"}>{runner.message}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        <ul className="space-y-3">
          {jobs.map((j) => {
            const left = j.total - j.done;
            const days = runner.dailyLimit ? Math.ceil(Math.ceil(left / BATCH_SIZE) / runner.dailyLimit) : null;
            return (
              <li key={j.id} className="rounded-lg border border-rule p-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{j.params.label || "Toplu üretim"}</span>
                  <span className="text-sm text-ink-soft">
                    {STATUS_LABEL[j.status]}, kelime başına {j.params.count} cümle
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuemin={0} aria-valuemax={j.total} aria-valuenow={j.done}>
                  <div className="h-full bg-accent transition-all" style={{ width: `${j.total ? (j.done / j.total) * 100 : 0}%` }} />
                </div>
                <p className="mt-1.5 text-sm tabular-nums">
                  {j.done} / {j.total} kelime
                  {j.status === "running" && left > 0 && days !== null && `, tahmini ${days <= 1 ? "bugün" : `${days} gün`} içinde biter`}
                  {j.status === "running" && `, bugün kalan hak: ${runner.remainingToday}`}
                </p>
                {j.error && <p className="mt-1 text-sm text-danger">{j.error}</p>}
                {j.status !== "done" && (
                  <div className="mt-2 flex gap-1">
                    {j.status === "running" ? (
                      <Button variant="secondary" className="min-h-9 text-sm" onClick={() => void act(j.id, "paused")}>
                        Duraklat
                      </Button>
                    ) : (
                      <Button variant="secondary" className="min-h-9 text-sm" onClick={() => void act(j.id, "running")}>
                        Devam et
                      </Button>
                    )}
                    <Button variant="ghost" className="min-h-9 text-sm text-danger" onClick={() => void act(j.id, "cancelled")}>
                      İptal
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------ onay bekleyen

function Pending() {
  const { db } = useApp();
  const undo = useUndo();
  const [limit, setLimit] = useState(30);
  const [editing, setEditing] = useState<{ id: string; text: string; translation: string } | null>(null);
  const data = useLiveQuery(async () => {
    if (!db) return null;
    const rows = (await db.note_examples.toArray()).filter((e) => e.deleted_at === null && !e.approved);
    const notes = new Map((await db.notes.bulkGet([...new Set(rows.map((r) => r.note_id))])).filter(Boolean).map((n) => [n!.id, n!]));
    const groups = new Map<string, NoteExampleRow[]>();
    for (const r of rows) {
      const n = notes.get(r.note_id);
      if (!n || n.deleted_at !== null) continue;
      groups.set(r.note_id, [...(groups.get(r.note_id) ?? []), r]);
    }
    return { groups: [...groups].map(([id, list]) => ({ note: notes.get(id)!, list: list.sort((a, b) => a.position - b.position) })), total: rows.length };
  }, [db]);
  if (!db || !data) return null;

  const approve = (ids: string[], label: string) => undo.run(label, () => updateRows(db, "note_examples", ids.map((id) => ({ id, patch: { approved: true } }))));
  const remove = (ids: string[], label: string) => undo.run(label, () => softDeleteRows(db, "note_examples", ids));
  const allIds = data.groups.flatMap((g) => g.list.map((e) => e.id));

  return (
    <Section title={`Onay bekleyen cümleler (${allIds.length})`}>
      {allIds.length === 0 ? (
        <p className="text-sm text-ink-soft">Onay bekleyen cümle yok. Onayladığın cümleler çalışırken kartlarda görünür.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void approve(allIds, "Tüm cümleleri onaylama")}>
              Hepsini onayla
            </Button>
            <Button variant="ghost" className="text-danger" onClick={() => void remove(allIds, "Tüm cümleleri silme")}>
              Hepsini sil
            </Button>
          </div>
          <ul className="divide-y divide-rule">
            {data.groups.slice(0, limit).map(({ note, list }) => (
              <li key={note.id} className="py-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="font-semibold">{note.sort_field}</span>
                  <button type="button" className="ml-auto text-sm text-accent hover:underline" onClick={() => void approve(list.map((e) => e.id), "Cümle onaylama")}>
                    Bu kelimedekileri onayla
                  </button>
                </div>
                <ul className="space-y-2">
                  {list.map((e) =>
                    editing?.id === e.id ? (
                      <li key={e.id} className="space-y-2 rounded-lg bg-surface p-2">
                        <textarea
                          value={editing.text}
                          onChange={(ev) => setEditing({ ...editing, text: ev.target.value })}
                          rows={2}
                          aria-label="Cümle"
                          className="w-full rounded-md border border-rule bg-paper px-2 py-1.5 focus:border-accent focus:outline-none"
                        />
                        <input
                          value={editing.translation}
                          onChange={(ev) => setEditing({ ...editing, translation: ev.target.value })}
                          aria-label="Çeviri"
                          placeholder="Türkçe çeviri"
                          className="w-full rounded-md border border-rule bg-paper px-2 py-1.5 focus:border-accent focus:outline-none"
                        />
                        <div className="flex gap-2">
                          <Button
                            className="min-h-9 text-sm"
                            onClick={async () => {
                              await undo.run("Cümle düzenleme", () =>
                                updateRows(db, "note_examples", [
                                  { id: e.id, patch: { text: editing.text.trim(), translation: editing.translation.trim() || null, approved: true } },
                                ]),
                              );
                              setEditing(null);
                            }}
                            disabled={!editing.text.trim()}
                          >
                            Kaydet ve onayla
                          </Button>
                          <Button variant="ghost" className="min-h-9 text-sm" onClick={() => setEditing(null)}>
                            Vazgeç
                          </Button>
                        </div>
                      </li>
                    ) : (
                      <li key={e.id} className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="italic">{e.text}</p>
                          {e.translation && <p className="text-sm text-ink-soft">{e.translation}</p>}
                        </div>
                        <div className="flex shrink-0 gap-0.5 text-sm">
                          <button type="button" title="Onayla" aria-label="Onayla" onClick={() => void approve([e.id], "Cümle onaylama")} className="grid size-9 place-items-center rounded-md text-ok hover:bg-ok/10">
                            ✓
                          </button>
                          <button
                            type="button"
                            title="Düzenle"
                            aria-label="Düzenle"
                            onClick={() => setEditing({ id: e.id, text: e.text, translation: e.translation ?? "" })}
                            className="grid size-9 place-items-center rounded-md text-ink-soft hover:bg-ink/5"
                          >
                            ✎
                          </button>
                          <button type="button" title="Sil" aria-label="Sil" onClick={() => void remove([e.id], "Cümle silme")} className="grid size-9 place-items-center rounded-md text-danger hover:bg-danger/10">
                            ✕
                          </button>
                        </div>
                      </li>
                    ),
                  )}
                </ul>
              </li>
            ))}
          </ul>
          {data.groups.length > limit && (
            <Button variant="ghost" onClick={() => setLimit(limit + 30)}>
              Daha fazla göster ({data.groups.length - limit} kelime daha)
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}
