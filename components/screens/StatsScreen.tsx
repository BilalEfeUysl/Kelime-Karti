"use client";
// İSTATİSTİKLER (/istatistikler): her şey cihazda hesaplanır (internet gerekmez).
// Üstte deste ve zaman aralığı seçimi; sonra bugünün özeti ve grafikler.
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useDayInfo, useDeckList, useDecks, useOptionsResolver } from "@/components/app/data";
import { BarChart, ChartCard, Heatmap, type Series } from "@/components/stats/Charts";
import { SelectField } from "@/components/ui";
import { subtreeIds } from "@/lib/decks";
import { type Bucket, computeStats } from "@/lib/stats";

const DAY = 86_400_000;
const S = (n: number): string => `var(--series-${n})`;
const dateFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });
const longFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "short" });

function minutesText(ms: number): string {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} dk` : `${Math.floor(m / 60)} sa ${m % 60} dk`;
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-rule bg-surface px-4 py-3">
      <div className="font-display text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-sm text-ink-soft">{label}</div>
      {hint && <div className="text-xs text-ink-soft">{hint}</div>}
    </div>
  );
}

function bucketChart(title: string, subtitle: string, buckets: Bucket[], unit = "kart") {
  const total = buckets.reduce((s, b) => s + b.value, 0);
  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      table={{ head: ["Aralık", unit, "Oran"], rows: buckets.map((b) => [b.label, b.value, total ? `%${Math.round((b.value / total) * 100)}` : "—"]) }}
    >
      <BarChart data={buckets.map((b) => ({ label: b.label, values: [b.value] }))} series={[{ name: unit, color: S(1) }]} />
    </ChartCard>
  );
}

export function StatsScreen() {
  const { db } = useApp();
  const decks = useDecks();
  const deckList = useDeckList();
  const optionsFor = useOptionsResolver(decks);
  const { day, now } = useDayInfo();
  const [deckId, setDeckId] = useState("");
  const [range, setRange] = useState("30");
  const raw = useLiveQuery(async () => (db ? { cards: await db.cards.toArray(), logs: await db.review_logs.toArray() } : null), [db]);

  const stats = useMemo(() => {
    if (!raw || !decks || !optionsFor) return null;
    const ids = deckId ? new Set(subtreeIds(decks, deckId)) : null;
    const home = (c: { original_deck_id: string | null; deck_id: string }) => c.original_deck_id ?? c.deck_id;
    const cards = raw.cards.filter((c) => c.deleted_at === null && (!ids || ids.has(home(c))));
    const cardIds = new Set(cards.map((c) => c.id));
    const logs = raw.logs.filter((l) => l.deleted_at === null && (ids ? cardIds.has(l.card_id) || (!!l.deck_id && ids.has(l.deck_id)) : true));
    return computeStats({ cards, logs, day, now, rangeDays: Number(range), optionsFor: (c) => optionsFor(home(c)) });
  }, [raw, decks, optionsFor, deckId, range, day, now]);

  if (!db || !stats || !deckList) return null;
  const dayLabel = (off: number) => dateFmt.format(day.dayStart + off * DAY + 12 * 3_600_000);
  const dayLong = (off: number) => longFmt.format(day.dayStart + off * DAY + 12 * 3_600_000);
  const todayWeekday = (((day.today + 3) % 7) + 7) % 7;
  const t = stats.today;
  const c = stats.counts;
  const totalCards = c.new + c.learning + c.young + c.mature + c.suspended + c.buried;
  const answerSeries: Series[] = [
    { name: "Tekrar", color: S(1) },
    { name: "Zor", color: S(2) },
    { name: "İyi", color: S(3) },
    { name: "Kolay", color: S(4) },
  ];
  const kindSeries: Series[] = [
    { name: "Öğrenme", color: S(1) },
    { name: "Tekrar", color: S(2) },
    { name: "Yeniden öğrenme", color: S(3) },
  ];
  const pctText = (p: [number, number]) => (p[1] ? `%${Math.round((p[0] / p[1]) * 100)} (${p[0]}/${p[1]})` : "—");

  return (
    <div className="space-y-5">
      <h1 className="font-display text-[28px] font-semibold leading-tight">İstatistikler</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Deste"
          value={deckId}
          onChange={setDeckId}
          options={[{ value: "", label: "Tüm koleksiyon" }, ...deckList.map((d) => ({ value: d.id, label: d.name }))]}
        />
        <SelectField
          label="Zaman aralığı"
          value={range}
          onChange={setRange}
          options={[
            { value: "30", label: "Son 1 ay" },
            { value: "90", label: "Son 3 ay" },
            { value: "365", label: "Son 1 yıl" },
          ]}
        />
      </div>

      <section aria-label="Bugün" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Bugün cevap" value={String(t.count)} hint={t.count ? `${t.learn} öğrenme, ${t.review} tekrar, ${t.relearn} yeniden` : undefined} />
        <Tile label="Bugün süre" value={minutesText(t.ms)} hint={t.count ? `kart başına ${(t.ms / t.count / 1000).toFixed(1)} sn` : undefined} />
        <Tile label="Tekrarlarda doğru" value={t.correctPct === null ? "—" : `%${t.correctPct}`} hint={`${t.again} kez “Tekrar”`} />
        <Tile label="Seri" value={`${stats.totals.streak} gün`} hint={`toplam ${stats.totals.daysStudied} gün çalışıldı`} />
      </section>

      <ChartCard title="Çalışma takvimi" subtitle="Son bir yıl; her kare bir gün, koyu = çok cevap.">
        <Heatmap counts={stats.heatmap} todayWeekday={todayWeekday} formatDay={dayLong} />
      </ChartCard>

      <ChartCard
        title="Gelecek yük"
        subtitle="Önümüzdeki günlerde vakti gelecek tekrarlar (bugüne gecikenler dahil)."
        table={{ head: ["Gün", "Kart"], rows: stats.future.filter((f) => f.count).map((f) => [f.offset === 0 ? "Bugün" : dayLabel(f.offset), f.count]) }}
      >
        <BarChart
          data={stats.future.map((f) => ({ label: f.offset === 0 ? "bugün" : `+${f.offset}`, tip: f.offset === 0 ? "Bugün" : dayLong(f.offset), values: [f.count] }))}
          series={[{ name: "Kart", color: S(1) }]}
          empty="Gelecekte vakti gelecek tekrar yok."
        />
      </ChartCard>

      <ChartCard
        title="Günlük cevaplar"
        subtitle="Seçilen aralıkta her gün verilen cevaplar, türüne göre."
        table={{ head: ["Gün", "Öğrenme", "Tekrar", "Yeniden", "Dakika"], rows: stats.daily.filter((d) => d.learn + d.review + d.relearn).map((d) => [dayLabel(d.offset), d.learn, d.review, d.relearn, d.minutes]) }}
      >
        <BarChart data={stats.daily.map((d) => ({ label: dayLabel(d.offset), tip: dayLong(d.offset), values: [d.learn, d.review, d.relearn] }))} series={kindSeries} />
      </ChartCard>

      <ChartCard title="Günlük çalışma süresi" subtitle="Dakika.">
        <BarChart data={stats.daily.map((d) => ({ label: dayLabel(d.offset), tip: dayLong(d.offset), values: [d.minutes] }))} series={[{ name: "Dakika", color: S(1) }]} />
      </ChartCard>

      <ChartCard title="Kartlar" subtitle={`Toplam ${totalCards} kart. Olgun = aralığı 21 gün ve üstü.`}>
        <ul className="space-y-2 text-sm">
          {(
            [
              ["Yeni", c.new],
              ["Öğreniliyor", c.learning],
              ["Genç", c.young],
              ["Olgun", c.mature],
              ["Askıda", c.suspended],
              ["Ertelenmiş", c.buried],
            ] as const
          ).map(([label, n], i) => (
            <li key={label} className="grid grid-cols-[7rem_1fr_4rem] items-center gap-3">
              <span>{label}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-ink/5">
                <span className="block h-full rounded-full" style={{ width: `${totalCards ? (n / totalCards) * 100 : 0}%`, background: S((i % 5) + 1) }} />
              </span>
              <span className="text-right tabular-nums">{n}</span>
            </li>
          ))}
        </ul>
      </ChartCard>

      {bucketChart("Aralık dağılımı", "Tekrar kartlarının şu anki aralıkları.", stats.intervals)}
      {bucketChart("Zorluk (FSRS)", "%0 kolay, %100 zor.", stats.difficulty)}
      {bucketChart("Kararlılık (FSRS)", "Hatırlama olasılığının %90'a düşmesi için geçen süre.", stats.stability)}
      {bucketChart("Hatırlama olasılığı (FSRS)", "Şu an hatırlama olasılığı tahmini.", stats.retrievability)}
      {stats.ease.some((b) => b.value) && bucketChart("Kolaylık (klasik algoritma)", "Aralığın her doğru cevapta kaç katına çıktığı.", stats.ease)}

      <ChartCard
        title="Saatlere göre"
        subtitle="Günün hangi saatinde çalışıyorsun, ne kadar başarılısın (üzerine gel)."
        table={{ head: ["Saat", "Cevap", "Doğru"], rows: stats.hourly.filter((h) => h.count).map((h) => [`${String(h.hour).padStart(2, "0")}:00`, h.count, h.correctPct === null ? "—" : `%${h.correctPct}`]) }}
      >
        <BarChart
          data={stats.hourly.map((h) => ({
            label: String(h.hour).padStart(2, "0"),
            tip: `${String(h.hour).padStart(2, "0")}:00–${String(h.hour).padStart(2, "0")}:59${h.correctPct === null ? "" : `, doğru %${h.correctPct}`}`,
            values: [h.count],
          }))}
          series={[{ name: "Cevap", color: S(1) }]}
        />
      </ChartCard>

      <ChartCard
        title="Düğme kullanımı"
        subtitle="Öğrenme, genç ve olgun kartlarda hangi cevaplar verildi."
        table={{
          head: ["Grup", "Tekrar", "Zor", "İyi", "Kolay", "Doğru"],
          rows: stats.buttons.map((b) => {
            const total = b.counts.reduce((s, x) => s + x, 0);
            return [b.group, ...b.counts, total ? `%${Math.round(((total - b.counts[0]) / total) * 100)}` : "—"];
          }),
        }}
      >
        <BarChart data={stats.buttons.map((b) => ({ label: b.group, values: b.counts }))} series={answerSeries} height={150} />
      </ChartCard>

      <ChartCard title="Eklenen kartlar" subtitle="Seçilen aralıkta her gün eklenen kart sayısı.">
        <BarChart data={stats.added.map((a) => ({ label: dayLabel(a.offset), tip: dayLong(a.offset), values: [a.count] }))} series={[{ name: "Kart", color: S(1) }]} />
      </ChartCard>

      <section className="rounded-xl border border-rule bg-surface p-4">
        <h2 className="font-display text-lg font-semibold">Doğru cevap oranı</h2>
        <p className="mt-0.5 text-sm text-ink-soft">Tekrar kartlarında “Tekrar” dışındaki cevapların oranı (gerçek hatırlama oranı).</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-soft">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Dönem</th>
                <th className="py-1.5 pr-3 text-right font-medium">Genç</th>
                <th className="py-1.5 pr-3 text-right font-medium">Olgun</th>
                <th className="py-1.5 text-right font-medium">Toplam</th>
              </tr>
            </thead>
            <tbody>
              {stats.retention.map((r) => (
                <tr key={r.period} className="border-t border-rule">
                  <td className="py-1.5 pr-3">{r.period}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{pctText(r.young)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{pctText(r.mature)}</td>
                  <td className="py-1.5 text-right tabular-nums">{pctText([r.young[0] + r.mature[0], r.young[1] + r.mature[1]])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
