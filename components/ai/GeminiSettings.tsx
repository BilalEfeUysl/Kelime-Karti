"use client";
// Ayarlar → Gemini: kişinin KENDİ API anahtarı, günlük sınır, otomatik onay.
// Anahtar sunucuya bir kez gönderilir ve orada şifreli saklanır; bir daha
// tarayıcıya gelmez (sadece son 4 karakteri gösterilir).
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { Button, InfoRow, Notice, Section, TextField } from "@/components/ui";
import { AiClientError, aiJson, type KeyStatus, keyStore } from "@/lib/ai/client";
import { AUTO_APPROVE_SETTING } from "@/lib/ai/local";
import { getSetting, setSetting } from "@/lib/db/mutations";
import { useKeyStatus } from "./hooks";

export function GeminiSettings() {
  const { db, hasSession } = useApp();
  const { status, online } = useKeyStatus();
  const [key, setKey] = useState("");
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const autoApprove = useLiveQuery(async () => (db ? getSetting(db, AUTO_APPROVE_SETTING, false) : false), [db]) ?? false;

  const save = async (body: { key?: string; dailyLimit?: number }, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      keyStore.set(await aiJson<KeyStatus>("/api/ai/key", { method: "PUT", body }));
      setKey("");
      setLimit("");
      setMessage({ tone: "ok", text: done });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof AiClientError ? err.message : "Kaydedilemedi." });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await aiJson("/api/ai/key", { method: "DELETE" });
      await keyStore.refresh();
      setMessage({ tone: "ok", text: "Anahtar silindi." });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof AiClientError ? err.message : "Silinemedi." });
    } finally {
      setBusy(false);
    }
  };

  const submitKey = (e: FormEvent) => {
    e.preventDefault();
    if (key.trim()) void save({ key: key.trim() }, "Anahtar doğrulandı ve kaydedildi.");
  };

  return (
    <Section title="Gemini (yapay zekâ)" className="scroll-mt-20">
      <div id="gemini" className="space-y-3">
        <p className="text-sm text-ink-soft">
          Kelime açıklaması ve toplu örnek cümle üretimi için <strong>kendi</strong> ücretsiz Gemini API anahtarını kullanırsın.
          Anahtarı{" "}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="font-medium text-accent underline">
            Google AI Studio
          </a>
          'dan alabilirsin (Google hesabıyla giriş → “Create API key”). Anahtar sunucuda şifreli saklanır; kimse göremez.
        </p>
        {!online && <Notice tone="warn">Gemini ayarları için internet gerekiyor.</Notice>}
        {online && !hasSession && <Notice tone="warn">Oturum gerekli: tekrar giriş yap.</Notice>}

        {status?.hasKey && (
          <dl className="text-sm">
            <InfoRow label="Kayıtlı anahtar">••••{status.last4}</InfoRow>
            <InfoRow label="Bugün kullanılan">
              {status.usedToday} / {status.dailyLimit} istek
            </InfoRow>
            <InfoRow label="Model">{status.model}</InfoRow>
          </dl>
        )}

        <form onSubmit={submitKey} className="flex flex-wrap items-end gap-2">
          <TextField
            label={status?.hasKey ? "Yeni anahtar (değiştirmek için)" : "Gemini API anahtarı"}
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="AIza…"
            className="min-w-56 flex-1"
          />
          <Button type="submit" disabled={busy || !online || !key.trim()}>
            {busy ? "Kontrol ediliyor…" : "Kaydet"}
          </Button>
        </form>

        {status?.hasKey && (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(limit);
                if (n >= 1) void save({ dailyLimit: n }, "Günlük sınır kaydedildi.");
              }}
              className="flex flex-wrap items-end gap-2"
            >
              <TextField
                label="Günlük istek sınırı (kendini korumak için)"
                type="number"
                min={1}
                inputMode="numeric"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                placeholder={String(status.dailyLimit)}
                className="min-w-56 flex-1"
                hint="Google'ın ücretsiz kotası anahtarına göre değişir; AI Studio'da görebilirsin."
              />
              <Button type="submit" variant="secondary" disabled={busy || !online || !(Number(limit) >= 1)}>
                Sınırı kaydet
              </Button>
            </form>
            <Button variant="ghost" className="text-danger" onClick={() => void remove()} disabled={busy || !online}>
              Anahtarı sil
            </Button>
          </>
        )}

        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={autoApprove}
            onChange={(e) => db && void setSetting(db, AUTO_APPROVE_SETTING, e.target.checked)}
          />
          <span>
            Toplu üretilen cümleleri otomatik onayla (kapalıysa önce{" "}
            <Link href="/ornek-cumleler" className="text-accent underline">
              Örnek cümleler
            </Link>{" "}
            sayfasında onaylarsın)
          </span>
        </label>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        <p className="text-xs text-ink-soft">Kişisel bilgi yazma: ücretsiz katmanda Google verileri model geliştirmek için kullanabilir.</p>
      </div>
    </Section>
  );
}
