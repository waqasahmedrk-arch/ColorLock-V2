"use client";

import { useEffect, useRef } from "react";

// The documentation page's moving parts: a reading-progress bar, the contents entry for the
// section being read, and sections fading in as they scroll into view. The page is fully
// readable without this: content is only hidden once the effect has armed it.
export default function DocsScrollSpy({ ids }: { ids: string[] }) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".docs");
    const sections = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el);
    if (!root || !sections.length || typeof IntersectionObserver === "undefined") return;

    // Reveal each section once.
    root.setAttribute("data-armed", "");
    const reveal = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.setAttribute("data-in", ""); reveal.unobserve(e.target); }
      }
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.05 });
    sections.forEach((s) => reveal.observe(s));

    // Highlight the contents entry for the section crossing the upper part of the screen.
    const links = new Map(ids.map((id) => [id, document.querySelector<HTMLElement>(`[data-toc="${id}"]`)]));
    const setActive = (id: string) => {
      links.forEach((a, key) => a?.toggleAttribute("aria-current", key === id));
    };
    const spy = new IntersectionObserver((entries) => {
      const hit = entries.filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (hit) setActive(hit.target.id);
    }, { rootMargin: "-25% 0px -65% 0px" });
    sections.forEach((s) => spy.observe(s));
    setActive(window.location.hash.slice(1) || ids[0]);

    let frame = 0;
    const progress = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (barRef.current) barRef.current.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(progress); };
    progress();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      reveal.disconnect();
      spy.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [ids]);

  return <div ref={barRef} className="docs-progress" aria-hidden />;
}
