// Senkronu OTOMATİK tetikleyen olaylar (sadece tarayıcıda):
//   * uygulama açılınca
//   * internet geri gelince (online olayı)
//   * uygulama öne gelince / arka plana giderken (visibilitychange)
//   * yerel bir değişiklikten birkaç saniye sonra (debounce)
//   (Realtime "başka cihazda değişiklik var" sinyali AppProvider'da bağlanır.)
//   * açıkken 5 dakikada bir
import type { SyncEngine } from "./engine";

const DEBOUNCE_MS = 3_000; // son değişiklikten 3 sn sonra
const MAX_WAIT_MS = 20_000; // sürekli değişiklik olsa da en geç 20 sn'de bir
const INTERVAL_MS = 5 * 60_000;

export function startAutoSync(engine: SyncEngine): () => void {
  const run = () => void engine.sync();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    clearTimeout(debounceTimer);
    clearTimeout(maxTimer);
    debounceTimer = maxTimer = undefined;
    run();
  };
  const onLocalChange = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, DEBOUNCE_MS);
    maxTimer ??= setTimeout(flush, MAX_WAIT_MS);
  };
  const onVisibility = () => {
    // Öne gelince yenilikleri çek; arka plana giderken bekleyenleri hemen gönder.
    if (document.visibilityState === "visible" || debounceTimer) flush();
  };
  const onOffline = () => engine.notifyOffline();

  window.addEventListener("online", run);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisibility);
  const offLocal = engine.db.onLocalChange(onLocalChange);
  const interval = setInterval(() => {
    if (document.visibilityState === "visible") run();
  }, INTERVAL_MS);

  run();

  return () => {
    window.removeEventListener("online", run);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisibility);
    offLocal();
    clearInterval(interval);
    clearTimeout(debounceTimer);
    clearTimeout(maxTimer);
  };
}
