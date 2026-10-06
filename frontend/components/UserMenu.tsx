"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { useI18n } from "@/components/I18nProvider";
import Icon, { type IconName } from "@/components/Icon";
import SignOutDialog from "@/components/SignOutDialog";
import { adminAuth } from "@/lib/admin";
import { ADMIN_URL, IS_ADMIN_APP, SITE_URL } from "@/lib/appMode";
import { auth, type User } from "@/lib/auth";

// Header account control. `user` comes from the root layout's server-side session check:
// signed out shows a Sign in / Sign up link, signed in shows an avatar with a menu.
const CLOSE_MS = 160; // matches .user-pop.is-closing

export default function UserMenu({ user }: { user: User | null }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Plays the closing animation, then unmounts; `refocus` returns focus to the avatar (keyboard).
  const close = useCallback((refocus = false) => {
    setClosing(true);
    window.setTimeout(() => { setOpen(false); setClosing(false); }, CLOSE_MS);
    if (refocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const items = () => [...(popRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    // Arrow keys / Home / End move between items; Escape closes back to the avatar.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(true); return; }
      if (e.key === "Tab") { close(); return; }
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const go = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 }[e.key];
      if (go === undefined || !list.length) return;
      e.preventDefault();
      list[(go + list.length) % list.length]?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // Page changes close the menu.
  useEffect(() => { setOpen(false); setClosing(false); }, [pathname]);

  async function signOut() {
    setLeaving(true);
    // Each site has its own sign-in; this signs out of this one only.
    await (IS_ADMIN_APP ? adminAuth.logout() : auth.logout()).catch(() => undefined);
    // Full navigation so the server layouts see the cleared cookie.
    window.location.replace("/login");
  }

  if (!user) {
    const toSignup = pathname === "/login";
    return (
      <Link href={toSignup ? "/signup" : "/login"} className="user-signin">
        <Icon name={toSignup ? "user" : "logIn"} />
        {toSignup ? t.header.signUp : t.header.signIn}
      </Link>
    );
  }

  const h = t.header;
  // The admin panel is its own site (lib/appMode.ts); links between the two are absolute.
  const links: { href: string; icon: IconName; label: string; hint: string; admin?: boolean }[] = IS_ADMIN_APP ? [
    { href: "/admin/admins", icon: "crown", label: t.admin.nav.admins, hint: t.admin.adminsHint },
    { href: `${SITE_URL}/`, icon: "globe", label: h.openSite, hint: h.openSiteHint },
  ] : [
    ...(user.is_admin ? [{ href: `${ADMIN_URL}/admin`, icon: "dashboard" as const, label: h.adminPanel, hint: h.adminHint, admin: true }] : []),
    { href: "/profile", icon: "user", label: h.yourProfile, hint: h.profileHint },
    { href: "/settings", icon: "settings", label: h.settings, hint: h.settingsHint },
    { href: "/docs", icon: "book", label: h.docs, hint: h.docsHint },
  ];

  function toggle() {
    if (open) close();
    else setOpen(true);
  }

  return (
    <div className="user-menu" ref={ref}>
      <button ref={buttonRef} type="button" className="user-avatar" data-no-loader aria-haspopup="menu"
              aria-expanded={open && !closing} aria-controls="user-pop" onClick={toggle}
              onKeyDown={(e) => {
                // Opening from the keyboard lands on the first item.
                if ((e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") && !open) {
                  e.preventDefault();
                  setOpen(true);
                  requestAnimationFrame(() => popRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus());
                }
              }}
              title={`${user.email} · ${h.online}`}>
        <Avatar name={user.name} src={user.avatar_url} />
        <span className="user-status" aria-hidden />
      </button>
      {open && (
        <div ref={popRef} id="user-pop" className={`user-pop${closing ? " is-closing" : ""}`} role="menu"
             aria-label={user.name}>
          <div className="user-pop-head">
            <span className="user-pop-avatar">
              <Avatar name={user.name} src={user.avatar_url} size={44} />
              <i aria-hidden />
            </span>
            <div className="user-pop-who">
              <strong>{user.name}</strong>
              <span>{user.email}</span>
              <span className="user-pop-tags">
                <span className="user-pop-online">{h.online}</span>
                {user.is_admin && <span className="user-pop-job user-pop-admin"><Icon name="crown" /> {t.admin.badge}</span>}
                {user.job_title && <span className="user-pop-job"><Icon name="briefcase" /> {user.job_title}</span>}
              </span>
            </div>
          </div>
          <div className="user-pop-list">
            {links.map((l, i) => (
              <Link key={l.href} href={l.href} role="menuitem" className="user-pop-item"
                    aria-current={pathname === l.href ? "page" : undefined}
                    data-admin={l.admin ? "" : undefined}
                    style={{ "--i": i } as React.CSSProperties} onClick={() => close()}>
                <span className="user-pop-icon" aria-hidden><Icon name={l.icon} /></span>
                <span className="user-pop-text"><span>{l.label}</span><small>{l.hint}</small></span>
                <Icon name="chevronRight" className="user-pop-chevron" />
              </Link>
            ))}
          </div>
          <div className="user-pop-foot">
            <button type="button" role="menuitem" className="user-pop-item is-danger" data-no-loader
                    style={{ "--i": links.length } as React.CSSProperties}
                    onClick={() => { close(); setConfirming(true); }}>
              <span className="user-pop-icon" aria-hidden><Icon name="logOut" /></span>
              <span className="user-pop-text"><span>{h.signOut}</span></span>
            </button>
          </div>
        </div>
      )}
      {confirming && (
        <SignOutDialog user={user} busy={leaving} onConfirm={signOut}
                       onCancel={() => setConfirming(false)} />
      )}
    </div>
  );
}
