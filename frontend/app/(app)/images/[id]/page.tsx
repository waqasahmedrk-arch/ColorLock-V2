import Link from "next/link";
import { notFound } from "next/navigation";
import Disclosures from "@/components/Disclosures";
import Swatch from "@/components/Swatch";
import { api, ApiError, fmt, modelLabel } from "@/lib/api";
import Icon from "@/components/Icon";
import { dataText } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export default async function ImageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let img;
  try {
    img = await api.image(id);
  } catch (e) {
    if (e instanceof ApiError && e.problem.status === 404) notFound();
    throw e;
  }
  const [targets, provenance, { t }] = await Promise.all([api.targets(), api.provenance(), getT()]);
  const v = t.image;
  const target = targets.find((tg) => tg.id === img.target_id)!;
  const targetName = dataText(t.data.targets, target.id, target.name);
  const threshold = provenance.qc.flat_p95_de_max;
  const g = img.generation;

  return (
    <>
      <p><Link href={`/images?model=${img.model}&target_id=${img.target_id}&style=${img.style}`}><Icon name="arrowLeft" />{v.back}</Link></p>
      <h1>{modelLabel(img.model)} · {targetName} · {img.style} · #{img.slot}</h1>
      <p className="muted mono">{img.image_id}</p>

      <div className="split" style={{ marginTop: 20 }}>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="hero" src={img.image_url} alt={v.generatedAlt(img.image_id)} />
          <div className="compare" style={{ marginTop: 14 }}>
            <figure>
              <Swatch hex={target.hex} large label={`${v.target} ${target.hex}`} />
              <figcaption>{v.target} · {target.hex}</figcaption>
            </figure>
            <figure>
              <Swatch hex={img.sample_hex} large label={`${v.measured} ${img.sample_hex}`} />
              <figcaption>{v.measured} · {img.sample_hex}</figcaption>
            </figure>
          </div>
        </div>

        <div>
          <div className="card">
            <h3><Icon name="ruler" className="lead" />{v.measurements}</h3>
            <dl className="kv">
              <dt>{v.deltaE}</dt><dd><strong>{fmt(img.delta_e00, 2)}</strong></dd>
              <dt>{v.flatness}</dt>
              <dd>
                {fmt(img.flat_p95_de, 3)}{" "}
                <span className={`badge ${img.qc_pass ? "ok" : "bad"}`}><Icon name={img.qc_pass ? "check" : "x"} />{img.qc_pass ? t.images.qcPass : t.images.qcFail}</span>{" "}
                <span className="muted">{v.threshold(threshold)}</span>
              </dd>
              <dt>{v.consistency}</dt>
              <dd>{img.consistency_de00 === null ? <span className="muted">{v.consistencyUndefined}</span> : v.consistencyValue(fmt(img.consistency_de00, 2))}</dd>
              <dt>{v.chroma}</dt>
              <dd>{v.chromaValue(fmt(img.chroma_sample, 1), fmt(img.chroma_reference, 1), `${img.chroma_delta >= 0 ? "+" : ""}${fmt(img.chroma_delta, 1)}`)}</dd>
              <dt>{v.sampleLab}</dt><dd className="mono">{img.sample_lab.map((v) => v.toFixed(2)).join(", ")}</dd>
              <dt>{v.targetLab}</dt><dd className="mono">{target.lab.map((v) => v.toFixed(2)).join(", ")}</dd>
              <dt>{v.keptPct}</dt><dd>{fmt(img.kept_pct, 2)}</dd>
            </dl>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h3><Icon name="cpu" className="lead" />{v.provenance}</h3>
            <dl className="kv">
              <dt>{v.model}</dt><dd className="mono">{String(g.model_id)}</dd>
              <dt>{v.revision}</dt><dd className="mono">{String(g.revision)}</dd>
              <dt>{v.precision}</dt><dd>{String(g.precision)}</dd>
              <dt>{v.seed}</dt><dd>{img.seed_used}</dd>
              <dt>{v.stepsGuidance}</dt><dd>{String(g.steps)} · {String(g.guidance)}</dd>
              <dt>{v.resolution}</dt><dd>{String(g.width)} × {String(g.height)}</dd>
              <dt>{v.generated}</dt><dd>{img.generated_at ?? "—"}</dd>
              <dt>{v.promptHash}</dt><dd className="mono">{img.prompt_hash}</dd>
            </dl>
            <div style={{ marginTop: 12 }}>
              <div className="kicker">{v.prompt}</div>
              <pre className="prompt">{img.prompt}</pre>
            </div>
            {img.negative_prompt && (
              <div style={{ marginTop: 12 }}>
                <div className="kicker">{v.negativePrompt}</div>
                <pre className="prompt">{img.negative_prompt}</pre>
              </div>
            )}
          </div>
        </div>
      </div>

      <Disclosures />
    </>
  );
}
