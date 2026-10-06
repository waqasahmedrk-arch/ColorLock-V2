"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import { relativeTime, viewOf } from "@/lib/notificationText";
import { NOTIFICATIONS_CHANGED, announceUnread, notifications, type AppNotification } from "@/lib/notifications";
import { SOUND_CHANGED, installAudioUnlock, playChime, setSoundEnabled, soundEnabled } from "@/lib/sound";

const POLL_MS = 30_000;
const PREVIEW = 8;

// Navbar bell: unread badge (polled while the tab is visible) and a dropdown with the newest
// notifications. The full list lives on /notifications. A rising count also plays the
// notification sound, unless the user switched it off (here or in Settings).
export default function NotificationBell() {
  const router = useRouter();
  const pathname = usePathname();
  const { t, lang } = useI18n();
  const n = t.notifications;
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [ring, setRing] = useState(0);
  const [sound, setSound] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<number | null>(null);

  // A rising count (not the first load) rings the bell once, with a chime.
  const applyCount = useCallback((count: number) => {
    if (last.current !== null && count > last.current) {
      setRing((r) => r + 1);
      playChime("notification");
    }
    last.current = count;
    setUnread(count);
  }, []);

  const refreshCount = useCallback(async () => {
    try {
      applyCount((await notifications.unreadCount()).unread);
    } catch {
      // Signed out or API down: the badge just stays as it was.
    }
  }, [applyCount]);

  const loadPreview = useCallback(async () => {
    try {
      const page = await notifications.list(0, PREVIEW);
      setItems(page.items);
      applyCount(page.unread);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [applyCount]);

  // The sound switch lives on the account; mirror it into lib/sound for every component.
  useEffect(() => {
    installAudioUnlock();
    setSound(soundEnabled());
    notifications.preferences().then((p) => setSoundEnabled(p.sound)).catch(() => undefined);
    const onSound = (e: Event) => setSound((e as CustomEvent<{ on: boolean }>).detail.on);
    window.addEventListener(SOUND_CHANGED, onSound);
    return () => window.removeEventListener(SOUND_CHANGED, onSound);
  }, []);

  async function toggleSound() {
    const next = !sound;
    setSoundEnabled(next);
    if (next) playChime("notification", true);
    try {
      setSoundEnabled((await notifications.setPreferences({ sound: next })).sound);
    } catch {
      setSoundEnabled(!next);
    }
  }

  useEffect(() => {
    refreshCount();
    const id = window.setInterval(() => { if (!document.hidden) refreshCount(); }, POLL_MS);
    const onVisible = () => { if (!document.hidden) refreshCount(); };
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ unread?: number }>).detail;
      if (typeof detail?.unread === "number") { last.current = detail.unread; setUnread(detail.unread); }
      else refreshCount();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
    };
  }, [refreshCount]);

  // Page changes close the dropdown and re-check the count (an action may have created one).
  useEffect(() => { setOpen(false); refreshCount(); }, [pathname, refreshCount]);

  useEffect(() => {
    if (!open) return;
    loadPreview();
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open, loadPreview]);

  async function openItem(item: AppNotification) {
    setOpen(false);
    if (!item.read) {
      setItems((list) => list?.map((x) => (x.id === item.id ? { ...x, read: true } : x)) ?? null);
      notifications.markRead(item.id).then((r) => { applyCount(r.unread); announceUnread(r.unread); }).catch(() => undefined);
    }
    if (item.link) router.push(item.link);
  }

  async function markAll() {
    setItems((list) => list?.map((x) => ({ ...x, read: true })) ?? null);
    try {
      const r = await notifications.markAllRead();
      applyCount(r.unread);
      announceUnread(r.unread);
    } catch {
      loadPreview();
    }
  }

  const label = unread ? n.bellUnread(unread) : n.bell;

  return (
    <div className="notif" ref={ref}>
      <button type="button" className={`notif-bell${open ? " is-open" : ""}`} data-no-loader
              aria-haspopup="dialog" aria-expanded={open} aria-label={label} title={label}
              onClick={() => setOpen(!open)}>
        <span key={ring} className={ring ? "notif-bell-icon is-ringing" : "notif-bell-icon"}><Icon name="bell" /></span>
        {unread > 0 && <span key={`b${unread}`} className="notif-badge" aria-hidden>{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <div className="notif-pop" role="dialog" aria-label={n.title}>
          <div className="notif-pop-head">
            <strong>{n.title}</strong>
            <span className="notif-pop-tools">
              {unread > 0 && (
                <button type="button" className="notif-text-btn" data-no-loader onClick={markAll}>
                  <Icon name="checkCheck" /> {n.markAllRead}
                </button>
              )}
              <button type="button" className={`notif-sound${sound ? " is-on" : ""}`} data-no-loader
                      role="switch" aria-checked={sound} title={sound ? n.soundOn : n.soundOff}
                      aria-label={sound ? n.soundOn : n.soundOff} onClick={toggleSound}>
                <Icon key={String(sound)} name={sound ? "volume" : "volumeOff"} />
              </button>
            </span>
          </div>

          <div className="notif-pop-body">
            {items === null && !failed && (
              <div className="notif-skeleton" aria-busy="true"><i /><i /><i /></div>
            )}
            {failed && (
              <div className="notif-pop-empty">
                <p className="muted">{n.loadError}</p>
                <button type="button" className="notif-text-btn" data-no-loader onClick={loadPreview}>
                  <Icon name="reset" /> {n.retry}
                </button>
              </div>
            )}
            {items && items.length === 0 && (
              <div className="notif-pop-empty">
                <span className="notif-empty-icon"><Icon name="bell" /></span>
                <strong>{n.empty}</strong>
                <p className="muted">{n.emptyText}</p>
              </div>
            )}
            {items && items.length > 0 && (
              <ul className="notif-list">
                {items.map((item, i) => {
                  const v = viewOf(item, t);
                  return (
                    <li key={item.id} style={{ "--i": i } as React.CSSProperties}>
                      <button type="button" className={`notif-item${item.read ? "" : " is-unread"}`} data-no-loader
                              data-category={item.category} onClick={() => openItem(item)}>
                        <span className="notif-item-icon" aria-hidden><Icon name={v.icon} /></span>
                        <span className="notif-item-text">
                          <span className="notif-item-title">{v.title}</span>
                          {v.body && <span className="notif-item-body">{v.body}</span>}
                          <time className="notif-item-time" dateTime={item.created_at}>
                            {relativeTime(item.created_at, lang, n.justNow)}
                          </time>
                        </span>
                        {!item.read && <span className="notif-dot" aria-hidden />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="notif-pop-foot">
            <Link href="/notifications" onClick={() => setOpen(false)}>
              {n.viewAll} <Icon name="arrowRight" />
            </Link>
            <Link href="/settings#notifications" className="notif-settings-link" title={n.settings}
                  aria-label={n.settings} onClick={() => setOpen(false)}>
              <Icon name="settings" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
