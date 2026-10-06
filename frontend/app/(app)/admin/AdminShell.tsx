"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { useI18n } from "@/components/I18nProvider";
import Icon, { type IconName } from "@/components/Icon";
import { INBOX_CHANGED, admin } from "@/lib/admin";
import { SITE_URL } from "@/lib/appMode";
import type { User } from "@/lib/auth";
import { installAudioUnlock, playChime } from "@/lib/sound";

const POLL_MS = 15_000;

const LINKS: { href: string; key: "overview" | "users" | "messages" | "admins" | "security" | "profile"; icon: IconName }[] = [
  { href: "/admin", key: "overview", icon: "dashboard" },
  { href: "/admin/users", key: "users", icon: "users" },
  { href: "/admin/messages", key: "messages", icon: "message" },
  { href: "/admin/admins", key: "admins", icon: "crown" },
  { href: "/admin/security", key: "security", icon: "shield" },
  { href: "/admin/profile", key: "profile", icon: "user" },
];

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

// The panel's frame: a sidebar (a scrolling tab row on small screens) with an unread badge on
// Messages. New support messages chime here, on whichever admin page is open.
export default function AdminShell({ user, children }: { user: User; children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const a = t.admin;
  const [unread, setUnread] = useState(0);
  const last = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await admin.inboxUnread();
      if (last.current !== null && r.unread > last.current) playChime("message");
      last.current = r.unread;
      setUnread(r.unread);
    } catch {
      // Keep the last count.
    }
  }, []);

  useEffect(() => {
    installAudioUnlock();
    refresh();
    const id = window.setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    window.addEventListener(INBOX_CHANGED, refresh);
    return () => { window.clearInterval(id); window.removeEventListener(INBOX_CHANGED, refresh); };
  }, [refresh]);

  return (
    <div className="adm">
      <aside className="adm-side">
        <div className="adm-side-head">
          <span className="adm-logo" aria-hidden><Icon name="crown" /></span>
          <span>
            <strong>{a.panel}</strong>
            <small>ColorLock</small>
          </span>
        </div>
        <nav className="adm-nav" aria-label={a.navLabel}>
          {LINKS.map((l, i) => {
            const active = isActive(pathname, l.href);
            return (
              <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}
                    style={{ "--i": i } as React.CSSProperties}>
                <Icon name={l.icon} />
                <span>{a.nav[l.key]}</span>
                {l.key === "messages" && unread > 0 && (
                  <span key={unread} className="adm-nav-badge">{unread > 99 ? "99+" : unread}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="adm-side-foot">
          <Link href="/admin/profile" className="adm-me" title={a.nav.profile}>
            <Avatar name={user.name} src={user.avatar_url} size={34} />
            <span>
              <small>{a.signedInAs}</small>
              <strong>{user.name}</strong>
            </span>
          </Link>
          <Link href={`${SITE_URL}/`} className="adm-back"><Icon name="arrowLeft" /> {a.backToSite}</Link>
        </div>
      </aside>
      <div key={pathname} className="adm-main">{children}</div>
    </div>
  );
}
