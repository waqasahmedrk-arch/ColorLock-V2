"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import { LINKS, isActive } from "@/components/NavLinks";

// Small screens only (CSS hides it above the breakpoint): the nav links fold into a ☰
// button whose three lines morph into an ×, and open as a panel under the header.
export default function MobileNav() {
  const pathname = usePathname();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close whenever the page changes (a link was followed).
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
    };
    // Growing past the breakpoint (rotating a tablet) closes it too.
    const wide = window.matchMedia("(min-width: 981px)");
    const onWide = () => { if (wide.matches) setOpen(false); };
    document.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("a")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button ref={buttonRef} type="button" className={`nav-burger${open ? " is-open" : ""}`} data-no-loader
              aria-expanded={open} aria-controls="mobile-nav"
              aria-label={open ? t.header.closeMenu : t.header.openMenu}
              onClick={() => setOpen(!open)}>
        <span aria-hidden /><span aria-hidden /><span aria-hidden />
      </button>
      {open && createPortal(
        <div className="mobile-nav-layer">
          <div className="mobile-nav-backdrop" onClick={() => setOpen(false)} />
          <div ref={panelRef} id="mobile-nav" className="mobile-nav">
            <nav aria-label={t.header.openMenu}>
              {LINKS.map(({ href, label, icon }, i) => {
                const current = isActive(pathname, href);
                return (
                  <Link key={href} href={href} aria-current={current ? "page" : undefined}
                        style={{ "--i": i } as React.CSSProperties}
                        onClick={() => { if (current) setOpen(false); }}>
                    <span className="mobile-nav-icon"><Icon name={icon} /></span>
                    <span className="mobile-nav-label">{t.nav[label]}</span>
                    <Icon name="chevronRight" className="mobile-nav-chevron" />
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
