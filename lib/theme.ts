// Açık / koyu / sistem teması. Tercih bu cihazda saklanır (localStorage),
// çünkü telefonda koyu, bilgisayarda açık isteyen olabilir.
export type ThemePref = "system" | "light" | "dark";
export const THEME_KEY = "kk.theme";

export const SIDEBAR_KEY = "kk.sidebar";

/** Sayfa çizilmeden ÖNCE çalışan küçük betik (beyaz yanıp sönmeyi ve yan
 *  menünün açılıp kapanırken zıplamasını önler). */
export const themeInitScript = `(function(){var r=document.documentElement;try{var p=localStorage.getItem('${THEME_KEY}')||'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';r.dataset.sidebar=localStorage.getItem('${SIDEBAR_KEY}')==='open'?'open':'closed';}catch(e){r.dataset.sidebar='closed';}})();`;

/** Bilgisayardaki yan menüyü aç/kapat (bu cihazda hatırlanır) */
export function setSidebarOpen(open: boolean) {
  document.documentElement.dataset.sidebar = open ? "open" : "closed";
  try {
    localStorage.setItem(SIDEBAR_KEY, open ? "open" : "closed");
  } catch {
    // önemli değil
  }
}

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
