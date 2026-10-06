import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import AuthShell from "../_components/AuthShell";
import LoginForm from "./LoginForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).t.meta.login };
}

export default async function LoginPage() {
  const { t } = await getT();
  const c = t.auth.login;
  return (
    <AuthShell kicker={c.kicker} title={c.title} subtitle={c.subtitle}>
      <LoginForm />
    </AuthShell>
  );
}
