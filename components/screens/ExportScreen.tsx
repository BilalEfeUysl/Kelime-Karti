"use client";
// DIŞA AKTAR ve YEDEK (/disa-aktar)
//   - Anki paketi (.apkg: deste ya da tümü; .colpkg: tüm koleksiyon)
//   - Metin (.txt, Anki'nin düz metin biçimi)
//   - Yedek: indir / geri yükle; haftalık otomatik yedek (sunucuda son 3)
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { type ReactNode, useEffect, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useDayInfo, useDeckList, useDecks } from "@/components/app/data";
import { useOnline } from "@/components/app/hooks";
import { Button, Notice, Section, SelectField, TextField } from "@/components/ui";
import {
  AUTO_BACKUP_SETTING,
  type AutoBackupState,
  createBackup,
  downloadServerBackup,
  listServerBackups,
  readBackup,
  restoreBackup,
  uploadServerBackup,
} from "@/lib/backup";
import { getSetting, setSetting } from "@/lib/db/mutations";
import { subtreeIds } from "@/lib/decks";
import { exportAnki } from "@/lib/export/anki";
import { exportText } from "@/lib/export/text";
import { loadSql } from "@/lib/import/sql";
import { formatBytes } from "@/lib/storage";
import { getMediaData } from "@/lib/sync/media";

function download(bytes: Uint8Array | string, name: string, type: string) {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const stamp = () => new Date().toISOString().slice(0, 10);
const safe = (s: string) => s.replace(/::/g, "-").replace(/[^\p{L}\p{N}\- ]+/gu, "").trim() || "deste";

function Status({ msg }: { msg: { tone: "ok" | "error" | "info"; text: ReactNode } | null }) {
  return msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null;
}

export function ExportScreen() {
  return (
    <div className="space-y-5">
      <div>
        <Link href="/ayarlar" className="text-sm text-ink-soft hover:text-ink">
          ← Ayarlar
        </Link>
        <h1 className="mt-1 font-display text-[28px] font-semibold leading-tight">Dışa aktar ve yedek</h1>
      </div>
      <AnkiExport />
      <TextExport />
      <BackupSection />
    </div>
  );
}

/** Seçilen kapsamın verileri */
async function gather(db: NonNullable<ReturnType<typeof useApp>["db"]>, deckIds: Set<string> | null) {
  const [noteTypes, notes, cards, decks, examples, logs] = await Promise.all([
    db.note_types.toArray(),
    db.notes.toArray(),
    db.cards.toArray(),
    db.decks.toArray(),
    db.note_examples.toArray(),
    db.review_logs.toArray(),
  ]);
  const liveCards = cards.filter((c) => c.deleted_at === null && (!deckIds || deckIds.has(c.original_deck_id ?? c.deck_id)));
  const noteIds = new Set(liveCards.map((c) => c.note_id));
  const cardIds = new Set(liveCards.map((c) => c.id));
  return {
    noteTypes: noteTypes.filter((t) => t.deleted_at === null),
    notes: notes.filter((n) => n.deleted_at === null && noteIds.has(n.id)),
    cards: liveCards,
    decks,
    examples,
    logs: logs.filter((l) => l.deleted_at === null && cardIds.has(l.card_id)),
  };
}

function AnkiExport() {
  const { db, media } = useApp();
  const decks = useDecks();
  const deckList = useDeckList();
  const { day } = useDayInfo();
  const [format, setFormat] = useState<"apkg" | "colpkg">("apkg");
  const [deckId, setDeckId] = useState("");
  const [history, setHistory] = useState(true);
  const [exMode, setExMode] = useState<"none" | "new" | "field">("new");
  const [exField, setExField] = useState("Back");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  if (!db || !decks || !deckList) return null;

  const run = async () => {
    setBusy(true);
    setMsg({ tone: "info", text: "Hazırlanıyor…" });
    try {
      const ids = format === "apkg" && deckId ? new Set(subtreeIds(decks, deckId)) : null;
      const data = await gather(db, ids);
      const SQL = await loadSql();
      const out = await exportAnki(SQL, {
        ...data,
        includeScheduling: format === "colpkg" || history,
        examplesField: exMode === "none" ? null : exMode === "new" ? "Examples" : exField.trim() || "Examples",
        getMedia: async (name) => {
          const r = await getMediaData(db, name.split(".")[0], media).catch(() => null);
          return r ? new Uint8Array(r.data) : null;
        },
        now: Date.now(),
        dayZero: day.dayStart - 365 * 86_400_000,
      });
      const deckName = deckId ? deckList.find((d) => d.id === deckId)?.name ?? "deste" : "tum-koleksiyon";
      download(out.bytes, format === "colpkg" ? `kelime-karti-${stamp()}.colpkg` : `${safe(deckName)}-${stamp()}.apkg`, "application/octet-stream");
      setMsg({
        tone: out.missingMedia ? "info" : "ok",
        text: `${out.notes} not, ${out.cards} kart, ${out.media} resim aktarıldı.${out.missingMedia ? ` ${out.missingMedia} resim bu cihazda olmadığı için eklenemedi (internete bağlanıp tekrar dene).` : ""}`,
      });
    } catch (err) {
      setMsg({ tone: "error", text: `Dışa aktarılamadı: ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Deste paketi">
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">Kartlarını tek bir dosya olarak indir. Bu dosyayı başka bir cihazda ya da .apkg dosyası açabilen başka bir kart uygulamasında içe aktarabilirsin.</p>
        <div role="radiogroup" aria-label="Biçim" className="flex flex-wrap gap-1 text-sm">
          {(
            [
              ["apkg", "Deste paketi (.apkg)"],
              ["colpkg", "Tüm koleksiyon (.colpkg)"],
            ] as const
          ).map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={format === v} onClick={() => setFormat(v)} className="rounded-md border border-rule px-3 py-1.5 aria-checked:border-accent aria-checked:bg-accent/10">
              {label}
            </button>
          ))}
        </div>
        {format === "colpkg" && <Notice tone="info">.colpkg dosyası açıldığı uygulamadaki tüm kartların YERİNE geçer. Var olan kartlara eklemek için .apkg kullan.</Notice>}
        {format === "apkg" && (
          <SelectField label="Ne aktarılsın?" value={deckId} onChange={setDeckId} options={[{ value: "", label: "Tüm koleksiyon" }, ...deckList.map((d) => ({ value: d.id, label: d.name }))]} />
        )}
        {format === "apkg" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} className="size-4" />
            Çalışma geçmişini de aktar (kapalıysa tüm kartlar yeni olarak gider)
          </label>
        )}
        <SelectField
          label="Örnek cümleler"
          value={exMode}
          onChange={(v) => setExMode(v as typeof exMode)}
          options={[
            { value: "new", label: "Yeni “Examples” alanına liste olarak ekle" },
            { value: "field", label: "Var olan bir alanın sonuna ekle" },
            { value: "none", label: "Aktarma" },
          ]}
        />
        {exMode === "field" && <TextField label="Alan adı" value={exField} onChange={(e) => setExField(e.target.value)} hint="Not tipinde bu adda alan yoksa yeni alan olarak eklenir." />}
        <Button onClick={() => void run()} disabled={busy}>
          {busy ? "Hazırlanıyor…" : "İndir"}
        </Button>
        <Status msg={msg} />
      </div>
    </Section>
  );
}

function TextExport() {
  const { db } = useApp();
  const decks = useDecks();
  const deckList = useDeckList();
  const [deckId, setDeckId] = useState("");
  const [html, setHtml] = useState(false);
  const [examples, setExamples] = useState(true);
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  if (!db || !decks || !deckList) return null;
  const run = async () => {
    const data = await gather(db, deckId ? new Set(subtreeIds(decks, deckId)) : null);
    const { text, notes } = exportText({ ...data, html, includeExamples: examples });
    download(text, `${safe(deckId ? deckList.find((d) => d.id === deckId)?.name ?? "deste" : "kelimeler")}-${stamp()}.txt`, "text/plain;charset=utf-8");
    setMsg({ tone: "ok", text: `${notes} not aktarıldı.` });
  };
  return (
    <Section title="Metin dosyası (.txt)">
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">Excel ya da Google E-Tablolar'da açılır; bu uygulamaya geri de aktarılabilir.</p>
        <SelectField label="Ne aktarılsın?" value={deckId} onChange={setDeckId} options={[{ value: "", label: "Tüm koleksiyon" }, ...deckList.map((d) => ({ value: d.id, label: d.name }))]} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={html} onChange={(e) => setHtml(e.target.checked)} className="size-4" /> Biçimlendirmeyi (HTML) koru
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={examples} onChange={(e) => setExamples(e.target.checked)} className="size-4" /> Örnek cümleleri ayrı sütun olarak ekle
        </label>
        <Button variant="secondary" onClick={() => void run()}>
          İndir
        </Button>
        <Status msg={msg} />
      </div>
    </Section>
  );
}

function BackupSection() {
  const { db, user, hasSession } = useApp();
  const online = useOnline();
  const [withMedia, setWithMedia] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const [server, setServer] = useState<{ name: string; size: number }[] | null>(null);
  const auto = useLiveQuery(async () => (db ? getSetting<AutoBackupState>(db, AUTO_BACKUP_SETTING, { enabled: true, lastAt: null }) : null), [db]);
  const canServer = online && !!hasSession;

  const refresh = async () => {
    if (!user || !canServer) return;
    try {
      setServer(await listServerBackups(user.id));
    } catch (err) {
      setServer([]);
      setMsg({ tone: "error", text: `Sunucudaki yedekler okunamadı: ${(err as Error).message}` });
    }
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canServer, user?.id]);

  if (!db || !auto) return null;

  const restore = async (bytes: Uint8Array) => {
    const file = readBackup(bytes);
    const when = new Date(file.createdAt).toLocaleString("tr-TR");
    if (!window.confirm(`${when} tarihli yedek geri yüklensin mi? Yedekteki kayıtlar bu cihaza yazılır ve eşlenir; yedekten sonra eklediklerin silinmez.`)) return;
    setBusy(true);
    setMsg({ tone: "info", text: "Geri yükleniyor…" });
    try {
      const r = await restoreBackup(db, file, (t) => setMsg({ tone: "info", text: `Geri yükleniyor: ${t}…` }));
      setMsg({ tone: "ok", text: `Geri yüklendi: ${r.notes ?? 0} not, ${r.cards ?? 0} kart, ${r.review_logs ?? 0} cevap kaydı güncellendi/eklendi.` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Yedek">
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={withMedia} onChange={(e) => setWithMedia(e.target.checked)} className="size-4" /> Resimleri de ekle (dosya büyür)
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const { bytes } = await createBackup(db, { includeMedia: withMedia });
                  download(bytes, `kelime-karti-yedek-${stamp()}.json.gz`, "application/gzip");
                  setMsg({ tone: "ok", text: `Yedek indirildi (${formatBytes(bytes.length)}).` });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Şimdi yedekle (indir)
            </Button>
            <label className="cursor-pointer rounded-lg border border-rule bg-surface px-4 py-2.5 text-sm font-semibold hover:border-ink-soft">
              Yedekten geri yükle…
              <input
                type="file"
                accept=".gz,.json,application/gzip,application/json"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  try {
                    await restore(new Uint8Array(await f.arrayBuffer()));
                  } catch (err) {
                    setMsg({ tone: "error", text: (err as Error).message });
                  }
                }}
              />
            </label>
          </div>
        </div>

        <div className="space-y-2 border-t border-rule pt-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={auto.enabled} onChange={(e) => void setSetting(db, AUTO_BACKUP_SETTING, { ...auto, enabled: e.target.checked })} className="mt-0.5 size-4" />
            <span>
              Haftalık otomatik yedek (sunucuya, sıkıştırılmış; en fazla son 3 yedek saklanır)
              <span className="block text-ink-soft">
                Son otomatik yedek: {auto.lastAt ? new Date(auto.lastAt).toLocaleString("tr-TR") : "henüz yok"}. Resimler zaten sunucuda olduğu için eklenmez.
              </span>
            </span>
          </label>
          {!canServer && <Notice tone="warn">Sunucudaki yedekler için internet ve oturum gerekiyor.</Notice>}
          {canServer && (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await uploadServerBackup(db);
                    setMsg({ tone: "ok", text: "Sunucuya yedeklendi." });
                    await refresh();
                  } catch (err) {
                    setMsg({ tone: "error", text: `Yedeklenemedi: ${(err as Error).message}` });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Şimdi sunucuya yedekle
              </Button>
              {server && server.length > 0 && (
                <ul className="divide-y divide-rule rounded-lg border border-rule text-sm">
                  {server.map((f) => (
                    <li key={f.name} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="flex-1 font-mono text-xs">{f.name}</span>
                      <span className="text-ink-soft">{formatBytes(f.size)}</span>
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-accent hover:bg-accent/10"
                        onClick={async () => download(await downloadServerBackup(user!.id, f.name), f.name, "application/gzip")}
                      >
                        İndir
                      </button>
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-accent hover:bg-accent/10"
                        onClick={async () => {
                          try {
                            await restore(await downloadServerBackup(user!.id, f.name));
                          } catch (err) {
                            setMsg({ tone: "error", text: (err as Error).message });
                          }
                        }}
                      >
                        Geri yükle
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <Status msg={msg} />
      </div>
    </Section>
  );
}
