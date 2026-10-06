import type { Metadata } from "next";
import Link from "next/link";
import Icon from "@/components/Icon";
import { api } from "@/lib/api";
import { getT } from "@/lib/i18n/server";
import BatchForm from "./BatchForm";
import "../score.css";
import "./batch.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).t.meta.batch };
}

export default async function BatchPage() {
  const [targets, provenance, { t }] = await Promise.all([api.targets(), api.provenance(), getT()]);
  const b = t.batch;
  return (
    <>
      <header className="score-hero">
        <span className="score-kicker"><Icon name="layers" />{b.kicker}</span>
        <h1>{b.title}</h1>
        <p className="lead">{b.lead(provenance.package_version, provenance.qc.flat_p95_de_max)}</p>
        <p className="score-note"><Icon name="info" />{b.note}</p>
        <Link href="/score" className="batch-switch"><Icon name="arrowLeft" className="back" />{b.single}</Link>
      </header>
      <BatchForm targets={targets} />
    </>
  );
}
