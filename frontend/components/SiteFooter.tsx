"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useI18n } from "@/components/I18nProvider";
import Icon, { type IconName } from "@/components/Icon";

type FooterLink = { href: string; label: string };

// One period of the wave is 1440 units; the path holds two so it can slide by half and loop.
const WAVE = "M0 60C360 0 1080 120 1440 60S2520 0 2880 60V120H0Z";

// Columns rise in once the footer scrolls into view. Without JS nothing is hidden:
// only a footer marked data-armed (by the effect) waits for data-in.
export default function SiteFooter({ signedIn }: { signedIn: boolean }) {
  const { t } = useI18n();
  const f = t.footer;
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.setAttribute("data-in", "");
      return;
    }
    el.setAttribute("data-armed", "");
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.setAttribute("data-in", "");
          io.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const columns: { title: string; links: FooterLink[] }[] = [
    {
      title: f.study,
      links: [
        { href: "/", label: t.nav.results },
        { href: "/images", label: t.nav.images },
        { href: "/provenance", label: t.nav.provenance },
      ],
    },
    {
      title: f.tools,
      links: [
        { href: "/score", label: t.nav.score },
        { href: "/history", label: f.scoreHistory },
      ],
    },
    {
      title: f.account,
      links: signedIn
        ? [
            { href: "/profile", label: f.profile },
            { href: "/change-password", label: f.changePassword },
          ]
        : [
            { href: "/login", label: t.header.signIn },
            { href: "/signup", label: f.createAccount },
            { href: "/forgot-password", label: f.resetPassword },
          ],
    },
  ];

  const quick: { href: string; icon: IconName; label: string }[] = [
    { href: "/score", icon: "pipette", label: t.nav.score },
    { href: "/images", icon: "image", label: t.nav.images },
    { href: "/", icon: "chart", label: t.nav.results },
  ];

  return (
    <footer ref={ref} className="site">
      <div className="footer-wave" aria-hidden>
        <svg viewBox="0 0 2880 120" preserveAspectRatio="none" className="footer-wave-back"><path d={WAVE} /></svg>
        <svg viewBox="0 0 2880 120" preserveAspectRatio="none" className="footer-wave-front"><path d={WAVE} /></svg>
      </div>
      <div className="footer-body">
        <div className="shell">
          <div className="footer-grid">
            {columns.map((col, i) => (
              <nav key={col.title} className="footer-col footer-reveal" aria-label={col.title}
                   style={{ "--i": i } as React.CSSProperties}>
                <h3>{col.title}</h3>
                <ul>
                  {col.links.map((l) => (
                    <li key={l.href}><Link href={l.href}>{l.label}</Link></li>
                  ))}
                </ul>
              </nav>
            ))}
            <div className="footer-quick footer-reveal" style={{ "--i": columns.length } as React.CSSProperties}>
              <h3>{f.quickLinks}</h3>
              <div className="footer-quick-row">
                {quick.map((q) => (
                  <Link key={q.href} href={q.href} className="footer-round" aria-label={q.label} title={q.label}>
                    <Icon name={q.icon} />
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <div className="footer-bottom footer-reveal" style={{ "--i": columns.length + 1 } as React.CSSProperties}>
            <span>{f.rights(new Date().getFullYear())}</span>
            <span className="footer-tagline">{f.tagline}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
