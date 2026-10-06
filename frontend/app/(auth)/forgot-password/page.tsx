import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import AuthShell from "../_components/AuthShell";
import ForgotForm from "./ForgotForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).t.meta.forgot };
}

export default async function ForgotPasswordPage() {
  const { t } = await getT();
  const c = t.auth.forgot;
  return (
    <AuthShell kicker={c.kicker} title={c.title} subtitle={c.subtitle}>
      <ForgotForm />
    </AuthShell>
  );
}
