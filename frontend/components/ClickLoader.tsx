"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useI18n } from "@/components/I18nProvider";

const MIN_VISIBLE_MS = 2000;
const NAV_TIMEOUT_MS = 15000;
const BRAND = ["#4169E1", "#DC143C", "#228B22", "#DAA520"];

// Clicks on these show the loader. Plain inputs, selects, <summary> and [data-no-loader] don't.
const TRIGGER =
  "a[href]:not([data-no-loader]), button:not([disabled]):not([data-no-loader]), input[type='submit']:not([disabled])";

function isInternalNavigation(a: HTMLAnchorElement): boolean {
  if (a.target && a.target !== "_self") return false;
  if (a.hasAttribute("download")) return false;
  const url = new URL(a.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  const here = window.location;
  // Same page, or a jump to an anchor on it: nothing to wait for.
  return url.pathname !== here.pathname || url.search !== here.search;
}

export default function ClickLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [run, setRun] = useState(0);
  const minTimer = useRef<number | undefined>(undefined);
  const navTimer = useRef<number | undefined>(undefined);
  const minElapsed = useRef(true);
  const navPending = useRef(false);

  const maybeHide = useCallback(() => {
    if (minElapsed.current && !navPending.current) setVisible(false);
  }, []);

  const start = useCallback((navigates: boolean) => {
    window.clearTimeout(minTimer.current);
    window.clearTimeout(navTimer.current);
    minElapsed.current = false;
    navPending.current = navigates;
    setRun((n) => n + 1);
    setVisible(true);
    minTimer.current = window.setTimeout(() => {
      minElapsed.current = true;
      maybeHide();
    }, MIN_VISIBLE_MS);
    if (navigates) {
      // Never leave the overlay up if a navigation stalls or is cancelled.
      navTimer.current = window.setTimeout(() => {
        navPending.current = false;
        maybeHide();
      }, NAV_TIMEOUT_MS);
    }
  }, [maybeHide]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const el = (e.target as Element | null)?.closest?.(TRIGGER);
      if (!el) return;
      if (el instanceof HTMLAnchorElement) {
        start(isInternalNavigation(el));
      } else {
        // A submit button on a GET form (the image filters) navigates; others don't.
        const form = (el as HTMLButtonElement | HTMLInputElement).form;
        const type = el.getAttribute("type") ?? "submit";
        const navigates = !!form && type === "submit" && (form.method || "get").toLowerCase() === "get";
        start(navigates);
      }
    }
    // Capture phase: next/link calls preventDefault before a bubbling listener would run.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [start]);

  // The URL changed: the navigation this loader was waiting on has rendered.
  useEffect(() => {
    if (!navPending.current) return;
    navPending.current = false;
    window.clearTimeout(navTimer.current);
    maybeHide();
  }, [pathname, searchParams, maybeHide]);

  useEffect(() => () => {
    window.clearTimeout(minTimer.current);
    window.clearTimeout(navTimer.current);
  }, []);

  return (
    <div className={`click-loader${visible ? " is-visible" : ""}`} aria-hidden={!visible}>
      <div key={run} className="click-loader-bar" />
      {visible && (
        <div className="click-loader-card" role="status" aria-live="polite">
          {/* The brand mark: same 2x2 colour squares as the navbar logo. */}
          <span className="click-loader-logo" aria-hidden>
            {BRAND.map((c) => <i key={c} style={{ background: c }} />)}
          </span>
          <span>{t.header.loading}</span>
        </div>
      )}
    </div>
  );
}
