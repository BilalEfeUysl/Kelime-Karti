"use client";
// ALAN DÜZENLEYİCİ: zengin metin kutusu (contentEditable).
//  - Biçimlendirme: araç çubuğu (EditorToolbar) + Ctrl/Cmd+B/I/U
//  - HTML görünümü: alanın ham HTML'i düz metin kutusunda düzenlenir
//  - Cloze: Alt+C (ya da Ctrl/Cmd+Shift+C) yeni numara, Alt+Shift+C aynı numara
//    (Chrome Ctrl/Cmd+Shift+C'yi "öğeyi incele" için ayırabildiğinden Alt+C de var)
//  - Resim yapıştırma / sürükle-bırak: resim cihaza kaydedilir, alana eklenir
//  - Yapıştırılan HTML DOMPurify ile temizlenir (zararlı kod girmez)
// Alanda resimler "kk-media/<hash>.png" olarak saklanır; düzenleyicide
// gösterebilmek için data: adresine çevrilir, kaydederken geri çevrilir.
import DOMPurify from "dompurify";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { resolveMediaInHtml } from "@/lib/media-url";
import { addMediaFile, extensionFor } from "@/lib/sync/media";

const PURIFY = {
  ALLOWED_TAGS: ["b", "strong", "i", "em", "u", "s", "sub", "sup", "br", "div", "p", "span", "ul", "ol", "li", "img", "a", "font", "ruby", "rt", "rp", "table", "thead", "tbody", "tr", "td", "th", "hr", "code", "pre", "blockquote", "h1", "h2", "h3", "small", "mark"],
  ALLOWED_ATTR: ["src", "alt", "href", "color", "style", "data-kk-src", "colspan", "rowspan", "title"],
};

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, PURIFY) as unknown as string;
}

/** Düzenleyiciden çıkan HTML'i saklanacak biçime çevirir */
export function fromEditorHtml(html: string): string {
  const clean = sanitizeHtml(html);
  return clean
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const original = tag.match(/data-kk-src="([^"]+)"/)?.[1];
      if (!original) return tag;
      return tag.replace(/\s*data-kk-src="[^"]*"/, "").replace(/\bsrc="[^"]*"/, `src="${original}"`);
    })
    .replace(/^(<br>|\s)+$/, "");
}

/** Saklanan HTML'i düzenleyicide gösterilecek biçime çevirir */
async function toEditorHtml(html: string, resolve: (h: string) => Promise<string>): Promise<string> {
  const withMarks = html.replace(/<img\b[^>]*\bsrc="(kk-media\/[^"]+)"[^>]*>/gi, (tag, src: string) =>
    tag.includes("data-kk-src") ? tag : tag.replace(/<img\b/i, `<img data-kk-src="${src}"`),
  );
  return resolve(withMarks);
}

interface Props {
  label: string;
  value: string;
  onChange: (html: string) => void;
  autoFocus?: boolean;
  onSubmitShortcut?: () => void;
  /** HTML görünümü açık mı */
  htmlMode?: boolean;
  onFocus?: () => void;
  /** Cloze kısayolu: same=true → aynı numara */
  onCloze?: (same: boolean) => void;
  /** Yapışkan alan düğmesi (sadece kart ekleme ekranında) */
  sticky?: { on: boolean; toggle: () => void };
  /** Alanın altında gösterilecek uyarı (ör. kopya) */
  warning?: ReactNode;
}

export function FieldEditor({ label, value, onChange, autoFocus, onSubmitShortcut, htmlMode = false, onFocus, onCloze, sticky, warning }: Props) {
  const { db, media } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Dışarıdan gelen değer değiştiyse (ör. form sıfırlandı) kutuyu güncelle
  useEffect(() => {
    if (htmlMode) {
      lastEmitted.current = null; // geri dönünce kutu yeniden doldurulsun
      return;
    }
    if (!ref.current || !db || value === lastEmitted.current) return;
    let cancelled = false;
    // Kutuya gerçekten yazıldığında "gösterildi" say (yarıda iptal edilen yükleme kutuyu boş bırakmasın)
    void toEditorHtml(value, (h) => resolveMediaInHtml(h, db, media)).then((html) => {
      if (cancelled || !ref.current) return;
      ref.current.innerHTML = html;
      lastEmitted.current = value;
    });
    return () => {
      cancelled = true;
    };
  }, [value, db, media, htmlMode]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const emit = () => {
    if (!ref.current) return;
    const html = fromEditorHtml(ref.current.innerHTML);
    lastEmitted.current = html;
    onChange(html);
  };

  const insertImages = async (files: File[]) => {
    if (!db) return;
    setError(null);
    for (const file of files) {
      const data = await file.arrayBuffer();
      let row;
      try {
        row = await addMediaFile(db, data, file.name || "yapistirilan.png", file.type);
      } catch (err) {
        setError((err as Error).message);
        continue;
      }
      const src = `kk-media/${row.hash}.${extensionFor(file.type, file.name)}`;
      const display = await resolveMediaInHtml(src, db, media);
      ref.current?.focus();
      document.execCommand("insertHTML", false, `<img src="${display}" data-kk-src="${src}">`);
    }
    emit();
  };

  const labelRow = (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="text-sm font-semibold">{label}</span>
      {sticky && (
        <button
          type="button"
          onClick={sticky.toggle}
          aria-pressed={sticky.on}
          title={sticky.on ? "Yapışkan: kart eklenince bu alan temizlenmez" : "Yapışkan yap (kart eklenince temizlenmesin)"}
          className="grid size-6 place-items-center rounded text-ink-soft/60 hover:text-ink aria-pressed:text-accent"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill={sticky.on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M9 4h6l-1 6 4 3v2H6v-2l4-3zM12 15v6" strokeLinejoin="round" />
          </svg>
          <span className="sr-only">Yapışkan alan</span>
        </button>
      )}
    </div>
  );

  if (htmlMode) {
    return (
      <div>
        {labelRow}
        <textarea
          value={value}
          aria-label={`${label} (HTML)`}
          spellCheck={false}
          onFocus={onFocus}
          onChange={(e) => {
            lastEmitted.current = e.target.value;
            onChange(e.target.value);
          }}
          onBlur={(e) => {
            const clean = fromEditorHtml(e.target.value);
            if (clean !== e.target.value) onChange(clean);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onSubmitShortcut?.();
            }
          }}
          rows={Math.min(12, Math.max(3, value.split("\n").length + 1))}
          className="w-full rounded-lg border border-rule bg-surface px-3 py-2.5 font-mono text-sm leading-relaxed focus:border-accent focus:outline-none"
        />
        {warning}
      </div>
    );
  }

  return (
    <div>
      {labelRow}
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        onFocus={onFocus}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            emit();
            onSubmitShortcut?.();
          } else if (onCloze && e.code === "KeyC" && (e.altKey || (e.shiftKey && (e.metaKey || e.ctrlKey)))) {
            // Alt+C veya Ctrl/Cmd+Shift+C: yeni numara; Alt+Shift+C: aynı numara
            e.preventDefault();
            onCloze(e.altKey && e.shiftKey);
            emit();
          }
        }}
        onPaste={(e) => {
          const images = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
          if (images.length) {
            e.preventDefault();
            void insertImages(images);
            return;
          }
          const html = e.clipboardData.getData("text/html");
          if (html) {
            e.preventDefault();
            document.execCommand("insertHTML", false, sanitizeHtml(html));
            emit();
          }
        }}
        onDrop={(e) => {
          const images = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
          if (images.length) {
            e.preventDefault();
            void insertImages(images);
          }
        }}
        className="min-h-12 w-full rounded-lg border border-rule bg-surface px-3 py-2.5 text-base leading-relaxed focus:border-accent focus:outline-none [&_img]:inline-block [&_img]:max-h-48 [&_img]:max-w-full"
      />
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
      {warning}
    </div>
  );
}
