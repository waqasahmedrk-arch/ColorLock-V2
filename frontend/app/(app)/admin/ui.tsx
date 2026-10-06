"use client";

// Small pieces shared by the admin pages: chips, user cells, device text, toasts, error state.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import type { UserSummary } from "@/lib/admin";
import { RequestError } from "@/lib/chat";
import { describeDevice } from "@/lib/device";
import { translateServer } from "@/lib/i18n";
import { relativeTime } from "@/lib/notificationText";

export function useAdmin() {
  const { t, lang } = useI18n();
  const a = t.admin;
  const ago = useCallback((iso: string | null) => (iso ? relativeTime(iso, lang, a.justNow) : a.never), [lang, a]);
  const date = useCallback((iso: string | null, withTime = false) => {
    if (!iso) return a.never;
    return new Date(iso).toLocaleString(lang, withTime
      ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
      : { day: "numeric", month: "short", year: "numeric" });
  }, [lang, a]);
  // Signed out → sign in again; no longer an admin → back to the site.
  const message = useCallback((e: unknown) => {
    const err = e as RequestError;
    if (err.status === 401) window.location.replace("/login?next=/admin");
    if (err.status === 403) window.location.replace("/");
    return translateServer(t, err.message ?? a.loadError);
  }, [t, a]);
  return { t, a, lang, ago, date, message };
}

export function StatusChips({ user, compact }: { user: UserSummary; compact?: boolean }) {
  const { a } = useAdmin();
  return (
    <span className="adm-chips">
      {user.is_blocked ? (
        <span className="adm-chip is-bad"><Icon name="ban" />{a.status.blocked}</span>
      ) : !user.is_verified ? (
        <span className="adm-chip is-warn"><Icon name="mail" />{a.status.unverified}</span>
      ) : (
        <span className="adm-chip is-ok"><Icon name="check" />{a.status.active}</span>
      )}
      {user.is_admin && <span className="adm-chip is-admin"><Icon name="crown" />{a.status.admin}</span>}
      {!compact && user.online && <span className="adm-chip is-online"><i />{a.status.online}</span>}
    </span>
  );
}

export function UserCell({ user, href }: { user: UserSummary; href?: string }) {
  const body = (
    <>
      <span className="adm-user-avatar">
        <Avatar name={user.name} src={user.avatar_url} size={36} />
        {user.online && <i className="adm-online-dot" aria-hidden />}
      </span>
      <span className="adm-user-text">
        <strong>{user.name}</strong>
        <small>{user.email}</small>
      </span>
    </>
  );
  return href ? <Link href={href} className="adm-user">{body}</Link> : <span className="adm-user">{body}</span>;
}

export function DeviceText({ ua }: { ua: string | null }) {
  const { t, a } = useAdmin();
  const dev = describeDevice(ua);
  return (
    <span className="adm-device" title={ua ?? undefined}>
      <Icon name={dev?.mobile ? "smartphone" : "monitor"} />
      {dev ? t.notifications.on(dev.browser, dev.os) : a.unknownDevice}
    </span>
  );
}

export function useToast() {
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);
  const view = toast && (
    <div key={toast.text} className={`adm-toast${toast.bad ? " is-bad" : ""}`} role="status">
      <Icon name={toast.bad ? "alertCircle" : "check"} /> {toast.text}
    </div>
  );
  return [view, (text: string, bad = false) => setToast({ text, bad })] as const;
}

export function ErrorState({ text, onRetry }: { text?: string; onRetry: () => void }) {
  const { a } = useAdmin();
  return (
    <div className="adm-empty">
      <span className="adm-empty-icon is-bad"><Icon name="alert" /></span>
      <strong>{text ?? a.loadError}</strong>
      <button type="button" className="adm-btn" data-no-loader onClick={onRetry}><Icon name="reset" /> {a.retry}</button>
    </div>
  );
}

export function Empty({ icon, title, text }: { icon: "users" | "message" | "shield" | "check"; title: string; text?: string }) {
  return (
    <div className="adm-empty">
      <span className="adm-empty-icon"><Icon name={icon} /></span>
      <strong>{title}</strong>
      {text && <p className="muted">{text}</p>}
    </div>
  );
}
