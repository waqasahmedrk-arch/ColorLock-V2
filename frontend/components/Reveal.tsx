"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Scroll reveal: marks the wrapper data-armed on mount and data-in once it is on screen.
// CSS hides `.reveal-item` children only while armed and not yet in, so no-JS shows everything.
export default function Reveal({ as: Tag = "div", className, children }: { as?: "div" | "section" | "tbody"; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.setAttribute("data-armed", "");
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        el.setAttribute("data-in", "");
        io.disconnect();
      }
    }, { rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return <Tag ref={ref as never} className={className ? `reveal ${className}` : "reveal"}>{children}</Tag>;
}
