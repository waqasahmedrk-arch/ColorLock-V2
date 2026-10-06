import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import HistoryView from "./HistoryView";
import "./history.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).t.meta.history };
}

export default async function HistoryPage() {
  const { t } = await getT();
  return (
    <>
      <h1>{t.history.title}</h1>
      <p className="lead">{t.history.lead}</p>
      <HistoryView />
    </>
  );
}
