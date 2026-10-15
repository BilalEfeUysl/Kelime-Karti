"use client";
// RESİM MASKELEME DÜZENLEYİCİSİ
//   - Resim: yapıştır / sürükle-bırak / dosya seç
//   - Araçlar: Seç (taşı), Dikdörtgen, Elips, Çokgen (tıkla tıkla, bitirmek için
//     ilk noktaya tıkla, çift tıkla ya da Enter)
//   - Seçili maskeler: Sil (Delete), Grupla (aynı kartta birlikte sorulur), Ayır
//   - Mod: "Hepsini gizle, birini sor" ya da "Birini gizle, birini sor"
// Maskeler Anki biçiminde "Occlusion" alanına yazılır (bkz. lib/io.ts).
import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { Button } from "@/components/ui";
import { type IoKind, type IoShape, parseOcclusions, serializeOcclusions } from "@/lib/io";
import { resolveMediaInHtml } from "@/lib/media-url";
import { addMediaFile, extensionFor } from "@/lib/sync/media";

type Tool = "select" | IoKind;
const S = 1000;

interface Props {
  image: string; // Image alanının HTML'i
  occlusion: string; // Occlusion alanı
  onChange: (image: string, occlusion: string) => void;
}

/** Grupları 1'den başlayarak sıraya koyar (boşluk kalmasın) */
function renumber(shapes: IoShape[]): IoShape[] {
  const order = [...new Set(shapes.map((s) => s.group))].sort((a, b) => a - b);
  const map = new Map(order.map((g, i) => [g, i + 1]));
  return shapes.map((s) => ({ ...s, group: map.get(s.group)! }));
}

function bbox(s: IoShape): { x: number; y: number; w: number; h: number } {
  if (s.kind === "rect") return { x: s.left, y: s.top, w: s.width, h: s.height };
  if (s.kind === "ellipse") return { x: s.left - s.rx, y: s.top - s.ry, w: s.rx * 2, h: s.ry * 2 };
  const xs = s.points.map((p) => p[0]);
  const ys = s.points.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function move(s: IoShape, dx: number, dy: number): IoShape {
  const c = (v: number) => Math.min(1, Math.max(0, v));
  if (s.kind === "polygon") return { ...s, points: s.points.map(([x, y]) => [c(x + dx), c(y + dy)] as [number, number]) };
  return { ...s, left: c(s.left + dx), top: c(s.top + dy) };
}

const blank = (kind: IoKind, group: number, hideAll: boolean): IoShape => ({
  group,
  kind,
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  rx: 0,
  ry: 0,
  points: [],
  hideAll,
});

export function OcclusionEditor({ image, occlusion, onChange }: Props) {
  const { db, media } = useApp();
  const [src, setSrc] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("rect");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [draft, setDraftState] = useState<IoShape | null>(null);
  // Olay işleyicileri en güncel taslağı görsün (hızlı hareketlerde state gecikebilir)
  const draftRef = useRef<IoShape | null>(null);
  const setDraft = (d: IoShape | null) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const selectedRef = useRef<Set<number>>(new Set());
  selectedRef.current = selected;
  const shapes = useMemo(() => parseOcclusions(occlusion), [occlusion]);
  const hideAll = shapes.length ? shapes.every((s) => s.hideAll) : true;

  // Resmi göstermek için data: adresine çevir
  const imgPath = /src="([^"]+)"/.exec(image)?.[1] ?? null;
  useEffect(() => {
    if (!db || !imgPath) return setSrc(null);
    let cancelled = false;
    void resolveMediaInHtml(`<img src="${imgPath}">`, db, media).then((h) => {
      if (!cancelled) setSrc(/src="([^"]+)"/.exec(h)?.[1] ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [db, media, imgPath]);

  // En güncel maske metni (aynı anda gelen iki değişiklik birbirini ezmesin)
  const occRef = useRef(occlusion);
  occRef.current = occlusion;
  const latest = () => parseOcclusions(occRef.current);
  const commit = (next: IoShape[]) => {
    const text = serializeOcclusions(renumber(next));
    occRef.current = text;
    onChange(image, text);
  };

  const setImage = async (file: File) => {
    if (!db) return;
    setError(null);
    try {
      const row = await addMediaFile(db, await file.arrayBuffer(), file.name || "resim.png", file.type);
      onChange(`<img src="kk-media/${row.hash}.${extensionFor(file.type, file.name)}">`, occlusion);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const point = (e: PointerEvent | React.MouseEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };

  const nextGroup = () => {
    const cur = latest();
    return cur.length ? Math.max(...cur.map((s) => s.group)) + 1 : 1;
  };

  const finishPolygon = () => {
    const d = draftRef.current;
    if (d?.kind === "polygon" && d.points.length >= 3) commit([...latest(), d]);
    setDraft(null);
  };

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    const [x, y] = point(e);
    if (tool === "polygon") {
      const d = draftRef.current?.kind === "polygon" ? draftRef.current : blank("polygon", nextGroup(), hideAll);
      // İlk noktaya yakın tıklama: bitir
      if (d.points.length >= 3) {
        const [fx, fy] = d.points[0];
        if (Math.hypot(fx - x, fy - y) < 0.02) return finishPolygon();
      }
      setDraft({ ...d, points: [...d.points, [x, y]] });
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x, y, moved: false };
    if (tool === "select") {
      // Tıklanan noktadaki en üstteki maske
      let hit = -1;
      for (let i = shapes.length - 1; i >= 0; i--) {
        const b = bbox(shapes[i]);
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          hit = i;
          break;
        }
      }
      if (hit < 0) {
        if (!e.shiftKey) setSelected(new Set());
        drag.current = null;
      } else if (e.shiftKey || e.metaKey || e.ctrlKey) {
        const next = new Set(selected);
        if (next.has(hit)) next.delete(hit);
        else next.add(hit);
        setSelected(next);
        selectedRef.current = next;
      } else if (!selected.has(hit)) {
        setSelected(new Set([hit]));
        selectedRef.current = new Set([hit]);
      }
      return;
    }
    setDraft({ ...blank(tool, nextGroup(), hideAll), left: x, top: y });
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    if (!start) return;
    const [x, y] = point(e);
    start.moved = true;
    if (tool === "select") {
      const sel = selectedRef.current;
      if (!sel.size) return;
      const dx = x - start.x;
      const dy = y - start.y;
      start.x = x;
      start.y = y;
      onChange(image, serializeOcclusions(shapes.map((s, i) => (sel.has(i) ? move(s, dx, dy) : s))));
      return;
    }
    const draft = draftRef.current;
    if (!draft) return;
    if (tool === "rect") setDraft({ ...draft, left: Math.min(start.x, x), top: Math.min(start.y, y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) });
    if (tool === "ellipse") setDraft({ ...draft, left: (start.x + x) / 2, top: (start.y + y) / 2, rx: Math.abs(x - start.x) / 2, ry: Math.abs(y - start.y) / 2 });
  };

  const onUp = () => {
    drag.current = null;
    const draft = draftRef.current;
    if (!draft || tool === "polygon" || tool === "select") return;
    const b = bbox(draft);
    if (b.w > 0.01 && b.h > 0.01) commit([...latest(), draft]);
    setDraft(null);
  };

  const removeSelected = () => {
    commit(shapes.filter((_, i) => !selected.has(i)));
    setSelected(new Set());
  };
  const group = () => {
    const g = Math.min(...[...selected].map((i) => shapes[i].group));
    commit(shapes.map((s, i) => (selected.has(i) ? { ...s, group: g } : s)));
  };
  const ungroup = () => {
    let n = nextGroup();
    commit(shapes.map((s, i) => (selected.has(i) ? { ...s, group: n++ } : s)));
  };
  const setMode = (all: boolean) => commit(shapes.map((s) => ({ ...s, hideAll: all })));

  // Klavye: Delete sil, Enter çokgeni bitir, Escape vazgeç
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected.size) {
        e.preventDefault();
        removeSelected();
      } else if (e.key === "Enter" && draft?.kind === "polygon") {
        e.preventDefault();
        finishPolygon();
      } else if (e.key === "Escape" && draft) {
        setDraft(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const shapeEl = (s: IoShape, key: string | number, cls: string) => {
    const common = { className: cls };
    if (s.kind === "rect") return <rect key={key} x={s.left * S} y={s.top * S} width={s.width * S} height={s.height * S} rx={6} {...common} />;
    if (s.kind === "ellipse") return <ellipse key={key} cx={s.left * S} cy={s.top * S} rx={s.rx * S} ry={s.ry * S} {...common} />;
    return <polygon key={key} points={s.points.map(([x, y]) => `${x * S},${y * S}`).join(" ")} {...common} />;
  };

  if (!imgPath) {
    return (
      <div
        className="grid min-h-48 place-items-center rounded-xl border-2 border-dashed border-rule bg-surface p-6 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
          if (f) void setImage(f);
        }}
        onPaste={(e) => {
          const f = [...e.clipboardData.files].find((x) => x.type.startsWith("image/"));
          if (f) void setImage(f);
        }}
        tabIndex={0}
      >
        <div className="space-y-2">
          <p className="font-medium">Maskelenecek resmi seç</p>
          <p className="text-sm text-ink-soft">Buraya sürükle, yapıştır (Ctrl/Cmd+V) ya da dosya seç.</p>
          <label className="inline-block cursor-pointer rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink">
            Resim seç
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && void setImage(e.target.files[0])} />
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      </div>
    );
  }

  const groups = new Set(shapes.map((s) => s.group)).size;
  const tools: [Tool, string][] = [
    ["select", "Seç / taşı"],
    ["rect", "Dikdörtgen"],
    ["ellipse", "Elips"],
    ["polygon", "Çokgen"],
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-rule bg-surface p-1 text-sm" role="toolbar" aria-label="Maske araçları">
        {tools.map(([t, label]) => (
          <button
            key={t}
            type="button"
            aria-pressed={tool === t}
            onClick={() => {
              finishPolygon();
              setTool(t);
            }}
            className="rounded-md px-2.5 py-1.5 text-ink-soft hover:bg-ink/5 hover:text-ink aria-pressed:bg-accent/15 aria-pressed:text-ink"
          >
            {label}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-rule" aria-hidden />
        <button type="button" disabled={selected.size < 2} onClick={group} className="rounded-md px-2.5 py-1.5 text-ink-soft hover:bg-ink/5 disabled:opacity-40">
          Grupla
        </button>
        <button type="button" disabled={!selected.size} onClick={ungroup} className="rounded-md px-2.5 py-1.5 text-ink-soft hover:bg-ink/5 disabled:opacity-40">
          Ayır
        </button>
        <button type="button" disabled={!selected.size} onClick={removeSelected} className="rounded-md px-2.5 py-1.5 text-danger hover:bg-danger/10 disabled:opacity-40">
          Sil
        </button>
        {draft?.kind === "polygon" && (
          <Button variant="secondary" className="ml-auto min-h-8 px-2.5 text-sm" onClick={finishPolygon}>
            Çokgeni bitir
          </Button>
        )}
      </div>

      <div className="relative inline-block max-w-full select-none leading-[0]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src && <img src={src} alt="" className="block max-w-full" draggable={false} />}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${S} ${S}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full touch-none"
          style={{ cursor: tool === "select" ? "default" : "crosshair" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onDoubleClick={() => tool === "polygon" && finishPolygon()}
        >
          {shapes.map((s, i) =>
            shapeEl(s, i, `stroke-[3] [vector-effect:non-scaling-stroke] ${selected.has(i) ? "fill-[#ff8e3c]/80 stroke-[#1c7ed6]" : "fill-[#ff8e3c]/60 stroke-[#b4501d]"}`),
          )}
          {shapes.map((s, i) => {
            const b = bbox(s);
            return (
              <text key={`t${i}`} x={(b.x + b.w / 2) * S} y={(b.y + b.h / 2) * S} textAnchor="middle" dominantBaseline="central" className="pointer-events-none fill-white text-[44px] font-bold">
                {s.group}
              </text>
            );
          })}
          {draft && shapeEl(draft, "draft", "fill-[#1c7ed6]/30 stroke-[#1c7ed6] stroke-2 [vector-effect:non-scaling-stroke]")}
          {draft?.kind === "polygon" && draft.points.map(([x, y], i) => <circle key={i} cx={x * S} cy={y * S} r={6} className="fill-[#1c7ed6]" />)}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="text-ink-soft">
          {shapes.length} maske, {groups} kart
        </span>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="io-mode" checked={hideAll} onChange={() => setMode(true)} className="size-4" />
          Hepsini gizle, birini sor
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="io-mode" checked={!hideAll} onChange={() => setMode(false)} className="size-4" />
          Birini gizle, birini sor
        </label>
        <button type="button" onClick={() => onChange("", occlusion)} className="ml-auto text-ink-soft underline hover:text-ink">
          Resmi değiştir
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
