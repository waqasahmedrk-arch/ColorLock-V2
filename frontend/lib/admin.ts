// Client for the admin panel (/admin). Every call needs an admin session.

import type { OtpSent, User } from "@/lib/auth";
import { photoForm, request, type ChatMessage, type ChatThread } from "@/lib/chat";

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  is_admin: boolean;
  is_blocked: boolean;
  is_verified: boolean;
  online: boolean;
}

export interface UserRow extends UserSummary {
  created_at: string;
  last_login_at: string | null;
  sessions: number;
  scores: number;
}

export interface UserPage {
  items: UserRow[];
  total: number;
  offset: number;
  limit: number;
}

export type LoginReason = "ok" | "bad_password" | "unknown_email" | "unverified" | "blocked" | "not_admin" | "bad_code";

export interface LoginEvent {
  id: number;
  email: string;
  user_id: string | null;
  success: boolean;
  reason: LoginReason;
  scope: "user" | "admin"; // which sign-in form: the ColorLock site or the admin panel
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  admin_email: string;
  action: string;
  target_id: string | null;
  target_email: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface AdminSession {
  id: string;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string;
  user_agent: string | null;
  ip: string | null;
}

export interface UserDetail extends UserRow {
  language: string | null;
  gender: string | null;
  date_of_birth: string | null;
  phone: string | null;
  job_title: string | null;
  verified_at: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
  selfie_at: string | null; // when the admin selfie was taken (first admin sign-in)
  notify_activity: boolean;
  notify_sound: boolean;
  known_devices: number;
  notifications: number;
  messages: number;
  failed_logins_24h: number;
  failed_logins_total: number;
  last_ip: string | null;
  session_list: AdminSession[];
  login_events: LoginEvent[];
  audit: AuditEntry[];
}

export interface DayCount {
  day: string; // YYYY-MM-DD (UTC)
  signups: number;
  logins: number;
  failed: number;
}

export interface Stats {
  users: number;
  verified: number;
  unverified: number;
  blocked: number;
  admins: number;
  online: number;
  active_sessions: number;
  signups_7d: number;
  logins_24h: number;
  failed_24h: number;
  scores: number;
  chat_unread: number;
  chat_waiting: number;
  series: DayCount[];
  recent_users: UserRow[];
  recent_failed: LoginEvent[];
  recent_audit: AuditEntry[];
}

export interface Conversation {
  user: UserSummary;
  last_body: string;
  last_image: boolean; // the last message carries a photo
  last_sender: "user" | "admin";
  last_at: string;
  unread: number;
  total: number;
}

export interface AdminThread extends ChatThread {
  user: UserSummary;
}

export type UserStatus = "all" | "active" | "online" | "blocked" | "admins" | "unverified";
export type UserSort = "newest" | "oldest" | "last_login" | "name";

const id = encodeURIComponent;

// The admin panel's own sign-in (cl_admin cookie), separate from the ColorLock site's.
// Two steps: the password emails a 6-digit code; the code opens the session.
// The emailed code's answer for an admin with no selfie on file: no session yet; the selfie
// (sent with this token) opens it. See backend routers/admin_auth.py.
export interface SelfieRequired {
  selfie_required: true;
  token: string;
  expires_in_s: number;
}

export const adminAuth = {
  login: (email: string, password: string) =>
    request<OtpSent>("/admin/auth/login", "POST", { email, password }),
  verify: (email: string, code: string, remember: boolean) =>
    request<User | SelfieRequired>("/admin/auth/verify", "POST", { email, code, remember }),
  selfie: (email: string, token: string, remember: boolean, image: Blob) => {
    const form = new FormData();
    form.append("email", email);
    form.append("token", token);
    form.append("remember", String(remember));
    form.append("image", image, "selfie.jpg");
    return request<User>("/admin/auth/selfie", "POST", form);
  },
  resend: (email: string) => request<OtpSent>("/admin/auth/resend", "POST", { email }),
  logout: () => request<void>("/admin/auth/logout", "POST"),
  me: () => request<User>("/admin/auth/me"),
};

export const admin = {
  stats: () => request<Stats>("/admin/stats"),
  loginEvents: (failedOnly = false, limit = 50) =>
    request<LoginEvent[]>(`/admin/login-events?limit=${limit}${failedOnly ? "&failed_only=true" : ""}`),
  audit: (limit = 50) => request<AuditEntry[]>(`/admin/audit?limit=${limit}`),
  users: (p: { q?: string; status?: UserStatus; sort?: UserSort; offset?: number; limit?: number }) => {
    const qs = new URLSearchParams({
      q: p.q ?? "", status: p.status ?? "all", sort: p.sort ?? "newest",
      offset: String(p.offset ?? 0), limit: String(p.limit ?? 20),
    });
    return request<UserPage>(`/admin/users?${qs}`);
  },
  user: (userId: string) => request<UserDetail>(`/admin/users/${id(userId)}`),
  block: (userId: string, reason: string) =>
    request<UserDetail>(`/admin/users/${id(userId)}/block`, "POST", { reason: reason || null }),
  unblock: (userId: string) => request<UserDetail>(`/admin/users/${id(userId)}/unblock`, "POST"),
  signOutAll: (userId: string) => request<UserDetail>(`/admin/users/${id(userId)}/sessions`, "DELETE"),
  signOutSession: (userId: string, sessionId: string) =>
    request<UserDetail>(`/admin/users/${id(userId)}/sessions/${id(sessionId)}`, "DELETE"),
  setRole: (userId: string, isAdmin: boolean) =>
    request<UserDetail>(`/admin/users/${id(userId)}/role`, "PATCH", { is_admin: isAdmin }),
  remove: (userId: string) => request<void>(`/admin/users/${id(userId)}`, "DELETE"),
  createAdmin: (name: string, email: string, password: string) =>
    request<UserRow>("/admin/admins", "POST", { name, email, password }),
  conversations: (q = "", unreadOnly = false) =>
    request<{ items: Conversation[]; total: number }>(
      `/admin/chats?q=${id(q)}${unreadOnly ? "&unread_only=true" : ""}`),
  inboxUnread: () => request<{ unread: number; conversations: number }>("/admin/chats/unread"),
  thread: (userId: string, opts: { after?: number; before?: number } = {}) => {
    const q = opts.after !== undefined ? `?after=${opts.after}` : opts.before !== undefined ? `?before=${opts.before}` : "";
    return request<AdminThread>(`/admin/chats/${id(userId)}${q}`);
  },
  reply: (userId: string, body: string, replyTo?: number | null) =>
    request<ChatMessage>(`/admin/chats/${id(userId)}`, "POST", { body, reply_to: replyTo ?? null }),
  replyImage: (userId: string, image: File, caption = "", replyTo?: number | null) =>
    request<ChatMessage>(`/admin/chats/${id(userId)}/image`, "POST", photoForm(image, caption, replyTo)),
  markRead: (userId: string) =>
    request<{ unread: number; conversations: number }>(`/admin/chats/${id(userId)}/read`, "POST"),
};

// Lets the sidebar badge follow reads made on the Messages page.
export const INBOX_CHANGED = "colorlock:inbox-changed";
export function announceInbox() {
  window.dispatchEvent(new CustomEvent(INBOX_CHANGED));
}
