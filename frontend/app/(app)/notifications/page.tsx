import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import NotificationsView from "./NotificationsView";
import "./notifications.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).t.meta.notifications };
}

export default async function NotificationsPage() {
  const { t } = await getT();
  return (
    <>
      <h1>{t.notifications.title}</h1>
      <p className="lead">{t.notifications.lead}</p>
      <NotificationsView />
    </>
  );
}
