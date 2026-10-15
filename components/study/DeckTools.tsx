"use client";
// Deste araçları: özel çalışma penceresi, filtreli deste oluştur/düzenle,
// filtreli deste düğmeleri (yeniden oluştur / boşalt).
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useAllTags, useDayInfo } from "@/components/app/data";
import { useUndo } from "@/components/app/undo";
import { TagInput } from "@/components/editor/TagInput";
import { Button, Modal, Notice, SelectField, TextField } from "@/components/ui";
import { type CustomKind, increaseLimit, startCustomStudy } from "@/lib/customStudy";
import type { DeckRow } from "@/lib/db/types";
import {
  buildFilteredDeck,
  createFilteredDeck,
  emptyFilteredDeck,
  FILTER_ORDERS,
  type FilterConfig,
  type FilterOrder,
  filterOf,
  updateFilteredDeck,
} from "@/lib/filtered";
import { loadSearchData } from "@/lib/search/load";
import { parseSearch, SearchError } from "@/lib/search/parser";

// ------------------------------------------------------------ özel çalışma

const KINDS: { value: CustomKind | "moreNew" | "moreReview"; label: string; hint: string }[] = [
  { value: "moreNew", label: "Bugünkü yeni kart sınırını artır", hint: "Sadece bugün için; yarın normale döner." },
  { value: "moreReview", label: "Bugünkü tekrar sınırını artır", hint: "Sadece bugün için." },
  { value: "forgotten", label: "Unutulan kartları tekrar çalış", hint: "Son günlerde “Tekrar”a bastıkların. Zamanlamayı değiştirmez." },
  { value: "ahead", label: "İleriyi tekrar et", hint: "Önümüzdeki günlerde gelecek tekrarları şimdi çalış." },
  { value: "previewNew", label: "Yeni kartları önizle", hint: "Son günlerde eklenen yeni kartlar. Zamanlamayı değiştirmez." },
  { value: "tag", label: "Etikete göre çalış", hint: "Seçtiğin etiketlerdeki kartlar." },
];

export function CustomStudyModal({ deck, deckName, onClose }: { deck: DeckRow; deckName: string; onClose: () => void }) {
  const { db } = useApp();
  const undo = useUndo();
  const router = useRouter();
  const { day, now } = useDayInfo();
  const allTags = useAllTags();
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("moreNew");
  const [amount, setAmount] = useState("10");
  const [days, setDays] = useState("1");
  const [tags, setTags] = useState<string[]>([]);
  const [tagState, setTagState] = useState<"new" | "due" | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!db) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "moreNew" || kind === "moreReview") {
        await increaseLimit(db, deck.id, kind === "moreNew" ? "new" : "review", Number(amount) || 0, day.today);
        onClose();
        return;
      }
      if (kind === "tag" && !tags.length) throw new Error("En az bir etiket seç.");
      const data = await loadSearchData(db, day, now);
      const { deckId, count } = await undo.run("Özel çalışma", () =>
        startCustomStudy(db, { kind, deckName, days: Number(days) || 1, tags, tagState, limit: Number(amount) || 100 }, data),
      );
      if (!count) throw new Error("Bu seçime uyan kart bulunamadı.");
      onClose();
      router.push(`/calis?deste=${deckId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const current = KINDS.find((k) => k.value === kind)!;
  return (
    <Modal title="Özel çalışma" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <fieldset className="space-y-1.5">
          <legend className="sr-only">Ne çalışmak istiyorsun?</legend>
          {KINDS.map((k) => (
            <label key={k.value} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink/5">
              <input type="radio" name="kind" checked={kind === k.value} onChange={() => setKind(k.value)} className="size-4" />
              <span>{k.label}</span>
            </label>
          ))}
        </fieldset>
        <p className="text-sm text-ink-soft">{current.hint}</p>
        {(kind === "moreNew" || kind === "moreReview") && (
          <TextField label="Kaç kart artsın?" type="number" min={1} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        )}
        {(kind === "forgotten" || kind === "ahead" || kind === "previewNew") && (
          <TextField
            label={kind === "ahead" ? "Kaç gün ilerisi?" : "Son kaç gün?"}
            type="number"
            min={1}
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        )}
        {kind === "tag" && (
          <>
            <TagInput value={tags} onChange={setTags} />
            {!tags.length && allTags.length > 0 && <p className="text-sm text-ink-soft">Örnek: {allTags.slice(0, 5).join(", ")}</p>}
            <SelectField
              label="Hangi kartlar"
              value={tagState}
              onChange={(v) => setTagState(v as typeof tagState)}
              options={[
                { value: "all", label: "Hepsi" },
                { value: "due", label: "Sadece zamanı gelenler" },
                { value: "new", label: "Sadece yeniler" },
              ]}
            />
            <TextField label="En fazla kaç kart" type="number" min={1} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" disabled={busy}>
          {kind === "moreNew" || kind === "moreReview" ? "Sınırı artır" : "Başla"}
        </Button>
        <p className="text-xs text-ink-soft">Kartlar “Özel çalışma oturumu” adlı geçici bir desteye toplanır; işin bitince destenin menüsünden boşaltabilirsin.</p>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------- filtreli deste

function OrderSelect({ value, onChange, label }: { value: FilterOrder; onChange: (v: FilterOrder) => void; label: string }) {
  return <SelectField label={label} value={value} onChange={(v) => onChange(v as FilterOrder)} options={FILTER_ORDERS} />;
}

/** Filtreli deste oluştur (deck yoksa) ya da ayarlarını değiştir */
export function FilteredDeckDialog({ deck, initialSearch, onClose }: { deck?: DeckRow; initialSearch?: string; onClose: () => void }) {
  const { db } = useApp();
  const undo = useUndo();
  const router = useRouter();
  const { day, now } = useDayInfo();
  const start = deck ? filterOf(deck) : null;
  const [name, setName] = useState(deck?.name ?? "Filtreli deste");
  const [search, setSearch] = useState(start?.search ?? initialSearch ?? "is:due");
  const [limit, setLimit] = useState(String(start?.limit ?? 100));
  const [order, setOrder] = useState<FilterOrder>(start?.order ?? "due");
  const [reschedule, setReschedule] = useState(start?.reschedule ?? true);
  const [useSecond, setUseSecond] = useState(!!start?.second);
  const [search2, setSearch2] = useState(start?.second?.search ?? "is:new");
  const [limit2, setLimit2] = useState(String(start?.second?.limit ?? 20));
  const [order2, setOrder2] = useState<FilterOrder>(start?.second?.order ?? "added");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!db) return;
    setError(null);
    try {
      parseSearch(search);
      if (useSecond) parseSearch(search2);
    } catch (err) {
      return setError(err instanceof SearchError ? err.message : String(err));
    }
    const filter: FilterConfig = {
      search,
      limit: Math.max(1, Number(limit) || 100),
      order,
      reschedule,
      second: useSecond ? { search: search2, limit: Math.max(1, Number(limit2) || 20), order: order2 } : null,
    };
    setBusy(true);
    try {
      const data = await loadSearchData(db, day, now);
      const result = await undo.run(deck ? "Filtreli deste ayarları" : "Filtreli deste oluşturma", async () =>
        deck ? { id: deck.id, count: await updateFilteredDeck(db, deck, name, filter, data) } : createFilteredDeck(db, name, filter, data).then((r) => ({ id: r.deck.id, count: r.count })),
      );
      if (!result.count) setError("Aramaya uyan kart bulunamadı (askıdaki, yarına ertelenmiş ve başka filtreli destedeki kartlar alınmaz).");
      else {
        onClose();
        router.push(`/calis?deste=${result.id}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={deck ? "Filtreli deste ayarları" : "Filtreli deste oluştur"} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3">
        <TextField label="Ad" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Arama" value={search} onChange={(e) => setSearch(e.target.value)} hint="Kart tarayıcıdaki arama dili. Ör. deck:YDS is:due, tag:zor, rated:7:1" className="font-mono" />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="En fazla kart" type="number" min={1} inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} />
          <OrderSelect label="Sıra" value={order} onChange={setOrder} />
        </div>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" checked={reschedule} onChange={(e) => setReschedule(e.target.checked)} className="mt-0.5 size-4" />
          <span>
            Cevaplarıma göre yeniden zamanla
            <span className="block text-ink-soft">Kapalıysa sadece alıştırma olur; kartların zamanlaması değişmez.</span>
          </span>
        </label>
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={useSecond} onChange={(e) => setUseSecond(e.target.checked)} className="size-4" />
          İkinci filtre ekle
        </label>
        {useSecond && (
          <div className="space-y-3 rounded-lg border border-rule p-3">
            <TextField label="İkinci arama" value={search2} onChange={(e) => setSearch2(e.target.value)} className="font-mono" />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="En fazla kart" type="number" min={1} inputMode="numeric" value={limit2} onChange={(e) => setLimit2(e.target.value)} />
              <OrderSelect label="Sıra" value={order2} onChange={setOrder2} />
            </div>
          </div>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" disabled={busy}>
          {deck ? "Kaydet ve yeniden oluştur" : "Oluştur"}
        </Button>
      </form>
    </Modal>
  );
}

/** Filtreli destenin genel bakış düğmeleri */
export function FilteredDeckActions({ deck, onEdit }: { deck: DeckRow; onEdit: () => void }) {
  const { db } = useApp();
  const undo = useUndo();
  const { day, now } = useDayInfo();
  const [msg, setMsg] = useState<string | null>(null);
  const f = filterOf(deck);
  return (
    <div className="space-y-2">
      <p className="text-sm text-ink-soft">
        Filtreli deste: <code className="font-mono text-ink">{f.search}</code>
        {f.second && (
          <>
            {" "}
            + <code className="font-mono text-ink">{f.second.search}</code>
          </>
        )}
        {!f.reschedule && ", alıştırma (zamanlama değişmez)"}
      </p>
      <div className="flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          className="rounded-md border border-rule bg-surface px-3 py-2 font-medium hover:border-ink-soft"
          onClick={async () => {
            const data = await loadSearchData(db!, day, now);
            const n = await undo.run("Filtreli desteyi yeniden oluşturma", () => buildFilteredDeck(db!, deck, data));
            setMsg(`${n} kart toplandı.`);
          }}
        >
          Yeniden oluştur
        </button>
        <button
          type="button"
          className="rounded-md border border-rule bg-surface px-3 py-2 font-medium hover:border-ink-soft"
          onClick={async () => {
            const n = await undo.run("Filtreli desteyi boşaltma", () => emptyFilteredDeck(db!, deck.id));
            setMsg(`${n} kart kendi destesine döndü.`);
          }}
        >
          Boşalt
        </button>
        <button type="button" className="rounded-md border border-rule bg-surface px-3 py-2 font-medium hover:border-ink-soft" onClick={onEdit}>
          Ayarlar
        </button>
      </div>
      {msg && <p role="status" className="text-sm text-ok">{msg}</p>}
    </div>
  );
}
