"use client";

import { useEffect } from "react";

// Drives the floating navbar from the scroll position:
// - <html data-scrolled> once the page leaves the top, so the bar tightens and lifts;
// - <html data-nav-hidden> while scrolling down past the first screenful, so the bar slides
//   away, cleared again on any real scroll up.
const HIDE_AFTER = 120; // px from the top before the bar may hide
const MIN_DELTA = 6; // px; ignores trackpad jitter

export default function HeaderScroll() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    let lastY = window.scrollY;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      root.toggleAttribute("data-scrolled", y > 4);
      const delta = y - lastY;
      if (Math.abs(delta) < MIN_DELTA) return;
      // Keep the bar while one of its menus is open or it has keyboard focus.
      const busy = !!document.querySelector("header.site .user-pop, header.site .notif-pop, .mobile-nav")
        || !!document.activeElement?.closest("header.site");
      root.toggleAttribute("data-nav-hidden", delta > 0 && y > HIDE_AFTER && !busy);
      lastY = y;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      root.removeAttribute("data-nav-hidden");
    };
  }, []);
  return null;
}
