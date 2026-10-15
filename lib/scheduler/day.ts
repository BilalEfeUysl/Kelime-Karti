// "GÜN" HESABI: Kullanıcının saat dilimine ve "yeni gün şu saatte başlar"
// ayarına göre (varsayılan 04:00, Europe/Istanbul). Gece 02:00'de çalışılan
// kart hâlâ "dünün" kartı sayılır — Anki'deki gibi.

export interface DayInfo {
  /** Gün numarası (1970-01-01'den beri, yerel takvime göre) */
  today: number;
  /** Bugünün başladığı an (ms) */
  dayStart: number;
  /** Yarının başladığı an (ms) */
  nextDayStart: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function localParts(ms: number, timeZone: string) {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return parts as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Saat diliminin o andaki UTC farkı (ms) */
function offsetAt(ms: number, timeZone: string): number {
  const p = localParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Yerel (saat dilimindeki) tarih+saatin UTC zamanı (yaz saati değişimlerine dayanıklı) */
function zonedToUtc(year: number, month: number, day: number, hour: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day, hour);
  let result = guess - offsetAt(guess, timeZone);
  result = guess - offsetAt(result, timeZone);
  return result;
}

export function getDayInfo(now: number, timeZone: string, dayStartHour: number): DayInfo {
  let tz = timeZone;
  try {
    formatter(tz);
  } catch {
    tz = "Europe/Istanbul"; // geçersiz saat dilimi
  }
  const p = localParts(now, tz);
  // Gün başlangıç saatinden önceyse önceki takvim günü sayılır
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day));
  if (p.hour < dayStartHour) shifted.setUTCDate(shifted.getUTCDate() - 1);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth() + 1;
  const d = shifted.getUTCDate();
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return {
    today: Math.round(shifted.getTime() / 86_400_000),
    dayStart: zonedToUtc(y, m, d, dayStartHour, tz),
    nextDayStart: zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), dayStartHour, tz),
  };
}
