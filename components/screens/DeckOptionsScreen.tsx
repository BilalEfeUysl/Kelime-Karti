"use client";
// DESTE SEÇENEKLERİ: bir ayar grubu (preset) birden fazla desteye atanabilir.
// Anki'deki seçeneklerin tamamı: günlük sınırlar (+ sadece bu desteye özel sınır),
// yeni kartlar, unutmalar, sülük, gösterim sırası, kardeş kartlar, algoritma
// (FSRS / klasik), FSRS kişiselleştirme, yük dengeleme + kolay günler, zamanlayıcılar.
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { DECK_LIMITS_SETTING, type DeckLimits, useDeckConfigs, useDeckLimits, useDeckList, useDecks, useStudySettings } from "@/components/app/data";
import { useOnline } from "@/components/app/hooks";
import { useUndo } from "@/components/app/undo";
import { Button, Notice, Section, SelectField, TextField } from "@/components/ui";
import { AiClientError, aiJson } from "@/lib/ai/client";
import { insertRow, setSetting, softDeleteRows, updateRow } from "@/lib/db/mutations";
import { subtreeIds } from "@/lib/decks";
import { defaultDeckConfigId } from "@/lib/notetypes/builtins";
import { type DeckOptions, DEFAULT_DECK_OPTIONS, formatSteps, normalizeOptions, parseSteps } from "@/lib/scheduler/config";
import { buildHistories, estimateWorkload } from "@/lib/scheduler/optimize";

/** Sayı kutusu: yazarken serbest, geçerli sayıyı bildirir */
function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  hint?: ReactNode;
  suffix?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const n = Number(text.replace(",", "."));
  const bad = text.trim() === "" || !Number.isFinite(n) || n < min || n > max;
  return (
    <TextField
      label={suffix ? `${label} (${suffix})` : label}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value.replace(",", "."));
        if (e.target.value.trim() !== "" && Number.isFinite(v) && v >= min && v <= max) onChange(v);
      }}
      aria-invalid={bad}
      hint={bad ? `${min} ile ${max} arasında olmalı` : hint}
    />
  );
}

function StepsField({ label, value, onChange, hint }: { label: string; value: string[]; onChange: (s: string[]) => void; hint: string }) {
  const [text, setText] = useState(formatSteps(value));
  useEffect(() => setText(formatSteps(value)), [value]);
  const ok = parseSteps(text) !== null;
  return (
    <TextField
      label={label}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const p = parseSteps(e.target.value);
        if (p) onChange(p);
      }}
      aria-invalid={!ok}
      hint={ok ? hint : "Geçersiz. Örnek: 1m 10m (m dakika, h saat, d gün)"}
    />
  );
}

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4" />
      <span>
        {label}
        {hint && <span className="block text-ink-soft">{hint}</span>}
      </span>
    </label>
  );
}

const WEEKDAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];

export function DeckOptionsScreen() {
  const { db } = useApp();
  const undo = useUndo();
  const params = useSearchParams();
  const deckId = params.get("deste");
  const decks = useDecks();
  const deckList = useDeckList();
  const configs = useDeckConfigs();
  const deckLimits = useDeckLimits();
  const [presetId, setPresetId] = useState<string | null>(null);
  const [o, setO] = useState<DeckOptions | null>(null);
  const [own, setOwn] = useState<{ on: boolean; new: number; review: number } | null>(null);
  const [applyChildren, setApplyChildren] = useState(false);
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const deck = decks?.find((d) => d.id === deckId);
  const defaultId = db ? defaultDeckConfigId(db.userId) : "";

  useEffect(() => {
    if (!deck || !configs || presetId) return;
    const mine = deck.config_id && configs.find((c) => c.id === deck.config_id);
    setPresetId(mine ? mine.id : defaultId);
  }, [deck, configs, presetId, defaultId]);

  const preset = configs?.find((c) => c.id === presetId);
  useEffect(() => {
    if (preset) setO(normalizeOptions(preset.config));
  }, [preset?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!deckLimits || !deckId || own) return;
    const l = deckLimits[deckId];
    setOwn(l ? { on: true, ...l } : { on: false, new: 20, review: 200 });
  }, [deckLimits, deckId, own]);

  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of decks ?? []) {
      if (d.is_filtered) continue;
      const id = d.config_id && configs?.some((c) => c.id === d.config_id) ? d.config_id : defaultId;
      m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [decks, configs, defaultId]);

  if (!db || !decks || !configs || !deckList || !deckLimits) return null;
  if (!deck) return <Notice tone="error">Deste bulunamadı.</Notice>;
  if (deck.is_filtered) return <Notice tone="info">Bu bir filtreli deste. Ayarlarını destenin menüsünden ya da çalışma sayfasından değiştirebilirsin.</Notice>;
  const deckName = deckList.find((d) => d.id === deck.id)?.name ?? deck.name;
  const set = (patch: Partial<DeckOptions>) => {
    if (o) setO({ ...o, ...patch });
    setMessage(null);
  };

  const save = async () => {
    if (!o || !presetId || !own) return;
    await undo.run("Deste seçenekleri", async () => {
      await updateRow(db, "deck_configs", presetId, { config: { ...o } });
      const targets = applyChildren ? subtreeIds(decks, deck.id).filter((id) => !decks.find((d) => d.id === id)?.is_filtered) : [deck.id];
      for (const id of targets) {
        const value = presetId === defaultId ? null : presetId;
        const d = decks.find((x) => x.id === id);
        if (d && d.config_id !== value) await updateRow(db, "decks", id, { config_id: value });
      }
    });
    // Desteye özel sınır (ayrı ayar; geri alma dışında)
    const next: DeckLimits = { ...deckLimits };
    if (own.on) next[deck.id] = { new: own.new, review: own.review };
    else delete next[deck.id];
    if (JSON.stringify(next) !== JSON.stringify(deckLimits)) await setSetting(db, DECK_LIMITS_SETTING, next);
    setMessage({ tone: "ok", text: "Kaydedildi." });
  };

  const createPreset = async () => {
    const name = newName.trim();
    if (!name || !o) return;
    const row = await undo.run("Ayar grubu oluşturma", () => insertRow(db, "deck_configs", { name, config: { ...o } }));
    setPresetId(row.id);
    setNewName("");
    setMessage({ tone: "ok", text: `“${name}” oluşturuldu. Kaydet'e basınca bu desteye atanır.` });
  };

  const deletePreset = async () => {
    if (!preset || preset.id === defaultId) return;
    await undo.run("Ayar grubu silme", async () => {
      for (const d of decks.filter((x) => x.config_id === preset.id)) await updateRow(db, "decks", d.id, { config_id: null });
      await softDeleteRows(db, "deck_configs", [preset.id]);
    });
    setPresetId(defaultId);
    setMessage({ tone: "ok", text: "Silindi; bu ayarı kullanan desteler artık varsayılanı kullanıyor." });
  };

  const sorted = [...configs].sort((a, b) => (a.id === defaultId ? -1 : b.id === defaultId ? 1 : a.name.localeCompare(b.name, "tr")));
  const classic = o && !o.fsrs;

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/calis?deste=${deck.id}`} className="text-sm text-ink-soft hover:text-ink">
          ← {deckName}
        </Link>
        <h1 className="mt-1 font-display text-[28px] font-semibold leading-tight">Deste seçenekleri</h1>
      </div>

      <Section title="Ayar grubu">
        <SelectField
          label="Bu deste hangi ayarları kullansın?"
          value={presetId ?? ""}
          onChange={(v) => {
            setPresetId(v);
            setMessage(null);
          }}
          options={sorted.map((c) => ({ value: c.id, label: `${c.name} (${usage.get(c.id) ?? 0} deste)` }))}
        />
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <TextField label="Yeni ayar grubu" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ör. Yoğun tekrar" className="min-w-48 flex-1" />
          <Button variant="secondary" onClick={() => void createPreset()} disabled={!newName.trim()}>
            Oluştur
          </Button>
          {preset && preset.id !== defaultId && (
            <Button variant="ghost" className="text-danger" onClick={() => void deletePreset()}>
              Bu grubu sil
            </Button>
          )}
        </div>
        <p className="mt-2 text-sm text-ink-soft">Bir ayar grubunu değiştirmek, onu kullanan tüm desteleri etkiler.</p>
      </Section>

      {o && own && (
        <>
          <Section title="Günlük sınırlar">
            <div className="grid gap-4 sm:grid-cols-2">
              <NumField label="Günlük yeni kelime hedefi" value={o.newPerDay} onChange={(v) => set({ newPerDay: Math.round(v) })} min={0} max={9999} />
              <NumField label="Günlük tekrar hedefi" value={o.reviewsPerDay} onChange={(v) => set({ reviewsPerDay: Math.round(v) })} min={0} max={99999} />
            </div>
            <div className="mt-3 space-y-3">
              <Check
                label="Sadece bu desteye özel sınır kullan"
                checked={own.on}
                onChange={(v) => setOwn({ ...own, on: v })}
                hint="Ayar grubundaki sınırların yerine geçer; aynı grubu kullanan diğer desteler etkilenmez."
              />
              {own.on && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <NumField label="Bu deste: yeni / gün" value={own.new} onChange={(v) => setOwn({ ...own, new: Math.round(v) })} min={0} max={9999} />
                  <NumField label="Bu deste: tekrar / gün" value={own.review} onChange={(v) => setOwn({ ...own, review: Math.round(v) })} min={0} max={99999} />
                </div>
              )}
            </div>
            <p className="mt-2 text-sm text-ink-soft">Hedefe ulaşınca çalışma sayfasında “… yeni kelime daha” düğmesiyle devam edebilirsin. Üst destenin hedefi alt destelerin toplamını kapsar.</p>
          </Section>

          <Section title="Yeni kartlar">
            <div className="grid gap-4 sm:grid-cols-2">
              <StepsField label="Öğrenme adımları" value={o.learningSteps} onChange={(v) => set({ learningSteps: v })} hint="ör. 1m 10m (m dakika, h saat, d gün)" />
              <SelectField
                label="Yeni/tekrar karışımı"
                value={o.newReviewMix}
                onChange={(v) => set({ newReviewMix: v as DeckOptions["newReviewMix"] })}
                options={[
                  { value: "mix", label: "Tekrarların arasına karıştır" },
                  { value: "newFirst", label: "Önce yeni kartlar" },
                  { value: "reviewFirst", label: "Önce tekrarlar" },
                ]}
              />
              <SelectField
                label="Yeni kart toplama sırası"
                value={o.newGatherOrder}
                onChange={(v) => set({ newGatherOrder: v as DeckOptions["newGatherOrder"] })}
                options={[
                  { value: "deck", label: "Deste sırasıyla" },
                  { value: "position", label: "Eklenme sırası (eskiden yeniye)" },
                  { value: "positionDesc", label: "Eklenme sırası (yeniden eskiye)" },
                  { value: "randomNotes", label: "Rastgele not" },
                  { value: "randomCards", label: "Rastgele kart" },
                ]}
              />
              <SelectField
                label="Yeni kart gösterim sırası"
                value={o.newSortOrder}
                onChange={(v) => set({ newSortOrder: v as DeckOptions["newSortOrder"] })}
                options={[
                  { value: "gathered", label: "Toplandığı sırada" },
                  { value: "template", label: "Kart şablonuna göre (önce hep 1. kartlar)" },
                  { value: "random", label: "Karışık" },
                ]}
              />
              {classic && (
                <>
                  <NumField label="Mezuniyet aralığı" suffix="gün" value={o.graduatingInterval} onChange={(v) => set({ graduatingInterval: Math.round(v) })} min={1} max={365} />
                  <NumField label="Kolay aralığı" suffix="gün" value={o.easyInterval} onChange={(v) => set({ easyInterval: Math.round(v) })} min={1} max={365} />
                </>
              )}
            </div>
          </Section>

          <Section title="Unutmalar">
            <div className="grid gap-4 sm:grid-cols-2">
              <StepsField label="Yeniden öğrenme adımları" value={o.relearningSteps} onChange={(v) => set({ relearningSteps: v })} hint="Unutulan kart için, ör. 10m" />
              <NumField label="En kısa aralık" suffix="gün" value={o.minimumInterval} onChange={(v) => set({ minimumInterval: Math.round(v) })} min={1} max={365} />
              {classic && (
                <NumField label="Yeni aralık" value={o.newInterval} onChange={(v) => set({ newInterval: v })} min={0} max={1} step={0.05} hint="Unutulan kartın aralığı × bu oran (0 = sıfırdan)" />
              )}
              <NumField label="Çok unutulan kart sınırı" suffix="kez" value={o.leechThreshold} onChange={(v) => set({ leechThreshold: Math.round(v) })} min={1} max={99} hint="Bu kadar kez unutulan kart “zor kart” sayılır" />
              <SelectField
                label="Zor kart olunca"
                value={o.leechAction}
                onChange={(v) => set({ leechAction: v as DeckOptions["leechAction"] })}
                options={[
                  { value: "tag", label: "Sadece “leech” etiketi ekle" },
                  { value: "suspend", label: "Etiketle ve askıya al" },
                ]}
              />
            </div>
          </Section>

          <Section title="Gösterim sırası ve kardeş kartlar">
            <div className="space-y-3">
              <SelectField
                label="Tekrarların sırası"
                value={o.reviewSortOrder}
                onChange={(v) => set({ reviewSortOrder: v as DeckOptions["reviewSortOrder"] })}
                options={[
                  { value: "due", label: "Vadesi en eski önce (gün içinde karışık)" },
                  { value: "retrievabilityAsc", label: "Unutulmaya en yakın önce" },
                  { value: "intervalAsc", label: "Aralığı kısa olan önce" },
                  { value: "intervalDesc", label: "Aralığı uzun olan önce" },
                  { value: "difficultyDesc", label: "En zor önce" },
                  { value: "random", label: "Rastgele" },
                ]}
              />
              <p className="text-sm text-ink-soft">Bir kartı cevaplayınca aynı notun diğer kartları (ör. ters kart) yarına ertelensin:</p>
              <Check label="Aynı notun diğer yeni kartlarını yarına ertele" checked={o.buryNewSiblings} onChange={(v) => set({ buryNewSiblings: v })} />
              <Check label="Aynı notun diğer tekrar kartlarını yarına ertele" checked={o.buryReviewSiblings} onChange={(v) => set({ buryReviewSiblings: v })} />
              <Check label="Aynı notun günlük adımdaki öğrenme kartlarını da ertele" checked={o.buryInterdaySiblings} onChange={(v) => set({ buryInterdaySiblings: v })} />
            </div>
          </Section>

          <AlgorithmSection o={o} set={set} deckIds={subtreeIds(decks, deck.id)} presetDecks={decks.filter((d) => (d.config_id ?? defaultId) === presetId).map((d) => d.id)} />

          <Section title="Yük dengeleme">
            <div className="space-y-3">
              <Check
                label="Tekrarları günlere dengeli dağıt"
                checked={o.loadBalance}
                onChange={(v) => set({ loadBalance: v })}
                hint="Aralık birkaç gün oynatılabildiğinde en boş gün seçilir."
              />
              <p className="text-sm text-ink-soft">Kolay günler: o gün daha az (ya da hiç) tekrar gelsin.</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {WEEKDAYS.map((w, i) => (
                  <SelectField
                    key={w}
                    label={w}
                    value={String(o.easyDays[i])}
                    onChange={(v) => set({ easyDays: o.easyDays.map((x, j) => (j === i ? Number(v) : x)) })}
                    options={[
                      { value: "1", label: "Normal" },
                      { value: "0.5", label: "Yarım" },
                      { value: "0", label: "Boş" },
                    ]}
                  />
                ))}
              </div>
            </div>
          </Section>

          <Section title="Zamanlayıcılar">
            <div className="grid gap-4 sm:grid-cols-2">
              <NumField label="En uzun cevap süresi" suffix="sn" value={o.maxAnswerSeconds} onChange={(v) => set({ maxAnswerSeconds: Math.round(v) })} min={5} max={600} hint="İstatistikte daha uzun süre bu kadar sayılır" />
              <NumField label="Cevabı otomatik göster" suffix="sn, 0 = kapalı" value={o.autoShowAnswerSeconds} onChange={(v) => set({ autoShowAnswerSeconds: Math.round(v) })} min={0} max={600} />
              <NumField label="Otomatik ilerle" suffix="sn, 0 = kapalı" value={o.autoAdvanceSeconds} onChange={(v) => set({ autoAdvanceSeconds: Math.round(v) })} min={0} max={600} />
              <SelectField
                label="Otomatik ilerlerken"
                value={o.autoAdvanceAction}
                onChange={(v) => set({ autoAdvanceAction: v as DeckOptions["autoAdvanceAction"] })}
                options={[
                  { value: "good", label: "“İyi” say" },
                  { value: "again", label: "“Tekrar” say" },
                  { value: "bury", label: "Kartı yarına ertele" },
                ]}
              />
            </div>
          </Section>
        </>
      )}

      <Check label="Bu ayar grubunu alt destelere de ata" checked={applyChildren} onChange={setApplyChildren} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="sticky bottom-20 z-10 flex items-center gap-3 rounded-xl border border-rule bg-paper/95 p-2 backdrop-blur md:bottom-4">
        <Button onClick={() => void save()}>Kaydet</Button>
        <Button variant="ghost" onClick={() => o && setO({ ...DEFAULT_DECK_OPTIONS, newPerDay: o.newPerDay, reviewsPerDay: o.reviewsPerDay })}>
          Varsayılan değerler
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ algoritma

function AlgorithmSection({
  o,
  set,
  presetDecks,
}: {
  o: DeckOptions;
  set: (p: Partial<DeckOptions>) => void;
  deckIds: string[];
  presetDecks: string[];
}) {
  const { db } = useApp();
  const online = useOnline();
  const { timeZone, dayStartHour } = useStudySettings();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  // Bu ayar grubunu kullanan destelerdeki kartlar (filtreli destede olanlar dahil)
  const cards = useLiveQuery(async () => {
    if (!db) return [];
    const ids = new Set(presetDecks);
    return (await db.cards.toArray()).filter((c) => c.deleted_at === null && ids.has(c.original_deck_id ?? c.deck_id));
  }, [db, presetDecks.join(",")]);

  const workload = useMemo(() => {
    if (!cards) return null;
    return [0.8, 0.85, 0.9, 0.95].map((r) => ({ r, load: estimateWorkload(cards, r, o.fsrsParams) }));
  }, [cards, o.fsrsParams]);

  const optimize = async () => {
    if (!db || !cards) return;
    setBusy(true);
    setMsg({ tone: "info", text: "Cevap geçmişin hazırlanıyor…" });
    try {
      const logs = await db.review_logs.toArray();
      const histories = buildHistories(logs, new Set(cards.map((c) => c.id)), timeZone, dayStartHour);
      setMsg({ tone: "info", text: `${histories.length} kartın geçmişi gönderiliyor, hesaplanıyor…` });
      const r = await aiJson<{ params: number[]; reviews: number }>("/api/fsrs/optimize", {
        body: { histories, relearningSteps: o.relearningSteps.length },
      });
      set({ fsrsParams: r.params });
      setMsg({ tone: "ok", text: `${r.reviews} tekrardan kişisel parametreler hesaplandı. Uygulamak için Kaydet'e bas.` });
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof AiClientError ? err.message : "Hesaplanamadı." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Algoritma">
      <div className="space-y-4">
        <div role="radiogroup" aria-label="Algoritma" className="flex flex-wrap gap-1 text-sm">
          {(
            [
              [true, "FSRS (önerilen)"],
              [false, "Klasik (SM-2)"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={o.fsrs === v}
              onClick={() => set({ fsrs: v })}
              className="rounded-md border border-rule px-3 py-1.5 aria-checked:border-accent aria-checked:bg-accent/10"
            >
              {label}
            </button>
          ))}
        </div>
        {o.fsrs ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumField
                label="İstenen hatırlama oranı"
                suffix="%"
                value={Math.round(o.desiredRetention * 100)}
                onChange={(v) => set({ desiredRetention: v / 100 })}
                min={70}
                max={99}
                hint="Yüksek oran = daha sık tekrar. Önerilen: 90"
              />
              <NumField label="En uzun aralık" suffix="gün" value={o.maximumInterval} onChange={(v) => set({ maximumInterval: Math.round(v) })} min={1} max={36500} />
            </div>
            <div className="rounded-lg border border-rule p-3 text-sm">
              <p>
                <strong>Parametreler:</strong> {o.fsrsParams ? "kişisel (senin geçmişinden hesaplandı)" : "varsayılan"}
              </p>
              <p className="mt-1 text-ink-soft">
                FSRS, cevap geçmişinden senin hafızana uygun parametreleri öğrenebilir (en az 400 tekrar gerekir). Hesaplama sunucuda birkaç saniye sürer; sadece
                tekrarların puan ve tarih bilgisi gönderilir, kart içeriği gönderilmez.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void optimize()} disabled={busy || !online}>
                  {busy ? "Hesaplanıyor…" : online ? "Parametreleri optimize et" : "Optimize (internet gerekiyor)"}
                </Button>
                {o.fsrsParams && (
                  <Button variant="ghost" onClick={() => set({ fsrsParams: null })}>
                    Varsayılana dön
                  </Button>
                )}
              </div>
              {msg && <Notice tone={msg.tone === "info" ? "info" : msg.tone}>{msg.text}</Notice>}
            </div>
            {workload && cards && cards.some((c) => c.state !== 0) && (
              <div className="text-sm">
                <p className="mb-1 font-medium">Tahmini günlük tekrar yükü (yeni kartlar hariç)</p>
                <table className="w-full max-w-sm text-left">
                  <thead className="text-ink-soft">
                    <tr>
                      <th className="py-1 font-medium">Hatırlama oranı</th>
                      <th className="py-1 text-right font-medium">Günde tekrar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workload.map((w) => (
                      <tr key={w.r} className={`border-t border-rule ${Math.abs(w.r - o.desiredRetention) < 0.001 ? "font-semibold" : ""}`}>
                        <td className="py-1">%{Math.round(w.r * 100)}</td>
                        <td className="py-1 text-right tabular-nums">~{Math.round(w.load)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <NumField label="Başlangıç kolaylığı" value={o.startingEase} onChange={(v) => set({ startingEase: v })} min={1.31} max={5} step={0.05} hint="2,5 = aralık her doğru cevapta ~2,5 katına çıkar" />
            <NumField label="Kolay bonusu" value={o.easyBonus} onChange={(v) => set({ easyBonus: v })} min={1} max={5} step={0.05} />
            <NumField label="Aralık çarpanı" value={o.intervalModifier} onChange={(v) => set({ intervalModifier: v })} min={0.5} max={2} step={0.05} hint="Tüm aralıkları büyütür/küçültür" />
            <NumField label="Zor aralığı" value={o.hardInterval} onChange={(v) => set({ hardInterval: v })} min={1} max={2} step={0.05} />
            <NumField label="En uzun aralık" suffix="gün" value={o.maximumInterval} onChange={(v) => set({ maximumInterval: Math.round(v) })} min={1} max={36500} />
          </div>
        )}
      </div>
    </Section>
  );
}
