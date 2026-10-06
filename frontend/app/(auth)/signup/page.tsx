import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import AuthShell from "../_components/AuthShell";
import SignupForm from "./SignupForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).t.meta.signup };
}

export default async function SignupPage() {
  const { t } = await getT();
  const c = t.auth.signup;
  return (
    <AuthShell kicker={c.kicker} title={c.title} subtitle={c.subtitle}>
      <SignupForm />
    </AuthShell>
  );
}
