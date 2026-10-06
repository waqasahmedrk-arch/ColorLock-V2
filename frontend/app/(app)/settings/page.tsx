import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/session";
import SettingsView from "./SettingsView";
import "../../(auth)/auth.css";
import "./settings.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).t.meta.settings };
}

export default async function SettingsPage() {
  const [user, { t }] = await Promise.all([getSessionUser(), getT()]);
  if (!user) redirect("/login?next=/settings");
  return (
    <>
      <h1>{t.settings.title}</h1>
      <p className="lead">{t.settings.lead}</p>
      <SettingsView />
    </>
  );
}
