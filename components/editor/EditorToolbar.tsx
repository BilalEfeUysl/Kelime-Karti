"use client";
// Düzenleyici araç çubuğu: odaktaki alana biçim uygular.
// Düğmeler fareyle basılınca odağı almaz (onMouseDown preventDefault), böylece
// seçim alanın içinde kalır.
import { type ReactNode, useState } from "react";
import { exec, highlight, insertLink } from "./commands";

interface Props {
  /** Odaktaki alan HTML görünümünde mi */
  htmlMode: boolean;
  onToggleHtml: () => void;
  /** Cloze not tipiyse cloze düğmeleri görünür */
  cloze?: { onNew: () => void; onSame: () => void };
  disabled?: boolean;
  className?: string;
}

const TEXT_COLORS = ["#d6336c", "#e8590c", "#2f9e44", "#1c7ed6", "#7048e8", "#000000"];
const MARK_COLORS = ["#fff3bf", "#d3f9d8", "#d0ebff", "#ffe3e3", "#f3d9fa"];

function Btn({ title, onClick, children, active, disabled }: { title: string; onClick: () => void; children: ReactNode; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="grid h-8 min-w-8 shrink-0 place-items-center rounded-md px-1.5 text-[15px] text-ink-soft hover:bg-ink/5 hover:text-ink disabled:opacity-40 aria-pressed:bg-accent/15 aria-pressed:text-accent"
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-0.5 h-5 w-px shrink-0 bg-rule" aria-hidden />;

export function EditorToolbar({ htmlMode, onToggleHtml, cloze, disabled, className = "" }: Props) {
  const [palette, setPalette] = useState<"text" | "mark" | null>(null);
  const off = disabled || htmlMode;
  return (
    <div className={`relative rounded-lg border border-rule bg-surface ${className}`}>
      <div role="toolbar" aria-label="Biçimlendirme" className="flex flex-wrap items-center gap-0.5 p-1">
        <Btn title="Kalın (Ctrl/Cmd+B)" onClick={() => exec("bold")} disabled={off}>
          <b>B</b>
        </Btn>
        <Btn title="İtalik (Ctrl/Cmd+I)" onClick={() => exec("italic")} disabled={off}>
          <i className="font-serif">I</i>
        </Btn>
        <Btn title="Altı çizili (Ctrl/Cmd+U)" onClick={() => exec("underline")} disabled={off}>
          <u>U</u>
        </Btn>
        <Btn title="Üst simge" onClick={() => exec("superscript")} disabled={off}>
          <span>
            x<sup>2</sup>
          </span>
        </Btn>
        <Btn title="Alt simge" onClick={() => exec("subscript")} disabled={off}>
          <span>
            x<sub>2</sub>
          </span>
        </Btn>
        <Sep />
        <Btn title="Yazı rengi" onClick={() => setPalette(palette === "text" ? null : "text")} active={palette === "text"} disabled={off}>
          <span className="border-b-[3px] border-[#d6336c] leading-none">A</span>
        </Btn>
        <Btn title="Vurgula" onClick={() => setPalette(palette === "mark" ? null : "mark")} active={palette === "mark"} disabled={off}>
          <span className="rounded-sm bg-[#fff3bf] px-1 leading-none text-black">A</span>
        </Btn>
        <Sep />
        <Btn title="Madde işaretli liste" onClick={() => exec("insertUnorderedList")} disabled={off}>
          ••
        </Btn>
        <Btn title="Numaralı liste" onClick={() => exec("insertOrderedList")} disabled={off}>
          1.
        </Btn>
        <Btn title="Bağlantı ekle" onClick={insertLink} disabled={off}>
          🔗
        </Btn>
        <Sep />
        <Btn title="Sola hizala" onClick={() => exec("justifyLeft")} disabled={off}>
          <AlignIcon kind="left" />
        </Btn>
        <Btn title="Ortala" onClick={() => exec("justifyCenter")} disabled={off}>
          <AlignIcon kind="center" />
        </Btn>
        <Btn title="Sağa hizala" onClick={() => exec("justifyRight")} disabled={off}>
          <AlignIcon kind="right" />
        </Btn>
        <Btn
          title="Biçimi temizle"
          onClick={() => {
            exec("removeFormat");
            exec("unlink");
          }}
          disabled={off}
        >
          <span className="text-[13px]">
            T<sub>×</sub>
          </span>
        </Btn>
        {cloze && (
          <>
            <Sep />
            <Btn title="Yeni boşluk (Alt+C ya da Ctrl/Cmd+Shift+C)" onClick={cloze.onNew} disabled={off}>
              <span className="text-[13px] font-semibold">[…]+</span>
            </Btn>
            <Btn title="Aynı numaralı boşluk (Alt+Shift+C)" onClick={cloze.onSame} disabled={off}>
              <span className="text-[13px] font-semibold">[…]=</span>
            </Btn>
          </>
        )}
        <Sep />
        <Btn title="HTML görünümü" onClick={onToggleHtml} active={htmlMode} disabled={disabled}>
          <span className="font-mono text-[12px]">{"</>"}</span>
        </Btn>
      </div>
      {palette && !off && (
        <div className="absolute left-1 top-full z-20 mt-1 flex gap-1.5 rounded-lg border border-rule bg-surface p-2 shadow-lg">
          {(palette === "text" ? TEXT_COLORS : MARK_COLORS).map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Renk ${c}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (palette === "text") exec("foreColor", c);
                else highlight(c);
                setPalette(null);
              }}
              className="size-7 rounded-md border border-rule"
              style={{ background: c }}
            />
          ))}
          {palette === "mark" && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                highlight("transparent");
                setPalette(null);
              }}
              className="rounded-md border border-rule px-2 text-xs text-ink-soft"
            >
              Yok
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AlignIcon({ kind }: { kind: "left" | "center" | "right" }) {
  const short = kind === "left" ? "M4 12h10M4 18h14" : kind === "center" ? "M7 12h10M5 18h14" : "M10 12h10M6 18h14";
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 6h16" />
      <path d={short} />
    </svg>
  );
}
