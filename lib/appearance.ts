"use client";
// GÖRÜNÜM TERCİHLERİ (cihaza özel; eşlenmez — telefonla bilgisayarda farklı
// olabilsin diye): yazı boyutu, kart ölçeği, koyu modda kart renkleri, sade
// çalışma modu ve çalışma kısayolları.
import { useSyncExternalStore } from "react";
import { readJSON, writeJSON } from "./storage";

export type StudyAction =
  | "showAnswer"
  | "again"
  | "hard"
  | "good"
  | "easy"
  | "edit"
  | "info"
  | "mark"
  | "buryCard"
  | "buryNote"
  | "suspendCard"
  | "suspendNote"
  | "gemini";

export const ACTION_LABELS: Record<StudyAction, string> = {
  showAnswer: "Cevabı göster / İyi",
  again: "Tekrar",
  hard: "Zor",
  good: "İyi",
  easy: "Kolay",
  edit: "Notu düzenle",
  info: "Kart bilgisi",
  mark: "Notu işaretle",
  buryCard: "Kartı yarına ertele",
  buryNote: "Notu yarına ertele",
  suspendCard: "Kartı askıya al",
  suspendNote: "Notu askıya al",
  gemini: "Gemini'ye sor",
};

export const DEFAULT_SHORTCUTS: Record<StudyAction, string> = {
  showAnswer: " ",
  again: "1",
  hard: "2",
  good: "3",
  easy: "4",
  edit: "e",
  info: "i",
  mark: "*",
  buryCard: "-",
  buryNote: "=",
  suspendCard: "@",
  suspendNote: "!",
  gemini: "g",
};

export interface Appearance {
  /** Kart yazı boyutu çarpanı (0.8–1.6) */
  fontScale: number;
  /** Kartın tamamının ölçeği (0.8–1.5) */
  cardZoom: number;
  /** Koyu modda kartlar: auto = şablonun koyu stili, force = uygulamanın koyu renkleri, off = açık kalsın */
  darkCards: "auto" | "force" | "off";
  /** Sade çalışma: sayılar ve işlem satırı gizli */
  minimal: boolean;
  shortcuts: Record<StudyAction, string>;
}

export const DEFAULT_APPEARANCE: Appearance = {
  fontScale: 1,
  cardZoom: 1,
  darkCards: "auto",
  minimal: false,
  shortcuts: DEFAULT_SHORTCUTS,
};

const KEY = "kk.appearance";
const EVENT = "kk-appearance";
let cached: Appearance | null = null;

function load(): Appearance {
  if (cached) return cached;
  const raw = readJSON<Partial<Appearance>>(KEY) ?? {};
  cached = {
    ...DEFAULT_APPEARANCE,
    ...raw,
    fontScale: Math.min(1.6, Math.max(0.8, Number(raw.fontScale) || 1)),
    cardZoom: Math.min(1.5, Math.max(0.8, Number(raw.cardZoom) || 1)),
    darkCards: raw.darkCards === "force" || raw.darkCards === "off" ? raw.darkCards : "auto",
    shortcuts: { ...DEFAULT_SHORTCUTS, ...(raw.shortcuts ?? {}) },
  };
  return cached;
}

export function setAppearance(patch: Partial<Appearance>) {
  cached = { ...load(), ...patch };
  writeJSON(KEY, cached);
  window.dispatchEvent(new Event(EVENT));
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb);
      return () => window.removeEventListener(EVENT, cb);
    },
    load,
    () => DEFAULT_APPEARANCE,
  );
}

/** Kart çerçevesine eklenecek stil */
export function appearanceCss(a: Appearance, night: boolean): string {
  let css = "";
  if (a.fontScale !== 1) css += `#qa{font-size:${a.fontScale}em}`;
  if (a.cardZoom !== 1) css += `html{zoom:${a.cardZoom}}`;
  if (night && a.darkCards === "force") css += `.card,body{background-color:#252421!important;color:#ddd7cc!important}`;
  return css;
}

/** Tuşun görünen adı */
export function keyLabel(key: string): string {
  if (key === " ") return "Boşluk";
  if (key === "Enter") return "Enter";
  return key.length === 1 ? key.toUpperCase() : key;
}

/** Basılan tuş hangi eyleme denk geliyor? (harfler büyük/küçük duyarsız) */
export function actionForKey(key: string, shortcuts: Record<StudyAction, string>): StudyAction | null {
  const k = key.length === 1 ? key.toLowerCase() : key;
  for (const [action, bound] of Object.entries(shortcuts) as [StudyAction, string][]) {
    if ((bound.length === 1 ? bound.toLowerCase() : bound) === k) return action;
  }
  return null;
}
