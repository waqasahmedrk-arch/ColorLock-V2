import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/session";
import ProfileForm from "./ProfileForm";
import "../../(auth)/auth.css";
import "./profile.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).t.meta.profile };
}

export default async function ProfilePage() {
  const [user, { t }] = await Promise.all([getSessionUser(), getT()]);
  if (!user) redirect("/login?next=/profile");
  return (
    <>
      <h1>{t.profile.title}</h1>
      <p className="lead">{t.profile.lead}</p>
      <ProfileForm user={user} />
    </>
  );
}
