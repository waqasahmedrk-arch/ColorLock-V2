// Server-only: who is signed in, checked against the API with the browser's session cookie.
// The cookie is set by the API on localhost:8000; cookies aren't port-scoped, so the
// Next server on :3000 receives it too.
//
// The two sites have separate sign-ins (lib/appMode.ts): the ColorLock site uses cl_session,
// the admin panel uses cl_admin, so signing in on one never changes the other.

import { cookies } from "next/headers";
import { SERVER_API_BASE } from "@/lib/api";
import { IS_ADMIN_APP } from "@/lib/appMode";
import type { User } from "@/lib/auth";

export const SESSION_COOKIE = IS_ADMIN_APP ? "cl_admin" : "cl_session";
const ME_PATH = IS_ADMIN_APP ? "/admin/auth/me" : "/auth/me";

export async function getSessionUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const res = await fetch(`${SERVER_API_BASE}${ME_PATH}`, {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as User) : null;
  } catch {
    return null;
  }
}
