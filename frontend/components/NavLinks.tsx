"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import Icon, { type IconName } from "@/components/Icon";
import type { Dict } from "@/lib/i18n";

// Shared with MobileNav, which shows the same links behind the ☰ button on small screens.
export const LINKS: { href: string; label: keyof Dict["nav"]; icon: IconName }[] = [
  { href: "/", label: "results", icon: "chart" },
  { href: "/images", label: "images", icon: "image" },
  { href: "/score", label: "score", icon: "pipette" },
  { href: "/provenance", label: "provenance", icon: "shield" },
  { href: "/history", label: "history", icon: "history" },
];

type Box = { left: number; width: number } | null;

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function boxOf(el: HTMLElement | null | undefined): Box {
  return el ? { left: el.offsetLeft, width: el.offsetWidth } : null;
}

export default function NavLinks() {
  const pathname = usePathname();
  const { t, locale } = useI18n();
  const navRef = useRef<HTMLElement>(null);
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const activeIndex = LINKS.findIndex((l) => isActive(pathname, l.href));
  const [active, setActive] = useState<Box>(null);
  const [hover, setHover] = useState<Box>(null);
  // The first placement jumps into position; later ones slide.
  const [ready, setReady] = useState(false);

  const measure = useCallback(() => {
    setActive(boxOf(linkRefs.current[activeIndex]));
    // Link widths change with the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, locale]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Link widths change with fonts loading and window size.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <nav
      ref={navRef}
      className="site"
      data-ready={ready ? "" : undefined}
      onMouseLeave={() => setHover(null)}
    >
      <span
        className="nav-hover"
        aria-hidden
        style={hover ? { transform: `translateX(${hover.left}px)`, width: hover.width, opacity: 1 } : undefined}
      />
      {active && (
        <span
          className="nav-indicator"
          aria-hidden
          style={{ transform: `translateX(${active.left}px)`, width: active.width }}
        >
          <i key={pathname} className="nav-indicator-arrow" />
        </span>
      )}
      {LINKS.map(({ href, label, icon }, i) => (
        <Link
          key={href}
          href={href}
          ref={(el) => { linkRefs.current[i] = el; }}
          aria-current={i === activeIndex ? "page" : undefined}
          onMouseEnter={(e) => setHover(boxOf(e.currentTarget))}
          onFocus={(e) => setHover(boxOf(e.currentTarget))}
          onBlur={() => setHover(null)}
        >
          <Icon name={icon} />
          {t.nav[label]}
        </Link>
      ))}
    </nav>
  );
}
