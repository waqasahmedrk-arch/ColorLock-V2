import Link from "next/link";
import ScoreForm from "./ScoreForm";
import { api } from "@/lib/api";
import { getT } from "@/lib/i18n/server";
import Icon from "@/components/Icon";
import "./score.css";

export default async function ScorePage() {
  const [targets, provenance, { t }] = await Promise.all([api.targets(), api.provenance(), getT()]);
  return (
    <>
      <header className="score-hero">
        <span className="score-kicker"><Icon name="pipette" />{t.score.kicker}</span>
        <h1>{t.score.title}</h1>
        <p className="lead">{t.score.lead(provenance.package_version, provenance.qc.flat_p95_de_max)}</p>
        <p className="score-note"><Icon name="info" />{t.score.note}</p>
        <Link href="/score/batch" className="batch-switch"><Icon name="layers" />{t.batch.batchLink}<Icon name="arrowRight" className="go" /></Link>
      </header>
      <ScoreForm targets={targets} cropFraction={provenance.qc.crop_fraction} />
    </>
  );
}
