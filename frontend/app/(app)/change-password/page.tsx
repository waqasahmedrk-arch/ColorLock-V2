import type { Metadata } from "next";
import Link from "next/link";
import Icon from "@/components/Icon";
import { getT } from "@/lib/i18n/server";
import ChangePasswordForm from "./ChangePasswordForm";
import "../../(auth)/auth.css";
import "./change-password.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).t.meta.changePassword };
}

// Signed-in only: the (app) layout sends everyone else to /login.
export default async function ChangePasswordPage() {
  const { t } = await getT();
  const c = t.auth.change;
  return (
    <div className="change-pw">
      <Link href="/profile" className="change-pw-back">
        <Icon name="arrowLeft" /> {c.backToProfile}
      </Link>
      <div className="change-pw-card">
        <h1>{c.title}</h1>
        <p className="muted">{c.subtitle}</p>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
