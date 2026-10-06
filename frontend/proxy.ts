import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_URL, IS_ADMIN_APP, SITE_URL } from "@/lib/appMode";

// Optimistic gate: no session cookie means straight to /login, remembering where the
// user was going. The (app) layout does the real session check against the API.
//
// It also keeps the two sites apart (lib/appMode.ts). The user site sends /admin to the admin
// site. The admin site serves only /admin, its own admin-only sign-in at /login (no sign-up),
// and password reset; everything else goes back to the user site.
const PUBLIC = ["/login", "/signup", "/forgot-password"];
const ADMIN_PUBLIC = ["/login", "/forgot-password"];

const isAdminPath = (p: string) => p === "/admin" || p.startsWith("/admin/");

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (IS_ADMIN_APP) {
    if (pathname === "/") return NextResponse.redirect(new URL("/admin", request.url));
    // Admin accounts are created by admins, never signed up for.
    if (pathname === "/signup") return NextResponse.redirect(new URL("/login", request.url));
    if (!isAdminPath(pathname) && !ADMIN_PUBLIC.includes(pathname) && pathname !== "/admin-login") {
      return NextResponse.redirect(`${SITE_URL}${pathname}${search}`);
    }
    // The admin sign-in form lives at /admin-login; it's shown at /login here.
    if (pathname === "/login") return NextResponse.rewrite(new URL(`/admin-login${search}`, request.url));
    if (pathname === "/admin-login") return NextResponse.redirect(new URL(`/login${search}`, request.url));
    if (ADMIN_PUBLIC.includes(pathname) || request.cookies.has("cl_admin")) return NextResponse.next();
  } else {
    if (isAdminPath(pathname)) return NextResponse.redirect(`${ADMIN_URL}${pathname}${search}`);
    if (pathname === "/admin-login") return NextResponse.redirect(`${ADMIN_URL}/login`);
    if (PUBLIC.includes(pathname) || request.cookies.has("cl_session")) return NextResponse.next();
  }

  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // Pages only: skip Next internals and files with an extension.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
