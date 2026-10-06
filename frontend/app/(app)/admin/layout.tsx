import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { IS_ADMIN_APP } from "@/lib/appMode";
import { getT } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/session";
import AdminShell from "./AdminShell";
import "./admin.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).t.meta.admin };
}

// Admins only; the API checks the role again on every call. On the admin site the session is
// the admin panel's own (cl_admin), which only admin accounts can open. The user site
// redirects /admin to the admin site in proxy.ts, so the 404 is only a fallback.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user?.is_admin) {
    if (IS_ADMIN_APP) redirect("/login?next=/admin");
    notFound();
  }
  return <AdminShell user={user}>{children}</AdminShell>;
}
