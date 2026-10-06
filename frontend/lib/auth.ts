// Client for the /auth endpoints. The session is an HttpOnly cookie set by the API,
// so every call sends credentials; nothing about the session is readable from JS.

import { PUBLIC_API_BASE, type Problem } from "@/lib/api";
import { IS_ADMIN_APP } from "@/lib/appMode";

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  language: "en" | "zh" | null;
  created_at: string;
  // Optional personal details from the Profile page; null when not given.
  gender: Gender | null;
  date_of_birth: string | null; // YYYY-MM-DD
  phone: string | null;
  job_title: string | null;
  // Opens the admin panel (/admin).
  is_admin: boolean;
}

export const GENDERS = ["female", "male", "non_binary", "other", "prefer_not_to_say"] as const;
export type Gender = (typeof GENDERS)[number];

// What the Profile form saves. Empty optional values clear them.
export interface ProfileUpdate {
  name: string;
  gender: Gender | null;
  date_of_birth: string | null;
  phone: string | null;
  job_title: string | null;
}

// One signed-in browser, for the Settings page's device list. Datetimes are ISO 8601 UTC.
export interface LoginSession {
  id: string;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string;
  user_agent: string | null;
  ip: string | null;
  current: boolean;
}

export interface OtpSent {
  email: string;
  expires_in_s: number;
  resend_after_s: number;
}

export class AuthError extends Error {
  constructor(public status: number, public type: string, message: string,
              public fields: Record<string, string> = {}) {
    super(message);
  }
}

// JSON bodies are sent as JSON; FormData (file uploads) as multipart.
// The signed-in account's own profile and password. On the admin site these go through the
// admin panel's session (cl_admin, /admin/auth), so the same forms work on both sites.
const SELF = IS_ADMIN_APP ? "/admin/auth" : "/auth";

async function call<T>(path: string, body?: unknown, method?: string, base = "/auth"): Promise<T> {
  const json = body !== undefined && !(body instanceof FormData);
  let res: Response;
  try {
    res = await fetch(`${PUBLIC_API_BASE}${base}${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      credentials: "include",
      headers: json ? { "Content-Type": "application/json" } : undefined,
      body: body === undefined ? undefined : json ? JSON.stringify(body) : (body as FormData),
    });
  } catch {
    throw new AuthError(0, "network", "Can't reach the server. Is the API running?");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const p = (data ?? { title: res.statusText, status: res.status }) as Problem & {
      errors?: { loc: (string | number)[]; msg: string }[];
    };
    // 422s from pydantic: map "Value error, X" back onto the field it came from.
    const fields: Record<string, string> = {};
    for (const e of p.errors ?? []) {
      const key = String(e.loc[e.loc.length - 1]);
      fields[key] ??= e.msg.replace(/^Value error, /, "");
    }
    const message = Object.values(fields)[0] ?? p.detail ?? p.title;
    throw new AuthError(res.status, p.type ?? "about:blank", message, fields);
  }
  return data as T;
}

export const auth = {
  me: () => call<User>("/me"),
  signup: (name: string, email: string, password: string) =>
    call<OtpSent>("/signup", { name, email, password }),
  verifyEmail: (email: string, code: string, remember = false) =>
    call<User>("/verify-email", { email, code, remember }),
  resendCode: (email: string, purpose: "signup" | "reset") =>
    call<OtpSent>("/resend-code", { email, purpose }),
  login: (email: string, password: string, remember: boolean) =>
    call<User>("/login", { email, password, remember }),
  logout: () => call<void>("/logout", {}),
  forgotPassword: (email: string) => call<OtpSent>("/forgot-password", { email }),
  resetPassword: (email: string, code: string, password: string) =>
    call<void>("/reset-password", { email, code, password }),
  changePassword: (currentPassword: string, newPassword: string) =>
    call<void>("/change-password", { current_password: currentPassword, new_password: newPassword }, "POST", SELF),
  updateProfile: (profile: ProfileUpdate) => call<User>("/me", profile, "PATCH", SELF),
  uploadAvatar: (file: Blob) => {
    const form = new FormData();
    form.append("image", file, "avatar");
    return call<User>("/me/avatar", form, "POST", SELF);
  },
  deleteAvatar: () => call<User>("/me/avatar", undefined, "DELETE", SELF),
  sessions: () => call<LoginSession[]>("/sessions"),
  signOutSession: (id: string) => call<void>(`/sessions/${encodeURIComponent(id)}`, undefined, "DELETE"),
  signOutOthers: () => call<void>("/sessions", undefined, "DELETE"),
  setLanguage: (language: "en" | "zh") => call<User>("/me/preferences", { language }, "PATCH"),
  deleteAccount: (password: string) => call<void>("/me/delete", { password }),
};

// Where to land after signing in: the Results page, or the protected page the user was
// sent away from (?next=). Same-site paths only, so it can't bounce to another origin.
export function afterAuthPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  const ok = next && next.startsWith("/") && !next.startsWith("//") &&
    !["/login", "/signup", "/forgot-password"].some((p) => next.startsWith(p));
  return ok ? next : "/";
}

// A full navigation, not a client-side push: the server layouts re-check the new session
// and the header re-renders with the signed-in user.
// One-time marker for the welcome overlay (components/WelcomeOverlay.tsx) on the next page.
export const WELCOME_KEY = "cl_welcome";
export type WelcomeKind = "login" | "signup";

export function goAfterAuth(kind: WelcomeKind = "login") {
  try {
    sessionStorage.setItem(WELCOME_KEY, kind);
  } catch {
    // Storage blocked (private mode): skip the welcome, still sign in.
  }
  window.location.replace(afterAuthPath());
}

// Which password rule is broken, if any; the form shows it in the current language.
export function passwordProblem(pw: string): "short" | "mix" | null {
  if (pw.length < 8) return "short";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "mix";
  return null;
}

// 0..4, for the strength meter only; the server enforces the real rule above.
export function passwordScore(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return passwordProblem(pw) ? Math.min(s, 1) : Math.max(s, 2);
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
