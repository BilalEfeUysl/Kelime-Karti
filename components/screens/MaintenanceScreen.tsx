"use client";
// BAKIM (/bakim): veritabanı kontrolü, boş kartlar, kullanılmayan resimler,
// kopya notlar, eski silinmiş kayıtların temizliği, yerel veriyi sıfırlama.
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useOnline, useOutboxCounts } from "@/components/app/hooks";
import { useUndo } from "@/components/app/undo";
import { Button, Notice, Section } from "@/components/ui";
import { findDuplicates } from "@/lib/browse/ops";
import { softDeleteRows } from "@/lib/db/mutations";
import type { CardRow, MediaRow, NoteRow } from "@/lib/db/types";
import { type CheckReport, checkDatabase, deleteUnusedMedia, findEmptyCards, findUnusedMedia, fixDatabase, issueCount, purgeLocalTombstones } from "@/lib/maintenance";
import { formatBytes } from "@/lib/storage";
import { getSupabase } from "@/lib/supabase/client";

type Msg = { tone: "ok" | "error" | "info" | "warn"; text: ReactNode } | null;

export function MaintenanceScreen() {
  return (
    <div className="space-y-5">
      <div>
        <Link href="/ayarlar" className="text-sm text-ink-soft hover:text-ink">
          ← Ayarlar
        </Link>
        <h1 className="mt-1 font-display text-[28px] font-semibold leading-tight">Bakım</h1>
        <p className="mt-1 text-sm text-ink-soft">Her araç önce ne bulduğunu gösterir; onaylamadan bir şey değişmez. Düzeltmeler Ctrl/Cmd+Z ile geri alınabilir (sıfırlama hariç).</p>
      </div>
      <CheckSection />
      <EmptyCardsSection />
      <MediaSection />
      <DuplicatesSection />
      <TombstoneSection />
      <ResetSection />
    </div>
  );
}

function CheckSection() {
  const { db } = useApp();
  const undo = useUndo();
  const [report, setReport] = useState<CheckReport | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  if (!db) return null;
  const rows: [string, number][] = report
    ? [
        ["Notu silinmiş (öksüz) kart", report.orphanCards.length],
        ["Destesi silinmiş kart (Varsayılan'a taşınır)", report.lostDeckCards.length],
        ["Şablonu olmayan kart", report.badOrdCards.length],
        ["Kopya kart (aynı not, aynı şablon)", report.duplicateCards.length],
        ["Not tipi silinmiş not (silinir)", report.typelessNotes.length],
        ["Hiç kartı olmayan not (kart üretilir)", report.cardlessNotes.length],
        ["Notu silinmiş örnek cümle", report.orphanExamples],
      ]
    : [];
  return (
    <Section title="Veritabanını kontrol et">
      <div className="space-y-3">
        <Button
          variant="secondary"
          onClick={async () => {
            setReport(await checkDatabase(db));
            setMsg(null);
          }}
        >
          Kontrol et
        </Button>
        {report && issueCount(report) === 0 && <Notice tone="ok">Sorun bulunmadı.</Notice>}
        {report && issueCount(report) > 0 && (
          <>
            <ul className="space-y-1 text-sm">
              {rows
                .filter(([, n]) => n > 0)
                .map(([label, n]) => (
                  <li key={label} className="flex justify-between gap-3">
                    <span>{label}</span>
                    <span className="tabular-nums">{n}</span>
                  </li>
                ))}
            </ul>
            <Button
              onClick={async () => {
                await undo.run("Veritabanı düzeltme", () => fixDatabase(db, report));
                setReport(null);
                setMsg({ tone: "ok", text: "Düzeltildi." });
              }}
            >
              Düzelt
            </Button>
          </>
        )}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </div>
    </Section>
  );
}

function EmptyCardsSection() {
  const { db } = useApp();
  const undo = useUndo();
  const [found, setFound] = useState<{ card: CardRow; note: NoteRow }[] | null>(null);
  if (!db) return null;
  return (
    <Section title="Boş kartlar">
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">Ön yüzü artık boş kalan kartlar (ör. silinmiş bir cloze boşluğu, boşaltılmış “Add Reverse”).</p>
        <Button variant="secondary" onClick={async () => setFound(await findEmptyCards(db))}>
          Boş kartları bul
        </Button>
        {found && !found.length && <Notice tone="ok">Boş kart yok.</Notice>}
        {found && found.length > 0 && (
          <>
            <ul className="max-h-48 overflow-y-auto text-sm">
              {found.slice(0, 50).map(({ card, note }) => (
                <li key={card.id} className="truncate">
                  {note.sort_field || "(boş)"} <span className="text-ink-soft">— {card.ord + 1}. kart</span>
                </li>
              ))}
            </ul>
            <Button
              variant="danger"
              onClick={async () => {
                await undo.run("Boş kartları silme", () => softDeleteRows(db, "cards", found.map((f) => f.card.id)));
                setFound([]);
              }}
            >
              {found.length} boş kartı sil
            </Button>
          </>
        )}
      </div>
    </Section>
  );
}

function MediaSection() {
  const { db, hasSession } = useApp();
  const online = useOnline();
  const [found, setFound] = useState<MediaRow[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  if (!db) return null;
  const size = found?.reduce((s, m) => s + m.size, 0) ?? 0;
  return (
    <Section title="Kullanılmayan resimler">
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">Hiçbir notta geçmeyen resimler. Silinince sunucudaki kopyası da kaldırılır (resim kotası 1 GB).</p>
        <Button variant="secondary" onClick={async () => setFound(await findUnusedMedia(db))}>
          Bul
        </Button>
        {found && !found.length && <Notice tone="ok">Kullanılmayan resim yok.</Notice>}
        {found && found.length > 0 && (
          <Button
            variant="danger"
            onClick={async () => {
              const paths = await deleteUnusedMedia(db, found);
              let note = "";
              if (paths.length && online && hasSession) {
                const { error } = await getSupabase().storage.from("media").remove(paths);
                note = error ? ` Sunucudan silinemedi: ${error.message}` : "";
              } else if (paths.length) note = " Sunucudaki kopyalar internet olunca tekrar bu araçla silinebilir.";
              setMsg({ tone: "ok", text: `${found.length} resim silindi (${formatBytes(size)}).${note}` });
              setFound(null);
            }}
          >
            {found.length} resmi sil ({formatBytes(size)})
          </Button>
        )}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </div>
    </Section>
  );
}

function DuplicatesSection() {
  const { db } = useApp();
  const [groups, setGroups] = useState<{ type: string; typeId: string; text: string; count: number }[] | null>(null);
  if (!db) return null;
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return (
    <Section title="Kopya notlar">
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">Her not tipinde ilk alanı aynı olan notlar (HTML ve büyük/küçük harf yok sayılır).</p>
        <Button
          variant="secondary"
          onClick={async () => {
            const notes = await db.notes.toArray();
            const types = (await db.note_types.toArray()).filter((t) => t.deleted_at === null && t.fields[0]);
            setGroups(types.flatMap((t) => findDuplicates(notes, t.id, t.fields[0].id).map((g) => ({ type: t.name, typeId: t.id, text: g.text, count: g.noteIds.length }))));
          }}
        >
          Raporla
        </Button>
        {groups && !groups.length && <Notice tone="ok">Kopya not yok.</Notice>}
        {groups && groups.length > 0 && (
          <ul className="max-h-64 divide-y divide-rule overflow-y-auto rounded-lg border border-rule text-sm">
            {groups.map((g) => (
              <li key={`${g.typeId}:${g.text}`} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate">
                  {g.text} <span className="text-ink-soft">({g.type}, {g.count} not)</span>
                </span>
                <Link className="shrink-0 text-accent hover:underline" href={`/kartlar?q=${encodeURIComponent(`"dupe:${g.typeId},${esc(g.text)}"`)}`}>
                  Göster
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function TombstoneSection() {
  const { db, hasSession } = useApp();
  const online = useOnline();
  const [msg, setMsg] = useState<Msg>(null);
  if (!db) return null;
  return (
    <Section title="Eski silinmiş kayıtları temizle">
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">
          Silinen kayıtlar eşleme için bir süre “silindi” işaretiyle saklanır. 90 günden eski olanlar bu cihazdan ve sunucudan kaldırılır. Uygulamayı 90 günden
          uzun süre açmadığın bir cihaz varsa önce onu eşle.
        </p>
        <Button
          variant="secondary"
          onClick={async () => {
            const local = await purgeLocalTombstones(db, 90);
            let server = "";
            if (online && hasSession) {
              const { data, error } = await getSupabase().rpc("purge_tombstones", { p_days: 90 });
              server = error ? ` Sunucu: ${error.message}` : ` Sunucudan ${data ?? 0} kayıt kaldırıldı.`;
            } else server = " Sunucu tarafı internet olunca bu düğmeyle temizlenebilir.";
            setMsg({ tone: "ok", text: `Bu cihazdan ${local} kayıt kaldırıldı.${server}` });
          }}
        >
          Temizle
        </Button>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </div>
    </Section>
  );
}

function ResetSection() {
  const { resetLocal, hasSession } = useApp();
  const online = useOnline();
  const { pending, failed } = useOutboxCounts();
  const [confirm, setConfirm] = useState(false);
  const unsynced = pending + failed;
  return (
    <Section title="Yerel veriyi sıfırla">
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">Bu cihazdaki kopyayı siler ve her şeyi sunucudan yeniden indirir. Cihazda bir tutarsızlık olduğunu düşünüyorsan kullan.</p>
        {!online || !hasSession ? (
          <Notice tone="warn">Bunun için internet ve oturum gerekiyor (veriler sunucudan yeniden inecek).</Notice>
        ) : !confirm ? (
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Sıfırla…
          </Button>
        ) : (
          <>
            {unsynced > 0 ? (
              <Notice tone="error">{unsynced} değişiklik henüz sunucuya gönderilmedi; sıfırlarsan kaybolur. Önce eşlemeyi bekle.</Notice>
            ) : (
              <Notice tone="info">Tüm değişiklikler eşlendi. Sıfırlayınca sayfa yenilenir ve veriler yeniden iner.</Notice>
            )}
            <div className="flex gap-2">
              <Button variant="danger" onClick={() => void resetLocal()}>
                {unsynced > 0 ? "Yine de sıfırla" : "Sıfırla ve yeniden indir"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Vazgeç
              </Button>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
