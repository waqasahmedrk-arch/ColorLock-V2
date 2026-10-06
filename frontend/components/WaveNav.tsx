"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import { LINKS, isActive } from "@/components/NavLinks";
import type { Dict } from "@/lib/i18n";

// Top navigation (desktop): the header pill is drawn as one SVG shape whose top edge dips in a
// smooth wave over the current page, with that page's icon in an orb floating above its name. On
// navigation the dip springs to the new link and stretches with its speed, so it moves like
// something soft. Below the ☰ breakpoint this is hidden and MobileNav takes over.

const DEPTH = 22; // how far the dip reaches down into the bar
const HALF = 30; // half-width of the dip's floor; its shoulders reach ~1.75x further
const ORB = 40; // orb diameter
const GAP = 4; // space between the dip and the orb

const SHORT: Partial<Record<keyof Dict["nav"], keyof Dict["nav"]>> = { score: "scoreShort" };

// A pill (fully rounded ends) whose top edge has one smooth downward dip centred on x.
function pillPath(w: number, h: number, x: number, half: number, depth: number): string {
  const r = h / 2;
  const s = half * 1.75;
  return [
    `M${r} 0 H${x - s}`,
    `C${x - half * 0.9} 0 ${x - half * 0.95} ${depth} ${x} ${depth}`,
    `C${x + half * 0.95} ${depth} ${x + half * 0.9} 0 ${x + s} 0`,
    `H${w - r}`,
    `A${r} ${r} 0 0 1 ${w - r} ${h}`,
    `H${r}`,
    `A${r} ${r} 0 0 1 ${r} 0 Z`,
  ].join(" ");
}

// The same pill with a straight bottom edge (no current page among the links).
function plainPill(w: number, h: number): string {
  const r = h / 2;
  return `M${r} 0 H${w - r} A${r} ${r} 0 0 1 ${w - r} ${h} H${r} A${r} ${r} 0 0 1 ${r} 0 Z`;
}

export default function WaveNav() {
  const pathname = usePathname();
  const { t, locale } = useI18n();
  const navRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const activeIndex = LINKS.findIndex((l) => isActive(pathname, l.href));
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [pose, setPose] = useState<{ x: number; stretch: number } | null>(null);
  const motion = useRef({ x: 0, v: 0, target: 0, frame: 0, placed: false });

  const shellOf = () => navRef.current?.closest<HTMLElement>(".shell") ?? null;

  // Centre of link i, in the header pill's coordinates. The nav is static, so the links'
  // offsetParent is the pill; offsets also ignore its scale-in animation, unlike client rects.
  const centreOf = useCallback((i: number) => {
    const el = tabRefs.current[i];
    return el ? el.offsetLeft + el.offsetWidth / 2 : null;
  }, []);

  const animate = useCallback(() => {
    const m = motion.current;
    cancelAnimationFrame(m.frame);
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      m.v += (210 * (m.target - m.x) - 20 * m.v) * dt;
      m.x += m.v * dt;
      const done = Math.abs(m.target - m.x) < 0.3 && Math.abs(m.v) < 4;
      if (done) { m.x = m.target; m.v = 0; }
      setPose({ x: m.x, stretch: Math.min(Math.abs(m.v) / 2200, 0.5) });
      if (!done) m.frame = requestAnimationFrame(step);
    };
    m.frame = requestAnimationFrame(step);
  }, []);

  const place = useCallback((jump = false) => {
    const shell = shellOf();
    if (!shell) return;
    setBox({ w: shell.clientWidth, h: shell.clientHeight });
    const x = activeIndex >= 0 ? centreOf(activeIndex) : null;
    if (x === null) { setPose(null); return; }
    const m = motion.current;
    m.target = x;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (jump || !m.placed || still) {
      cancelAnimationFrame(m.frame);
      m.x = x; m.v = 0; m.placed = true;
      setPose({ x, stretch: 0 });
    } else {
      animate();
    }
  }, [activeIndex, centreOf, animate]);

  // A new page springs the dip over; a language change moves the links, so it jumps.
  useLayoutEffect(() => { place(); }, [place]);
  useLayoutEffect(() => { place(true); }, [locale]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const shell = shellOf();
    if (!shell || typeof ResizeObserver === "undefined") return;
    // The pill narrows on scroll and with the window; follow it without animating.
    const ro = new ResizeObserver(() => place(true));
    ro.observe(shell);
    const m = motion.current;
    return () => { ro.disconnect(); cancelAnimationFrame(m.frame); };
  }, [place]);

  const active = activeIndex >= 0 ? LINKS[activeIndex] : null;
  const stretch = pose?.stretch ?? 0;

  return (
    <nav ref={navRef} className="wave-nav" aria-label={t.header.mainNav}>
      {box && (
        <svg className="wave-nav-shape" width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`} aria-hidden>
          <path d={pose
            ? pillPath(box.w, box.h, pose.x, HALF * (1 + stretch), DEPTH * (1 - stretch * 0.35))
            : plainPill(box.w, box.h)} />
        </svg>
      )}
      {box && pose && active && (
        <span className="wave-nav-orb" aria-hidden
              style={{
                width: ORB, height: ORB, left: -ORB / 2, top: DEPTH - GAP - ORB,
                transform: `translateX(${pose.x}px) translateY(${-stretch * 6}px)`,
              }}>
          <span key={pathname} className="wave-nav-orb-icon"><Icon name={active.icon} /></span>
        </span>
      )}
      {LINKS.map(({ href, label, icon }, i) => {
        const current = i === activeIndex;
        return (
          <Link key={href} href={href} ref={(el) => { tabRefs.current[i] = el; }}
                className={`wave-nav-tab${current ? " is-active" : ""}`}
                aria-current={current ? "page" : undefined} title={t.nav[label]}>
            <span className="wave-nav-icon"><Icon name={icon} /></span>
            <span className="wave-nav-label">{t.nav[SHORT[label] ?? label]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
