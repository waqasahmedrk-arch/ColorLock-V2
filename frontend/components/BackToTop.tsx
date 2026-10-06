"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";

const SHOW_AFTER = 400; // px scrolled before the button appears
const R = 22; // progress ring radius (SVG units)
const C = 2 * Math.PI * R;

// Floating "back to top" button: fades in once the page has scrolled, and its ring fills with
// how far down the page the reader is.
export default function BackToTop() {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setShown(y > SHOW_AFTER);
      setProgress(max > 0 ? Math.min(1, y / max) : 0);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  const toTop = () => {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  };

  return (
    <button type="button" className={`to-top${shown ? " is-shown" : ""}`} data-no-loader onClick={toTop}
            aria-label={t.footer.backToTop} title={t.footer.backToTop} tabIndex={shown ? 0 : -1}
            aria-hidden={!shown}>
      <svg className="to-top-ring" viewBox="0 0 52 52" aria-hidden>
        <circle cx="26" cy="26" r={R} className="to-top-track" />
        <circle cx="26" cy="26" r={R} className="to-top-fill"
                style={{ strokeDasharray: C, strokeDashoffset: C * (1 - progress) }} />
      </svg>
      <Icon name="arrowUp" />
    </button>
  );
}
