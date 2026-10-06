import type { Metadata } from "next";
import Link from "next/link";
import Icon from "@/components/Icon";
import { getT } from "@/lib/i18n/server";
import ChangePasswordForm from "../../change-password/ChangePasswordForm";
import "../../../(auth)/auth.css";
import "../../change-password/change-password.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).t.meta.changePassword };
}

// The admin panel's copy of /change-password; the admin layout has already checked the session.
export default async function AdminChangePasswordPage() {
  const { t } = await getT();
  const c = t.auth.change;
  return (
    <div className="change-pw">
      <Link href="/admin/profile" className="change-pw-back">
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
