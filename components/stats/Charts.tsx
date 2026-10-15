"use client";
// İstatistik grafik parçaları (SVG, kütüphanesiz):
//   ChartCard (başlık + tablo görünümü), BarChart (tek ya da yığılmış çubuk),
//   Heatmap (takvim ısı haritası). Hepsi üzerine gelince ayrıntı gösterir.
import { type ReactNode, useEffect, useRef, useState } from "react";

export interface Series {
  name: string;
  color: string; // CSS rengi (ör. var(--series-1))
}

export interface BarDatum {
  label: string; // eksen etiketi
  tip?: string; // ayrıntı balonu başlığı
  values: number[]; // seri başına değer
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
      {series.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

export function ChartCard({
  title,
  subtitle,
  children,
  table,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  /** Tablo görünümü: başlıklar + satırlar */
  table?: { head: string[]; rows: (string | number)[][] };
}) {
  return (
    <section className="viz rounded-xl border border-rule bg-surface p-4">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p>}
      <div className="mt-3">{children}</div>
      {table && table.rows.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-ink-soft hover:text-ink">Tablo olarak göster</summary>
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="w-full text-left">
              <thead className="text-ink-soft">
                <tr>
                  {table.head.map((h, i) => (
                    <th key={h} className={`py-1 pr-3 font-medium ${i ? "text-right" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-t border-rule">
                    {r.map((c, j) => (
                      <td key={j} className={`py-1 pr-3 ${j ? "text-right tabular-nums" : ""}`}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

const nice = (max: number) => {
  if (max <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  const m = max / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
};

/** Çubuk grafik (yığılmış). Eksen etiketleri seyrekleştirilir. */
export function BarChart({
  data,
  series,
  height = 170,
  format = (n) => n.toLocaleString("tr-TR"),
  empty = "Henüz veri yok.",
}: {
  data: BarDatum[];
  series: Series[];
  height?: number;
  format?: (n: number) => string;
  empty?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((d) => d.values.reduce((s, v) => s + v, 0));
  const max = nice(Math.max(0, ...totals));
  const padL = 34;
  const padB = 20;
  const plotW = Math.max(0, width - padL);
  const plotH = height - padB;
  const slot = data.length ? plotW / data.length : 0;
  const barW = Math.max(1, Math.min(28, slot - 2)); // 2px boşluk
  const y = (v: number) => plotH - (v / max) * plotH;
  const tickEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 44))));
  const allZero = totals.every((t) => t === 0);

  return (
    <div className="space-y-2">
      <Legend series={series} />
      <div ref={ref} className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
        {allZero ? (
          <p className="grid h-full place-items-center text-sm text-ink-soft">{empty}</p>
        ) : (
          width > 0 && (
            <svg width={width} height={height} role="img" aria-label="Çubuk grafik" className="overflow-visible">
              {[0, 0.5, 1].map((f) => (
                <g key={f}>
                  <line x1={padL} x2={width} y1={y(max * f)} y2={y(max * f)} stroke="currentColor" className="text-rule" strokeWidth={1} />
                  <text x={padL - 6} y={y(max * f) + 4} textAnchor="end" className="fill-ink-soft text-[10px]">
                    {format(max * f)}
                  </text>
                </g>
              ))}
              {data.map((d, i) => {
                const x = padL + i * slot + (slot - barW) / 2;
                let acc = 0;
                return (
                  <g key={i}>
                    {d.values.map((v, k) => {
                      if (v <= 0) return null;
                      const top = y(acc + v);
                      const h = y(acc) - top - (acc > 0 ? 2 : 0); // dilimler arası 2px
                      acc += v;
                      const isTop = d.values.slice(k + 1).every((x2) => x2 <= 0);
                      const r = isTop ? Math.min(4, barW / 2, h) : 0;
                      return (
                        <path
                          key={k}
                          d={`M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`}
                          fill={series[k]?.color}
                          opacity={hover === null || hover === i ? 1 : 0.55}
                        />
                      );
                    })}
                    {i % tickEvery === 0 && (
                      <text x={x + barW / 2} y={height - 4} textAnchor="middle" className="fill-ink-soft text-[10px]">
                        {d.label}
                      </text>
                    )}
                    <rect
                      x={padL + i * slot}
                      y={0}
                      width={slot}
                      height={plotH}
                      fill="transparent"
                      onMouseEnter={() => setHover(i)}
                      onClick={() => setHover(i)}
                    />
                  </g>
                );
              })}
            </svg>
          )
        )}
        {hover !== null && data[hover] && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 min-w-32 rounded-lg border border-rule bg-surface px-2.5 py-1.5 text-xs shadow-lg"
            style={{
              left: Math.min(Math.max(0, padL + hover * slot + slot / 2 - 64), Math.max(0, width - 140)),
              top: 0,
            }}
          >
            <div className="font-semibold">{data[hover].tip ?? data[hover].label}</div>
            {series.map((s, k) => (
              <div key={s.name} className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ background: s.color }} aria-hidden />
                <span className="text-ink-soft">{s.name}</span>
                <span className="ml-auto pl-2 tabular-nums">{format(data[hover].values[k] ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Takvim ısı haritası: son 52 hafta, gün başına cevap sayısı */
export function Heatmap({ counts, todayWeekday, formatDay }: { counts: Map<number, number>; todayWeekday: number; formatDay: (offset: number) => string }) {
  const [hover, setHover] = useState<{ off: number; x: number; y: number } | null>(null);
  const weeks = 53;
  const cell = 11;
  const gap = 2;
  // Son sütun bu hafta; satır = haftanın günü (Pzt üstte)
  const lastCol = weeks - 1;
  const values = [...counts.entries()].filter(([o]) => o <= 0 && o > -weeks * 7).map(([, v]) => v);
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const thresholds = [q(0.2), q(0.4), q(0.6), q(0.8), q(0.95)];
  const color = (v: number) => {
    if (!v) return "var(--seq-empty)";
    const i = thresholds.findIndex((t) => v <= t);
    return `var(--seq-${i < 0 ? 6 : i + 1})`;
  };
  const width = weeks * (cell + gap);
  const height = 7 * (cell + gap);
  return (
    <div className="relative overflow-x-auto" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height + 14} role="img" aria-label="Son bir yılın çalışma takvimi">
        {Array.from({ length: weeks * 7 }, (_, idx) => {
          const col = Math.floor(idx / 7);
          const row = idx % 7;
          const off = (col - lastCol) * 7 + (row - todayWeekday);
          if (off > 0) return null;
          const v = counts.get(off) ?? 0;
          const x = col * (cell + gap);
          const yy = row * (cell + gap);
          return (
            <rect
              key={idx}
              x={x}
              y={yy}
              width={cell}
              height={cell}
              rx={2}
              fill={color(v)}
              stroke={off === 0 ? "currentColor" : "none"}
              className={off === 0 ? "text-ink" : undefined}
              onMouseEnter={() => setHover({ off, x, y: yy })}
              onClick={() => setHover({ off, x, y: yy })}
            />
          );
        })}
      </svg>
      <div className="flex items-center gap-1.5 text-[11px] text-ink-soft">
        az
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span key={i} className="size-2.5 rounded-sm" style={{ background: i ? `var(--seq-${i})` : "var(--seq-empty)" }} aria-hidden />
        ))}
        çok
      </div>
      {hover && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 rounded-lg border border-rule bg-surface px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: Math.min(hover.x, width - 150), top: hover.y + cell + 4 }}
        >
          <span className="font-semibold">{formatDay(hover.off)}</span>: {counts.get(hover.off) ?? 0} cevap
        </div>
      )}
    </div>
  );
}
