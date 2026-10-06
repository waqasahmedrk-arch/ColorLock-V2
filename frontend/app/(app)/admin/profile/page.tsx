import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Icon from "@/components/Icon";
import { getT } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/session";
import ProfileForm from "../../profile/ProfileForm";
import "../../../(auth)/auth.css";
import "../../profile/profile.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).t.meta.profile };
}

// The signed-in admin's own profile: the same form as the ColorLock site's /profile, saved
// through the admin session (lib/auth.ts sends it to /admin/auth/me on this site).
export default async function AdminProfilePage() {
  const [user, { t }] = await Promise.all([getSessionUser(), getT()]);
  if (!user) redirect("/login?next=/admin/profile");
  const a = t.admin;
  return (
    <>
      <div className="adm-head">
        <div>
          <p className="adm-eyebrow"><Icon name="crown" /> {a.nav.profile}</p>
          <h1>{t.profile.title}</h1>
          <p className="lead">{a.profileLead}</p>
        </div>
      </div>
      <ProfileForm user={user} />
    </>
  );
}
