import CopyButton from "@/components/CopyButton";
import Disclosures from "@/components/Disclosures";
import Reveal from "@/components/Reveal";
import { api, MODELS, type ModelKey } from "@/lib/api";
import Icon from "@/components/Icon";
import { getT } from "@/lib/i18n/server";
import "./provenance.css";

const vars = (v: Record<string, string | number>) => v as React.CSSProperties;

const MODEL_ICON: Record<ModelKey, "cpu" | "monitor"> = { flux: "cpu", sdxl: "monitor" };

// "20260913T083658Z" -> "2026-09-13 08:36:58 UTC"; anything else is shown as given.
function runDate(run: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(run);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]} UTC` : null;
}

export default async function ProvenancePage() {
  const [p, { t }] = await Promise.all([api.provenance(), getT()]);
  const v = t.provenance;
  const cropPct = p.qc.crop_fraction * 100;
  const commitKnown = p.git_commit && p.git_commit !== "unknown";
  const date = runDate(p.study_run);

  const steps = [
    { icon: "file", label: v.pipeline.prompt },
    { icon: "cpu", label: v.pipeline.model },
    { icon: "image", label: v.pipeline.image },
    { icon: "ruler", label: v.pipeline.measure },
    { icon: "chart", label: v.pipeline.score },
  ] as const;

  return (
    <div className="prov-page">
      <section className="page-hero">
        <div className="hero-glow" aria-hidden="true">
          {["#4169E1", "#228B22", "#DAA520", "#DC143C"].map((c, i) => <i key={c} style={vars({ "--c": c, "--i": i })} />)}
        </div>
        <div className="hero-eyebrow"><span className="hero-dot" />{v.eyebrow}</div>
        <h1>{v.title}</h1>
        <p className="lead">{v.lead(<code>colourlock</code>)}</p>

        <ol className="pipeline" aria-label={v.eyebrow}>
          {steps.map((s, i) => (
            <li key={s.label} style={vars({ "--i": i })}>
              <span className="pipe-node"><Icon name={s.icon} /></span>
              <span className="pipe-label">{s.label}</span>
            </li>
          ))}
        </ol>
      </section>

      <h2 className="prov-title"><Icon name="cpu" className="lead" />{v.modelsTitle}</h2>
      <Reveal className="prov-models">
        {MODELS.map((m, i) => {
          const c = p.models[m.key];
          const hf = `https://huggingface.co/${c.repo_id}/tree/${c.revision}`;
          return (
            <article className={`prov-card model-${m.key} reveal-item`} key={m.key} style={vars({ "--i": i })}>
              <header className="prov-card-head">
                <span className="prov-icon"><Icon name={MODEL_ICON[m.key]} /></span>
                <div>
                  <h3>{m.label}</h3>
                  <a className="prov-repo mono" href={hf} target="_blank" rel="noopener noreferrer" title={v.viewOnHf}>
                    {c.repo_id}<Icon name="arrowRight" />
                  </a>
                </div>
                <span className="badge ok prov-pin"><Icon name="lock" />{v.pinned}</span>
              </header>

              <div className="prov-sha">
                <span className="prov-sha-label">{v.revision}</span>
                <code className="prov-sha-value" title={c.revision}>
                  <b>{c.revision.slice(0, 7)}</b>{c.revision.slice(7)}
                </code>
                <CopyButton value={c.revision} />
              </div>

              <dl className="prov-specs">
                <div><dt>{v.precision}</dt><dd className="mono">{c.precision}</dd></div>
                <div><dt>{v.steps}</dt><dd>{c.steps}</dd></div>
                <div><dt>{v.guidance}</dt><dd>{c.guidance}</dd></div>
                <div><dt>{v.resolution}</dt><dd>{c.resolution}<span className="muted">²</span></dd></div>
              </dl>
            </article>
          );
        })}
      </Reveal>

      <h2 className="prov-title"><Icon name="ruler" className="lead" />{v.measurementTitle}</h2>
      <Reveal className="prov-measure">
        <article className="prov-card reveal-item" style={vars({ "--i": 0 })}>
          <dl className="prov-list">
            <div><dt><Icon name="badgeCheck" />{v.package}</dt><dd>colourlock <span className="mono">{p.package_version}</span></dd></div>
            <div><dt><Icon name="key" />{v.commit}</dt><dd className="mono">{commitKnown ? p.git_commit : <span className="muted">{v.unknown}</span>}</dd></div>
            <div>
              <dt><Icon name="calendar" />{v.studyRun}</dt>
              <dd><span className="mono">{p.study_run}</span>{date && <span className="muted prov-date">{date}</span>}</dd>
            </div>
            <div><dt><Icon name="shield" />{v.qcThreshold}</dt><dd><code>flat_p95_de ≤ {p.qc.flat_p95_de_max}</code></dd></div>
            <div><dt><Icon name="chart" />{v.percentile}</dt><dd>{v.percentileValue(p.qc.percentile)}</dd></div>
            <div><dt><Icon name="filter" />{v.stride}</dt><dd>{v.strideValue(p.qc.stride)}</dd></div>
          </dl>
        </article>

        <figure className="prov-card prov-crop reveal-item" style={vars({ "--i": 1, "--crop": `${cropPct}%` })}>
          <div className="crop-frame" aria-hidden="true">
            <div className="crop-image" />
            <div className="crop-window"><span>{cropPct}%</span><i className="crop-scan" /></div>
          </div>
          <figcaption>
            <strong>{v.crop}</strong>
            <span className="muted">{v.cropValue(cropPct)}</span>
            <span className="muted">{v.cropCaption(cropPct)}</span>
          </figcaption>
        </figure>
      </Reveal>

      <Disclosures open />
    </div>
  );
}
