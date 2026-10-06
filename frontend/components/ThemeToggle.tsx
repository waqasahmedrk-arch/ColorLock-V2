"use client";

import { useLayoutEffect } from "react";
import { useI18n } from "@/components/I18nProvider";

const STORAGE_KEY = "theme";

// Runs in <head> before first paint so a saved choice never flashes the other theme.
// With nothing saved, no attribute is set and the CSS follows the system setting.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

function readSaved(): string | null {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

export default function ThemeToggle() {
  const { t } = useI18n();
  // React's dev-mode remount clears attributes on <html>; put the saved one back. No-op in production.
  useLayoutEffect(() => {
    const saved = readSaved();
    if (saved) document.documentElement.setAttribute("data-theme", saved);
  }, []);

  function toggle() {
    const root = document.documentElement;
    const current =
      root.getAttribute("data-theme") ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode): the choice lasts for this page only.
    }
  }

  // Both icons are rendered; CSS shows the one for the theme you would switch to.
  return (
    <button type="button" className="theme-toggle" onClick={toggle} data-no-loader
      aria-label={t.header.toggleTheme} title={t.header.toggleThemeTitle}>
      <svg className="icon-moon" viewBox="0 0 24 24" width="18" height="18" aria-hidden>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <svg className="icon-sun" viewBox="0 0 24 24" width="18" height="18" aria-hidden>
        <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </g>
      </svg>
    </button>
  );
}
