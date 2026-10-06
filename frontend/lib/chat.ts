// Client for the support chat. Users talk to the admin team through /chat; admins answer
// through /admin/chats (lib/admin.ts). Both send the session cookie.

import { PUBLIC_API_BASE, type Problem } from "@/lib/api";

export interface ChatMessage {
  id: number;
  sender: "user" | "admin";
  body: string;
  admin_name: string | null;
  // An attached photo (body may then be ""). The URL is signed and expires; each fetch of the
  // thread signs it again. The size lets the bubble keep its shape while the photo loads.
  image_url?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  reply_to?: ChatReplyRef | null; // the message this one quotes
  created_at: string; // ISO 8601, UTC
  read: boolean; // read by the other side
}

// A quoted message, as the server sends it inside a reply: body is shortened.
export interface ChatReplyRef {
  id: number;
  sender: "user" | "admin";
  admin_name: string | null;
  body: string;
  image_url?: string | null;
}

export function quoteOf(m: ChatMessage): ChatReplyRef {
  return { id: m.id, sender: m.sender, admin_name: m.admin_name, body: m.body, image_url: m.image_url };
}

export interface ChatThread {
  messages: ChatMessage[];
  unread: number;
  has_more: boolean;
}

export class RequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Shared by lib/chat.ts and lib/admin.ts. FormData (photo uploads) goes as multipart.
export async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${PUBLIC_API_BASE}${path}`, {
      method, credentials: "include", cache: "no-store",
      ...(body === undefined ? {} : body instanceof FormData ? { body }
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new RequestError(0, "Can't reach the server. Is the API running?");
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const p = json as (Problem & { errors?: { msg: string }[] }) | null;
    const field = p?.errors?.[0]?.msg?.replace(/^Value error, /, "");
    throw new RequestError(res.status, field ?? p?.detail ?? p?.title ?? res.statusText);
  }
  return json as T;
}

export const chat = {
  thread: (opts: { after?: number; before?: number } = {}) => {
    const q = opts.after !== undefined ? `?after=${opts.after}` : opts.before !== undefined ? `?before=${opts.before}` : "";
    return request<ChatThread>(`/chat${q}`);
  },
  send: (body: string, replyTo?: number | null) =>
    request<ChatMessage>("/chat", "POST", { body, reply_to: replyTo ?? null }),
  sendImage: (image: File, caption = "", replyTo?: number | null) =>
    request<ChatMessage>("/chat/image", "POST", photoForm(image, caption, replyTo)),
  unread: () => request<{ unread: number }>("/chat/unread"),
  markRead: () => request<{ unread: number }>("/chat/read", "POST"),
};

// Photos: what the server accepts (it re-encodes and scales them down).
export const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

export function photoForm(image: File, caption: string, replyTo?: number | null): FormData {
  const form = new FormData();
  form.append("image", image, image.name || "photo");
  form.append("body", caption);
  if (replyTo) form.append("reply_to", String(replyTo));
  return form;
}

// Messages from one sender within this many minutes are drawn as one group.
const GROUP_MS = 5 * 60_000;
export function startsGroup(list: ChatMessage[], i: number): boolean {
  const prev = list[i - 1];
  return !prev || prev.sender !== list[i].sender ||
    new Date(list[i].created_at).getTime() - new Date(prev.created_at).getTime() > GROUP_MS;
}

// Appends polled messages, skipping any already shown (a send and a poll can race).
export function mergeMessages(list: ChatMessage[], more: ChatMessage[]): ChatMessage[] {
  const seen = new Set(list.map((m) => m.id));
  const fresh = more.filter((m) => !seen.has(m.id));
  return fresh.length ? [...list, ...fresh].sort((a, b) => a.id - b.id) : list;
}

export function clockTime(iso: string, lang: string): string {
  return new Date(iso).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
}

export function dayLabel(iso: string, lang: string, today: string, yesterday: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return today;
  if (days === 1) return yesterday;
  return d.toLocaleDateString(lang, { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
