// Hybrid Logical Clock (HLC) — "son yazan kazanır" için saat damgası.
//
// Neden normal saat (Date.now) yetmiyor?
//   * Telefonun saati 5 dk geri olabilir; o zaman daha sonra yaptığın bir
//     değişiklik "daha eski" görünür ve kaybolur.
//   * Saat geri alınırsa damgalar geriye gidebilir.
// HLC bunları çözer:
//   1) Asla geri gitmez (her yeni damga öncekinden büyüktür).
//   2) Başka cihazdan gelen bir damgayı "gördükten" sonra üretilen her damga
//      ondan büyüktür. Yani gördüğün bir değişikliğin üstüne yazdığında
//      senin yazdığın kazanır — saatin geri olsa bile.
//
// Biçim (sabit uzunluklu metin, metin olarak sıralanabilir):
//   "000001760000000000-00000-a1b2c3d4e5f60718"
//    └ zaman (ms, 15 hane)  └ sayaç  └ cihaz kimliği (16 hex)

const WALL_DIGITS = 15;
const COUNTER_DIGITS = 5;
const MAX_COUNTER = 10 ** COUNTER_DIGITS - 1;

export interface HlcParts {
  wall: number;
  counter: number;
  node: string;
}

export function formatHlc({ wall, counter, node }: HlcParts): string {
  return `${String(wall).padStart(WALL_DIGITS, "0")}-${String(counter).padStart(COUNTER_DIGITS, "0")}-${node}`;
}

export function parseHlc(hlc: string): HlcParts {
  const [wall, counter, node] = hlc.split("-");
  const parts = { wall: Number(wall), counter: Number(counter), node: node ?? "" };
  if (!Number.isFinite(parts.wall) || !Number.isFinite(parts.counter)) {
    throw new Error(`Geçersiz HLC: ${hlc}`);
  }
  return parts;
}

/** İki damgayı karşılaştırır (metin karşılaştırması yeterli çünkü biçim sabit uzunlukta). */
export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 16 karakterlik rastgele cihaz kimliği */
export function randomNodeId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class HybridClock {
  private wall = 0;
  private counter = 0;

  constructor(
    readonly node: string,
    last?: string | null,
    private readonly now: () => number = Date.now,
  ) {
    if (last) {
      const p = parseHlc(last);
      this.wall = p.wall;
      this.counter = p.counter;
    }
  }

  /** Yerel bir değişiklik için yeni damga üretir. */
  tick(): string {
    const physical = this.now();
    if (physical > this.wall) {
      this.wall = physical;
      this.counter = 0;
    } else {
      this.bumpCounter();
    }
    return this.current();
  }

  /** Uzaktan gelen bir damgayı "görür"; saat en az o kadar ileri alınır. */
  receive(remote: string | null | undefined): void {
    if (!remote) return;
    const r = parseHlc(remote);
    const physical = this.now();
    if (physical > this.wall && physical > r.wall) {
      this.wall = physical;
      this.counter = 0;
    } else if (r.wall > this.wall) {
      this.wall = r.wall;
      this.counter = r.counter;
      this.bumpCounter();
    } else if (r.wall === this.wall) {
      this.counter = Math.max(this.counter, r.counter);
      this.bumpCounter();
    }
    // r.wall < this.wall ise yerel saat zaten ileride, değişiklik yok.
  }

  /** Şu anki (en son üretilen) damga */
  current(): string {
    return formatHlc({ wall: this.wall, counter: this.counter, node: this.node });
  }

  private bumpCounter() {
    this.counter += 1;
    if (this.counter > MAX_COUNTER) {
      // Aynı milisaniyede 100.000 damga — pratikte olmaz; zamanı 1 ms ilerlet.
      this.wall += 1;
      this.counter = 0;
    }
  }
}
