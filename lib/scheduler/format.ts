// Aralıkları kısa Türkçe biçimde gösterir (butonların üstündeki önizleme):
//   <1dk, <10dk, 3sa, 1g, 12g, 1,2ay, 2,5y
// Gün içindeki (öğrenme) aralıklar Anki'deki gibi "<" ile gösterilir.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function oneDecimal(n: number): string {
  const r = Math.round(n * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace(".", ",");
}

export function formatInterval(ms: number): string {
  if (ms < MIN) return "<1dk";
  if (ms < HOUR) return `<${Math.round(ms / MIN)}dk`;
  if (ms < DAY) return `<${Math.round(ms / HOUR)}sa`;
  const days = ms / DAY;
  if (days < 30) return `${Math.round(days)}g`;
  if (days < 365) return `${oneDecimal(days / 30)}ay`;
  return `${oneDecimal(days / 365)}y`;
}

/** Kart bilgisi için gün sayısını okunur yazar ("12 gün", "1,5 ay") */
export function formatDays(days: number): string {
  if (days < 1) return "bugün";
  if (days < 30) return `${Math.round(days)} gün`;
  if (days < 365) return `${oneDecimal(days / 30)} ay`;
  return `${oneDecimal(days / 365)} yıl`;
}
