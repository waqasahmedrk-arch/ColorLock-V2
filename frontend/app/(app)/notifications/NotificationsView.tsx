"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import { translateServer } from "@/lib/i18n";
import { relativeTime, viewOf } from "@/lib/notificationText";
import {
  NOTIFICATIONS_CHANGED,
  NotificationError,
  announceUnread,
  notifications,
  type AppNotification,
} from "@/lib/notifications";

const PAGE = 20;
const EXIT_MS = 300; // matches the .is-removing animation

type Filter = "all" | "unread";

export default function NotificationsView() {
  const router = useRouter();
  const { t, lang } = useI18n();
  const n = t.notifications;
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<AppNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const fail = useCallback((e: unknown) => {
    const err = e as NotificationError;
    if (err.status === 401) return window.location.replace("/login?next=/notifications");
    setError(translateServer(t, err.message));
  }, [t]);

  const setCount = useCallback((count: number) => {
    setUnread(count);
    announceUnread(count);
  }, []);

  const load = useCallback(async (f: Filter) => {
    try {
      const page = await notifications.list(0, PAGE, f === "unread");
      setItems(page.items);
      setTotal(page.total);
      setCount(page.unread);
      setError(null);
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }, [fail, setCount]);

  useEffect(() => { load(filter); }, [load, filter]);

  // The bell may mark things read (or new ones may arrive) while this page is open.
  useEffect(() => {
    const onChanged = (e: Event) => {
      if (typeof (e as CustomEvent<{ unread?: number }>).detail?.unread !== "number") load(filter);
    };
    window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
  }, [load, filter]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const page = await notifications.list(items.length, PAGE, filter === "unread");
      setItems((prev) => [...prev, ...page.items.filter((r) => !prev.some((p) => p.id === r.id))]);
      setTotal(page.total);
      setCount(page.unread);
    } catch (e) {
      fail(e);
    } finally {
      setLoadingMore(false);
    }
  }

  function chooseFilter(f: Filter) {
    if (f === filter) return;
    setLoading(true);
    setFilter(f);
  }

  async function markRead(item: AppNotification) {
    if (item.read) return;
    setItems((list) => list.map((x) => (x.id === item.id ? { ...x, read: true } : x)));
    try {
      setCount((await notifications.markRead(item.id)).unread);
    } catch (e) {
      fail(e);
    }
  }

  async function open(item: AppNotification) {
    await markRead(item);
    if (item.link) router.push(item.link);
  }

  async function markAll() {
    setItems((list) => list.map((x) => ({ ...x, read: true })));
    try {
      setCount((await notifications.markAllRead()).unread);
      setToast(n.allRead);
      if (filter === "unread") await load("unread");
    } catch (e) {
      fail(e);
    }
  }

  async function remove(item: AppNotification) {
    setRemoving((s) => new Set(s).add(item.id));
    try {
      const r = await notifications.remove(item.id);
      await new Promise((res) => window.setTimeout(res, EXIT_MS));
      setItems((list) => list.filter((x) => x.id !== item.id));
      setTotal((x) => x - 1);
      setCount(r.unread);
    } catch (e) {
      fail(e);
    } finally {
      setRemoving((s) => { const next = new Set(s); next.delete(item.id); return next; });
    }
  }

  async function clearAll() {
    setBusy(true);
    try {
      await notifications.clear();
      setConfirming(false);
      setItems([]);
      setTotal(0);
      setCount(0);
      setToast(n.cleared);
    } catch (e) {
      setConfirming(false);
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="notifs">
      <div className="notifs-toolbar">
        <div className="notifs-tabs" role="tablist" aria-label={n.title}>
          {(["all", "unread"] as const).map((f) => (
            <button key={f} type="button" role="tab" data-no-loader aria-selected={filter === f}
                    className="notifs-tab" onClick={() => chooseFilter(f)}>
              {f === "all" ? n.all : n.unread}
              {f === "unread" && unread > 0 && <span className="notifs-count">{unread}</span>}
            </button>
          ))}
        </div>
        <div className="notifs-actions">
          <button type="button" className="notifs-btn" data-no-loader disabled={!unread} onClick={markAll}>
            <Icon name="checkCheck" /> {n.markAllRead}
          </button>
          {filter === "all" && (
            <button type="button" className="notifs-btn is-danger" data-no-loader
                    disabled={!total} onClick={() => setConfirming(true)}>
              <Icon name="trash" /> {n.clearAll}
            </button>
          )}
          <Link href="/settings#notifications" className="notifs-btn is-icon" title={n.settings} aria-label={n.settings}>
            <Icon name="settings" />
          </Link>
        </div>
      </div>

      {error && <div className="error"><Icon name="alertCircle" className="lead" />{error}</div>}

      {loading ? (
        <div className="notifs-list" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="notifs-row skeleton" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="notifs-empty">
          <span className="notifs-empty-icon"><Icon name="bell" /></span>
          <h2>{filter === "unread" ? n.noUnread : n.empty}</h2>
          {filter === "all" && <p className="muted">{n.emptyText}</p>}
        </div>
      ) : (
        <ul className="notifs-list" key={filter}>
          {items.map((item, i) => {
            const v = viewOf(item, t);
            return (
              <li key={item.id} className={removing.has(item.id) ? "is-removing" : undefined}>
                <article className={`notifs-row${item.read ? "" : " is-unread"}`} data-category={item.category}
                         style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
                  <span className="notifs-icon" aria-hidden><Icon name={v.icon} /></span>
                  <button type="button" className="notifs-main" data-no-loader onClick={() => open(item)}>
                    <span className="notifs-meta">
                      <span className="notifs-category">{n.categories[item.category] ?? item.category}</span>
                      <time dateTime={item.created_at}
                            title={new Date(item.created_at).toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" })}>
                        {relativeTime(item.created_at, lang, n.justNow)}
                      </time>
                    </span>
                    <span className="notifs-title">{v.title}</span>
                    {v.body && <span className="notifs-body">{v.body}</span>}
                  </button>
                  <div className="notifs-row-actions">
                    {!item.read && (
                      <button type="button" className="notifs-icon-btn" data-no-loader title={n.markRead}
                              aria-label={n.markRead} onClick={() => markRead(item)}>
                        <Icon name="check" />
                      </button>
                    )}
                    <button type="button" className="notifs-icon-btn is-danger" data-no-loader title={n.delete}
                            aria-label={n.delete} onClick={() => remove(item)}>
                      <Icon name="x" />
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && items.length < total && (
        <div className="notifs-more">
          <button type="button" className="secondary" data-no-loader onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <Icon name="loader" className="spin" /> : <Icon name="chevronDown" />}
            {n.loadMore}
          </button>
        </div>
      )}

      {confirming && (
        <ConfirmDialog icon="trash" title={n.clearTitle} text={n.clearText} confirmLabel={n.clearAll}
                       busyLabel={n.clearing} busy={busy} onConfirm={clearAll}
                       onCancel={() => setConfirming(false)} />
      )}
      {toast && <div className="notifs-toast" role="status"><Icon name="check" /> {toast}</div>}
    </div>
  );
}
