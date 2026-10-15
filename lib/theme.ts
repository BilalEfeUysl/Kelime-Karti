// Açık / koyu / sistem teması. Tercih bu cihazda saklanır (localStorage),
// çünkü telefonda koyu, bilgisayarda açık isteyen olabilir.
export type ThemePref = "system" | "light" | "dark";
export const THEME_KEY = "kk.theme";

/** Sayfa çizilmeden ÖNCE çalışan küçük betik (beyaz yanıp sönmeyi önler). */
export const themeInitScript = `(function(){try{var p=localStorage.getItem('${THEME_KEY}')||'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(pref: ThemePref) {
  const dark =
    pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    // gizli sekmede localStorage kapalı olabilir; tema yine uygulanır
  }
  applyTheme(pref);
}
