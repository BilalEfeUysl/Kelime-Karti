"use client";
// Ayarlar: hesap, çalışma günü, görünüm, Gemini, diğer araçlar, eşleme, veriler.
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GeminiSettings } from "@/components/ai/GeminiSettings";
import { AppearanceSettings } from "@/components/app/AppearanceSettings";
import { useApp } from "@/components/app/AppProvider";
import { useNow, useOnline, useOutboxCounts, useSyncStatus } from "@/components/app/hooks";
import { useStudySettings } from "@/components/app/data";
import { Button, InfoRow, Notice, Section, SelectField } from "@/components/ui";
import { setSetting } from "@/lib/db/mutations";
import { formatBytes, isStandalone, storageInfo, timeAgo } from "@/lib/storage";
import { getThemePref, setThemePref, type ThemePref } from "@/lib/theme";

export function SettingsScreen() {
  return (
    <div className="space-y-5">
      <h1 className="font-display text-[28px] font-semibold leading-tight">Ayarlar</h1>
      <AccountSection />
      <StudySection />
      <ThemeSection />
      <GeminiSettings />
      <ToolsSection />
      <SyncSection />
      <DataSection />
    </div>
  );
}

function ToolsSection() {
  const links: [string, string, string][] = [
    ["/iceaktar", "İçe aktar", "İndirdiğin bir desteyi (.apkg) ya da CSV/TXT dosyasını ekle"],
    ["/ornek-cumleler", "Örnek cümleler", "Gemini ile kelimelerine toplu örnek cümle üret"],
    ["/etiketler", "Etiketler", "Etiketleri yeniden adlandır, birleştir ya da sil"],
    ["/not-tipleri", "Not tipleri", "Kartların alanlarını ve görünümünü düzenle"],
    ["/disa-aktar", "Dışa aktar ve yedek", "Destelerini dosya olarak indir, yedekten geri yükle"],
    ["/bakim", "Bakım", "Bozuk ya da boş kartları bul, kullanılmayan resimleri temizle"],
  ];
  return (
    <Section title="Diğer araçlar">
      <ul className="-my-1 divide-y divide-rule">
        {links.map(([href, label, hint]) => (
          <li key={href}>
            <Link href={href} className="flex items-center justify-between gap-3 py-2.5 hover:text-accent">
              <span>
                <span className="block font-medium">{label}</span>
                <span className="block text-sm text-ink-soft">{hint}</span>
              </span>
              <span aria-hidden className="text-ink-soft">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AccountSection() {
  const { user, profile, engine, signOut } = useApp();
  const { pending, failed } = useOutboxCounts();
  const online = useOnline();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const unsynced = pending + failed;

  const startSignOut = async () => {
    setBusy(true);
    // Önce bekleyenleri göndermeyi dene
    if (online && engine) await engine.sync();
    setBusy(false);
    setConfirming(true);
  };

  const doSignOut = async () => {
    setBusy(true);
    await signOut();
    router.replace("/giris");
  };

  return (
    <Section title="Hesap">
      <dl>
        <InfoRow label="Ad">{profile?.display_name ?? user?.email.split("@")[0]}</InfoRow>
        {profile?.role === "admin" && <InfoRow label="Rol">Yönetici</InfoRow>}
      </dl>
      {profile?.role === "admin" && (
        <Link href="/admin" className="mt-3 inline-block font-semibold text-accent hover:underline">
          Yönetim sayfası
        </Link>
      )}

      <div className="mt-4">
        {!confirming ? (
          <Button variant="secondary" onClick={() => void startSignOut()} disabled={busy}>
            {busy ? "Eşleniyor…" : "Çıkış yap"}
          </Button>
        ) : (
          <div className="space-y-3">
            {unsynced > 0 ? (
              <Notice tone="error">
                {unsynced} değişiklik henüz sunucuya gönderilmedi. Çıkış yaparsan bu cihazdaki veriler silinir ve bu
                değişiklikler <strong>kaybolur</strong>. Önce internete bağlanıp eşlemen önerilir.
              </Notice>
            ) : (
              <Notice tone="info">
                Tüm değişiklikler kaydedildi. Çıkış yapınca bu cihazdaki kopya silinir; tekrar giriş yapınca her şey geri
                gelir.
              </Notice>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" onClick={() => void doSignOut()} disabled={busy}>
                {unsynced > 0 ? "Yine de çıkış yap" : "Çıkış yap"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Vazgeç
              </Button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

const COMMON_ZONES = ["Europe/Istanbul", "Europe/London", "Europe/Berlin", "Europe/Paris", "America/New_York", "Asia/Dubai", "UTC"];

function StudySection() {
  const { db } = useApp();
  const settings = useStudySettings();
  const zones = (() => {
    try {
      const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
      return all?.length ? all : COMMON_ZONES;
    } catch {
      return COMMON_ZONES;
    }
  })();
  return (
    <Section title="Çalışma">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Yeni gün şu saatte başlar"
          value={String(settings.dayStartHour)}
          onChange={(v) => db && void setSetting(db, "dayStartHour", Number(v))}
          options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` }))}
        />
        <SelectField
          label="Saat dilimi"
          value={settings.timeZone}
          onChange={(v) => db && void setSetting(db, "timeZone", v)}
          options={zones.map((z) => ({ value: z, label: z }))}
        />
      </div>
      <p className="mt-2 text-sm text-ink-soft">
        Gece geç saatte çalıştığın kartlar da “bugün” sayılsın diye yeni gün 04:00&apos;te başlar. Bu ayar tüm
        cihazlarında geçerlidir.
      </p>
    </Section>
  );
}

function SyncSection() {
  const { db, engine } = useApp();
  const status = useSyncStatus(engine);
  const { pending, failed } = useOutboxCounts();
  const now = useNow();
  const failedEntries = useLiveQuery(
    async () => (await db!.outbox.toArray()).filter((e) => e.failed_hlc && e.failed_hlc === e.hlc),
    [db],
  );

  return (
    <Section title="Eşleme">
      <p className="mb-2 text-sm text-ink-soft">Kartların ve çalışma geçmişin internet olduğunda kendiliğinden diğer cihazlarınla eşlenir.</p>
      <dl>
        <InfoRow label="Son eşleme">{timeAgo(status.lastSyncedAt, now)}</InfoRow>
        <InfoRow label="Gönderilmeyi bekleyen değişiklik">{pending}</InfoRow>
        {failed > 0 && <InfoRow label="Gönderilemeyen değişiklik">{failed}</InfoRow>}
      </dl>
      {status.error && (
        <div className="mt-3">
          <Notice tone="error">{status.error}</Notice>
        </div>
      )}
      {failedEntries && failedEntries.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-ink-soft">Neden gönderilemedi?</summary>
          <ul className="mt-2 space-y-1">
            {failedEntries.map((e) => (
              <li key={e.key} className="break-all">
                <span className="font-medium">{e.table}</span>: {e.error}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => void engine?.sync()} disabled={status.phase === "syncing"}>
          {status.phase === "syncing" ? "Eşleniyor…" : "Şimdi eşle"}
        </Button>
      </div>
    </Section>
  );
}

const THEMES: { value: ThemePref; label: string }[] = [
  { value: "system", label: "Sistem" },
  { value: "light", label: "Açık" },
  { value: "dark", label: "Koyu" },
];

function ThemeSection() {
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => setPref(getThemePref()), []);
  // Sistem teması değişirse (ör. akşam otomatik koyu) uygula
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setThemePref("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  return (
    <Section title="Görünüm">
      <div role="radiogroup" aria-label="Tema" className="inline-flex rounded-lg border border-rule p-1">
        {THEMES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={pref === t.value}
            onClick={() => {
              setPref(t.value);
              setThemePref(t.value);
            }}
            className="min-h-9 rounded-md px-4 text-sm font-medium text-ink-soft aria-checked:bg-accent aria-checked:text-accent-ink"
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-ink-soft">Tema ve aşağıdaki görünüm tercihleri sadece bu cihaz için geçerlidir.</p>
      <AppearanceSettings />
    </Section>
  );
}

function DataSection() {
  const { db } = useApp();
  const [info, setInfo] = useState<Awaited<ReturnType<typeof storageInfo>> | null>(null);
  // Sadece iPhone/iPad'de, ana ekrana eklenmemişse uyarı gösterilir
  const [iosBrowser, setIosBrowser] = useState(false);
  useEffect(() => {
    void storageInfo().then(setInfo);
    setIosBrowser(!isStandalone() && /iPhone|iPad|iPod/.test(navigator.userAgent));
  }, []);
  const usage = useLiveQuery(async () => {
    const alive = <T extends { deleted_at: number | null }>(rows: T[]) => rows.filter((r) => r.deleted_at === null);
    const media = alive(await db!.media.toArray());
    return {
      decks: alive(await db!.decks.toArray()).length,
      cards: await db!.cards.filter((c) => c.deleted_at === null).count(),
      reviews: await db!.review_logs.filter((r) => r.deleted_at === null).count(),
      mediaCount: media.length,
      mediaBytes: media.reduce((s, m) => s + (m.size ?? 0), 0),
    };
  }, [db]);

  return (
    <Section title="Veriler">
      <dl>
        <InfoRow label="Deste">{usage?.decks ?? "—"}</InfoRow>
        <InfoRow label="Kart">{usage?.cards.toLocaleString("tr-TR") ?? "—"}</InfoRow>
        <InfoRow label="Verilen cevap">{usage?.reviews.toLocaleString("tr-TR") ?? "—"}</InfoRow>
        <InfoRow label="Resim">{usage ? `${usage.mediaCount} (${formatBytes(usage.mediaBytes)})` : "—"}</InfoRow>
        <InfoRow label="Bu cihazda kullanılan alan">{formatBytes(info?.usage)}</InfoRow>
      </dl>
      <p className="mt-3 text-sm text-ink-soft">
        Her şeyin asıl kopyası sunucuda durur: bu cihazın verisi silinse bile tekrar giriş yapınca geri gelir.
        {iosBrowser && " iPhone'da Safari, ana ekrana eklenmemiş sitelerin verisini bir süre sonra silebilir; uygulamayı ana ekrana eklemen iyi olur."}
      </p>
      {iosBrowser && (
        <Link href="/kurulum" className="mt-3 inline-block font-semibold text-accent hover:underline">
          Ana ekrana nasıl eklenir?
        </Link>
      )}
    </Section>
  );
}
