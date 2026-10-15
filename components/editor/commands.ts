"use client";
// Düzenleyici komutları: seçili metne biçim uygular (tarayıcının
// document.execCommand desteğiyle; contentEditable içinde çalışır).

export function exec(command: string, value?: string) {
  document.execCommand(command, false, value);
}

/** Arka plan rengi (vurgulama) CSS ile yazılmalı */
export function highlight(color: string) {
  document.execCommand("styleWithCSS", false, "true");
  document.execCommand("hiliteColor", false, color);
  document.execCommand("styleWithCSS", false, "false");
}

/** Alanlardaki en büyük cloze numarası (yoksa 0) */
export function maxClozeNumber(values: string[]): number {
  let max = 0;
  for (const v of values) for (const m of v.matchAll(/\{\{c(\d+)::/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/** Seçili kısmı {{cN::…}} içine alır; seçim yoksa boş boşluk ekler ve imleci içine koyar */
export function wrapCloze(n: number) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const holder = document.createElement("div");
  holder.appendChild(range.cloneContents());
  const inner = holder.innerHTML;
  if (inner) {
    document.execCommand("insertHTML", false, `{{c${n}::${inner}}}`);
  } else {
    document.execCommand("insertText", false, `{{c${n}::}}`);
    const s = window.getSelection() as Selection & { modify?: (a: string, d: string, g: string) => void };
    s.modify?.("move", "backward", "character");
    s.modify?.("move", "backward", "character");
  }
}

/** Link ekler (seçili metne); adres sorulur */
export function insertLink() {
  const url = window.prompt("Bağlantı adresi (https://…)", "https://");
  if (!url || url === "https://") return;
  if (!/^(https?:|mailto:)/i.test(url)) return;
  exec("createLink", url);
}
