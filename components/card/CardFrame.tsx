"use client";
// KART GÖSTERİCİ: Kart HTML'ini kum havuzlu (sandbox) bir iframe'de çizer.
//   sandbox="allow-scripts" → kart içindeki JavaScript çalışır,
//   allow-same-origin YOK  → kartın kodu uygulamanın verisine/oturumuna erişemez.
// iframe ile uygulama arasında sadece mesajlaşılır (yükseklik, tuşlar, yazılan cevap).
import { useEffect, useMemo, useRef, useState } from "react";
import { BASE_CARD_CSS } from "@/lib/template/base-css";
import { hasMath, renderMath } from "@/lib/math";
import { appearanceCss, useAppearance } from "@/lib/appearance";

export interface CardKey {
  key: string;
  code: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

interface Props {
  html: string;
  css: string;
  cardOrd: number;
  night: boolean;
  /** "Cevabı yaz" kutusuna yazılan metin */
  onTyped?: (value: string) => void;
  /** Cevap kutusunda Enter */
  onEnter?: () => void;
  /** Kart odaktayken basılan tuşlar (kısayollar için) */
  onKey?: (key: CardKey) => void;
  focusInput?: boolean;
  minHeight?: number;
}

// iframe içinde çalışan küçük köprü betiği
const BRIDGE = `(function(){
  function post(m){ m.kk = 1; parent.postMessage(m, "*"); }
  function report(){ post({ type: "height", h: Math.ceil(document.documentElement.getBoundingClientRect().height) }); }
  try { new ResizeObserver(report).observe(document.documentElement); } catch (e) {}
  window.addEventListener("load", report); report();
  document.querySelectorAll("img").forEach(function(img){ img.addEventListener("load", report); });
  document.addEventListener("keydown", function(e){
    var t = e.target, typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    if (typing) { if (e.key === "Enter") { e.preventDefault(); post({ type: "enter" }); } return; }
    post({ type: "key", key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey });
    if (e.key === " " || e.key === "Enter") e.preventDefault();
  });
  var input = document.getElementById("typeans");
  if (input && input.tagName === "INPUT") {
    input.addEventListener("input", function(){ post({ type: "typed", value: input.value }); });
    if (window.__kkFocus) setTimeout(function(){ input.focus(); }, 30);
  }
  document.addEventListener("click", function(e){
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (a && a.getAttribute("href") !== "#") e.preventDefault();
  });
})();`;

export function CardFrame({ html, css, cardOrd, night, onTyped, onEnter, onKey, focusInput, minHeight = 160 }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);
  const handlers = useRef({ onTyped, onEnter, onKey });
  handlers.current = { onTyped, onEnter, onKey };

  // Formül varsa KaTeX ile çiz (ilk sefer modülü yükler)
  const [math, setMath] = useState<{ src: string; html: string; css: string } | null>(null);
  useEffect(() => {
    if (!hasMath(html)) return;
    let cancelled = false;
    void renderMath(html).then((r) => !cancelled && setMath({ src: html, ...r }));
    return () => {
      cancelled = true;
    };
  }, [html]);
  const ready = math?.src === html ? math : null;
  const look = useAppearance();

  const srcDoc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<style>${BASE_CARD_CSS}</style><style>${css}</style>${ready ? `<style>${ready.css}</style>` : ""}<style>${appearanceCss(look, night)}</style></head>` +
      `<body class="card card${cardOrd + 1}${night && look.darkCards !== "off" ? " nightMode night_mode" : ""}"><div id="qa">${ready ? ready.html : html}</div>` +
      `<script>window.__kkFocus=${focusInput ? "true" : "false"};</script><script>${BRIDGE}</script></body></html>`,
    [html, css, cardOrd, night, focusInput, ready, look],
  );

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow || !e.data?.kk) return;
      const d = e.data as { type: string; h?: number; value?: string } & CardKey;
      if (d.type === "height" && d.h) setHeight(Math.max(minHeight, d.h));
      else if (d.type === "typed") handlers.current.onTyped?.(d.value ?? "");
      else if (d.type === "enter") handlers.current.onEnter?.();
      else if (d.type === "key") handlers.current.onKey?.(d);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [minHeight]);

  // Her yeni içerik için TAZE bir iframe: var olan iframe'in içeriğini değiştirmek
  // bazı tarayıcılarda (kum havuzlu, ayrı süreçte çalışan iframe) çizimin askıda
  // kalmasına yol açabiliyor.
  return (
    <iframe
      key={srcDoc}
      ref={ref}
      title="Kart"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      className="block w-full border-0 bg-transparent"
      style={{ height }}
    />
  );
}
