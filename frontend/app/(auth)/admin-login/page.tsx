import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import AuthShell from "../_components/AuthShell";
import AdminLoginForm from "./AdminLoginForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).t.meta.admin };
}

// The admin site's sign-in, shown at /login there (proxy.ts rewrites it). Admin accounts only;
// there is no sign-up link.
export default async function AdminLoginPage() {
  const { t } = await getT();
  const c = t.adminLogin;
  return (
    <AuthShell kicker={c.kicker} title={c.title} subtitle={c.subtitle}>
      <AdminLoginForm />
    </AuthShell>
  );
}
