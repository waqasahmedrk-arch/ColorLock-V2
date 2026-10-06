import type { Metadata } from "next";
import { api } from "@/lib/api";
import { getT } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/session";
import ReportView from "./ReportView";
import "./report.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${(await getT()).t.report.title} · ColorLock` };
}

// Printable score report: the whole history (or a name search) with ?q=, one score with ?id=.
// ?print=1 opens the browser's print dialog once it has loaded, for "Save as PDF".
export default async function ReportPage() {
  const [provenance, user] = await Promise.all([api.provenance(), getSessionUser()]);
  return (
    <ReportView
      version={provenance.package_version}
      threshold={provenance.qc.flat_p95_de_max}
      crop={provenance.qc.crop_fraction}
      user={user ? { name: user.name, email: user.email } : null}
    />
  );
}
