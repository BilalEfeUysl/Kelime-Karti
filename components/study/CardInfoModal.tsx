"use client";
// Kart bilgisi (I tuşu): durum, FSRS değerleri ve tüm tekrar geçmişi
import { useLiveQuery } from "dexie-react-hooks";
import { useApp } from "@/components/app/AppProvider";
import { InfoRow, Modal } from "@/components/ui";
import type { CardRow } from "@/lib/db/types";
import type { DeckOptions } from "@/lib/scheduler/config";
import { formatDays } from "@/lib/scheduler/format";
import { ANSWER_LABELS, retrievability } from "@/lib/scheduler/fsrs";

const STATE = ["Yeni", "Öğreniliyor", "Tekrar", "Yeniden öğreniliyor"];
const KIND = ["Öğrenme", "Tekrar", "Yeniden öğrenme", "Filtreli", "Elle"];
const dateTR = (ms: number | null | undefined) =>
  ms ? new Date(ms).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" }) : "—";

export function CardInfoModal({
  card,
  deckName,
  noteTypeName,
  options,
  onClose,
}: {
  card: CardRow;
  deckName: string;
  noteTypeName: string;
  options: DeckOptions;
  onClose: () => void;
}) {
  const { db } = useApp();
  const logs = useLiveQuery(
    async () =>
      db
        ? (await db.review_logs.where("card_id").equals(card.id).toArray())
            .filter((l) => l.deleted_at === null)
            .sort((a, b) => b.reviewed_at - a.reviewed_at)
        : [],
    [db, card.id],
  );
  const r = retrievability(card, options, Date.now());
  const total = logs?.reduce((s, l) => s + l.duration_ms, 0) ?? 0;

  return (
    <Modal title="Kart bilgisi" onClose={onClose} wide>
      <dl className="text-sm">
        <InfoRow label="Durum">
          {STATE[card.state] ?? "?"}
          {card.suspended ? " (askıda)" : ""}
        </InfoRow>
        <InfoRow label="Eklenme">{dateTR(card.created_at)}</InfoRow>
        <InfoRow label="Son tekrar">{dateTR(card.last_review)}</InfoRow>
        <InfoRow label="Sıradaki gösterim">{card.state === 0 ? "Yeni kart" : dateTR(card.due)}</InfoRow>
        <InfoRow label="Aralık">{card.state === 0 ? "—" : formatDays(card.interval_days)}</InfoRow>
        <InfoRow label="Tekrar sayısı">{card.reps}</InfoRow>
        <InfoRow label="Unutma (hata)">{card.lapses}</InfoRow>
        <InfoRow label="Kararlılık (stability)">{card.state === 0 ? "—" : `${card.stability.toFixed(1)} gün`}</InfoRow>
        <InfoRow label="Zorluk (difficulty)">{card.state === 0 ? "—" : `${card.difficulty.toFixed(1)} / 10`}</InfoRow>
        <InfoRow label="Hatırlama olasılığı">{r === null ? "—" : `%${Math.round(r * 100)}`}</InfoRow>
        <InfoRow label="Ortalama süre">{logs?.length ? `${(total / logs.length / 1000).toFixed(1)} sn` : "—"}</InfoRow>
        <InfoRow label="Toplam süre">{`${Math.round(total / 1000)} sn`}</InfoRow>
        <InfoRow label="Deste">{deckName}</InfoRow>
        <InfoRow label="Not tipi">{noteTypeName}</InfoRow>
      </dl>
      <h3 className="mt-5 mb-2 font-display text-base font-semibold">Tekrar geçmişi</h3>
      {!logs?.length ? (
        <p className="text-sm text-ink-soft">Bu kart henüz hiç çalışılmadı.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-soft">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Tarih</th>
                <th className="py-1.5 pr-3 font-medium">Tür</th>
                <th className="py-1.5 pr-3 font-medium">Cevap</th>
                <th className="py-1.5 pr-3 font-medium">Aralık</th>
                <th className="py-1.5 font-medium">Süre</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-rule">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{dateTR(l.reviewed_at)}</td>
                  <td className="py-1.5 pr-3">{KIND[l.kind] ?? "?"}</td>
                  <td className="py-1.5 pr-3">{ANSWER_LABELS[l.rating as 1 | 2 | 3 | 4] ?? "Elle"}</td>
                  <td className="py-1.5 pr-3">{l.interval_after ? formatDays(l.interval_after) : "<1 gün"}</td>
                  <td className="py-1.5 tabular-nums">{(l.duration_ms / 1000).toFixed(1)} sn</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
