// Client for the signed-in user's in-app notifications (/notifications). Uses the session cookie.

import { PUBLIC_API_BASE, type Problem } from "@/lib/api";

export type NotificationCategory = "security" | "account" | "activity";

export interface AppNotification {
  id: string;
  kind: string;
  category: NotificationCategory;
  data: Record<string, unknown>;
  link: string | null;
  created_at: string; // ISO 8601, UTC
  read: boolean;
}

export interface NotificationPage {
  items: AppNotification[];
  total: number;
  unread: number;
  offset: number;
  limit: number;
}

export interface NotificationPrefs {
  activity: boolean; // score highlights
  sound: boolean; // chime on new notifications and support replies
}

export class NotificationError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${PUBLIC_API_BASE}/notifications${path}`, {
      method, credentials: "include", cache: "no-store",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new NotificationError(0, "Can't reach the server. Is the API running?");
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const p = json as Problem | null;
    throw new NotificationError(res.status, p?.detail ?? p?.title ?? res.statusText);
  }
  return json as T;
}

export const notifications = {
  list: (offset: number, limit: number, unreadOnly = false) =>
    call<NotificationPage>(`?offset=${offset}&limit=${limit}${unreadOnly ? "&unread_only=true" : ""}`),
  unreadCount: () => call<{ unread: number }>("/unread-count"),
  markRead: (id: string) => call<{ unread: number }>(`/${encodeURIComponent(id)}/read`, "POST"),
  markAllRead: () => call<{ unread: number }>("/read-all", "POST"),
  remove: (id: string) => call<{ unread: number }>(`/${encodeURIComponent(id)}`, "DELETE"),
  clear: () => call<void>("", "DELETE"),
  preferences: () => call<NotificationPrefs>("/preferences"),
  setPreferences: (prefs: Partial<NotificationPrefs>) => call<NotificationPrefs>("/preferences", "PATCH", prefs),
};

// Lets the bell and the Notifications page keep each other's unread count in step.
export const NOTIFICATIONS_CHANGED = "colorlock:notifications-changed";
export function announceUnread(unread: number) {
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED, { detail: { unread } }));
}
