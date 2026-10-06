import Link from "next/link";
import CountUp from "@/components/CountUp";
import Disclosures from "@/components/Disclosures";
import Reveal from "@/components/Reveal";
import Swatch from "@/components/Swatch";
import { api, fmt, fmtP, MODELS, modelLabel, type Hypothesis, type ModelKey, type StudyGroup } from "@/lib/api";
import Icon from "@/components/Icon";
import { dataText, type Dict } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import "./results.css";

const STAT_SYMBOL: Record<string, string> = {
  spearman_rho: "ρ",
  wilcoxon_signed_rank: "W",
  levene_kruskal: "H",
};

const TONE_ICON = { ok: "check", bad: "x", warn: "alert" } as const;

type Verdict = { label: string; text: string; tone: "ok" | "bad" | "warn" };

// Per-element stagger index (and other custom properties) for the CSS animations.
const vars = (v: Record<string, string | number>) => v as React.CSSProperties;

function verdict(h: Hypothesis, t: Dict): Verdict {
  const v = t.results.verdict;
  if (h.direction === "insufficient") return { label: v.untested, text: v.untestedText, tone: "warn" };
  if (h.id === "H1")
    return h.direction === "decoupled"
      ? { label: v.consistent, text: v.h1Decoupled, tone: "ok" }
      : { label: v.notSupported, text: v.h1Coupled, tone: "bad" };
  if (h.id === "H2")
    return h.direction === "desaturated"
      ? { label: v.supported, text: v.h2Desat, tone: "ok" }
      : { label: v.notSupported, text: v.h2None, tone: "bad" };
  if (h.direction.startsWith("significant_tightest=")) {
    const style = h.direction.split("=")[1];
    return { label: v.partial, text: v.h3Tightest(style), tone: "warn" };
  }
  return { label: v.notSupported, text: v.h3None, tone: "bad" };
}

function HypothesisCard({ h, t, i }: { h: Hypothesis; t: Dict; i: number }) {
  const v = verdict(h, t);
  const pm = h.extra.per_model;
  return (
    <div className={`card hyp tone-${v.tone} reveal-item`} style={vars({ "--i": i })}>
      <div className="hyp-head">
        <span className="hyp-id"><Icon name="flask" />{h.id}</span>
        <span className={`badge ${v.tone}`}><Icon name={TONE_ICON[v.tone]} />{v.label}</span>
      </div>
      <h3>{dataText(t.data.hypotheses, h.id, h.name)}</h3>
      <div className="stat">
        {STAT_SYMBOL[h.test] ?? "stat"} = {fmt(h.statistic, h.test === "spearman_rho" ? 3 : 2)}
        <span className="muted hyp-p"> · {fmtP(h.p_value)}</span>
      </div>
      <p className="hyp-text">{v.text}</p>
      <div className="hyp-foot muted">
        <p>{t.results.test} <code>{h.test}</code>. {h.notes}</p>
        {pm && (
          <p>
            {t.results.sample(pm.flux.n_images_qc_pass, pm.sdxl.n_images_qc_pass,
                              pm.flux.n_groups_ge_10, pm.sdxl.n_groups_ge_10)}
          </p>
        )}
      </div>
    </div>
  );
}

function ResultCell({ g, t, hex, max }: { g: StudyGroup | undefined; t: Dict; hex: string; max: number }) {
  if (!g) return <td><span className="cell empty">—</span></td>;
  const href = `/images?model=${g.model}&target_id=${g.target_id}&style=${g.style}`;
  const cls = g.n_qc_pass === 0 ? "cell low-n empty" : g.low_n ? "cell low-n" : "cell";
  const pct = g.accuracy_mean !== null && max > 0 ? Math.max(4, (g.accuracy_mean / max) * 100) : 0;
  return (
    <td>
      <Link href={href} className={cls} title={g.low_n ? t.results.lowNTitle : undefined}>
        {g.n_qc_pass === 0 ? (
          <span className="acc">{t.results.noPass}</span>
        ) : (
          <>
            <span className="acc">{fmt(g.accuracy_mean, 1)}</span>
            <span className="sub"> ΔE00</span>
            <span className="cell-bar" aria-hidden="true">
              <i style={{ width: `${pct}%`, background: hex }} />
            </span>
            <div className="sub">{t.results.consistency} {fmt(g.consistency_mean, 1)}</div>
          </>
        )}
        <div className="sub">
          {t.results.passedQc(g.n_qc_pass, g.n)} {g.low_n && g.n_qc_pass > 0 && <span className="badge warn"><Icon name="alert" />{t.results.lowN}</span>}
        </div>
      </Link>
    </td>
  );
}

export default async function ResultsPage({ searchParams }: { searchParams: Promise<{ model?: string }> }) {
  const { model: rawModel } = await searchParams;
  const model: ModelKey = rawModel === "sdxl" ? "sdxl" : "flux";
  const [hypotheses, allGroups, targets, styles, { t }] = await Promise.all([
    api.hypotheses(),
    api.summary(),
    api.targets(),
    api.promptStyles(),
    getT(),
  ]);
  const r = t.results;
  const groups = allGroups.filter((g) => g.model === model);
  const byKey = new Map(groups.map((g) => [`${g.target_id}|${g.style}`, g]));
  const passed = groups.reduce((s, g) => s + g.n_qc_pass, 0);
  const total = groups.reduce((s, g) => s + g.n, 0);
  const maxAcc = Math.max(0, ...groups.map((g) => g.accuracy_mean ?? 0));

  // Study-wide headline numbers across both models. "Closest" only considers cells with n >= 10.
  const studyTotal = allGroups.reduce((s, g) => s + g.n, 0);
  const studyPassed = allGroups.reduce((s, g) => s + g.n_qc_pass, 0);
  const reliable = allGroups.filter((g) => !g.low_n && g.n_qc_pass > 0 && g.accuracy_mean !== null);
  const best = reliable.reduce<StudyGroup | null>((b, g) => (!b || g.accuracy_mean! < b.accuracy_mean! ? g : b), null);
  const bestTarget = best && targets.find((tg) => tg.id === best.target_id);
  const bestStyle = best && styles.find((s) => s.id === best.style);

  return (
    <div className="results-page">
      <section className="page-hero">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-glow" aria-hidden="true">
          {targets.slice(0, 4).map((tg, i) => <i key={tg.id} style={vars({ "--c": tg.hex, "--i": i })} />)}
        </div>
        <div className="hero-eyebrow"><span className="hero-dot" />{r.eyebrow}</div>
        <h1>{r.title}</h1>
        <p className="lead">{r.lead}</p>
        {targets.length > 0 && (
          <div className="hero-spectrum" aria-hidden="true">
            {targets.map((tg, i) => <i key={tg.id} style={vars({ background: tg.hex, "--i": i })} />)}
          </div>
        )}
      </section>

      {studyTotal > 0 && (
        <Reveal className="kpis">
          <div className="kpi reveal-item" style={vars({ "--i": 0 })}>
            <span className="kpi-icon"><Icon name="image" /></span>
            <div className="kpi-value"><CountUp value={studyTotal} /></div>
            <div className="kpi-label">{r.kpiImages}</div>
          </div>
          <div className="kpi reveal-item" style={vars({ "--i": 1 })}>
            <span className="kpi-icon"><Icon name="shield" /></span>
            <div className="kpi-value"><CountUp value={(studyPassed / studyTotal) * 100} digits={1} />%</div>
            <div className="kpi-label">{r.kpiPassed} · {studyPassed.toLocaleString("en-US")}</div>
          </div>
          <div className="kpi reveal-item" style={vars({ "--i": 2 })}>
            <span className="kpi-icon"><Icon name="ruler" /></span>
            {best ? (
              <>
                <div className="kpi-value"><CountUp value={best.accuracy_mean!} digits={2} /></div>
                <div className="kpi-label">
                  {r.kpiBest}
                  <span className="kpi-sub">
                    {bestTarget && <Swatch hex={bestTarget.hex} />}
                    {modelLabel(best.model)} · {bestTarget ? dataText(t.data.targets, bestTarget.id, bestTarget.name) : best.target_id} · {bestStyle?.code ?? best.style}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="kpi-value">—</div>
                <div className="kpi-label">{r.kpiBest}<span className="kpi-sub">{r.kpiBestNone}</span></div>
              </>
            )}
          </div>
          <div className="kpi reveal-item" style={vars({ "--i": 3 })}>
            <span className="kpi-icon"><Icon name="chart" /></span>
            <div className="kpi-value"><CountUp value={reliable.length} /></div>
            <div className="kpi-label">{r.kpiReliable} · {r.kpiOf(allGroups.length)}</div>
          </div>
        </Reveal>
      )}

      <Reveal className="section-head">
        <h2 className="section-title reveal-item"><span className="section-icon"><Icon name="flask" /></span>{r.hypothesesTitle}</h2>
      </Reveal>
      <Reveal className="grid-3">
        {hypotheses.map((h, i) => <HypothesisCard key={h.id} h={h} t={t} i={i} />)}
      </Reveal>

      <Reveal className="results-bar section-head">
        <h2 className="section-title reveal-item"><span className="section-icon"><Icon name="chart" /></span>{r.byColourTitle}</h2>
        <span className="seg reveal-item" data-active={model} style={vars({ "--i": 1 })}>
          <span className="seg-thumb" aria-hidden="true" />
          {MODELS.map((m) => (
            <Link key={m.key} href={`/?model=${m.key}`} scroll={false}
                  aria-current={m.key === model ? "page" : undefined}>
              <Icon name="cpu" />{m.label}
            </Link>
          ))}
        </span>
      </Reveal>
      {total === 0 ? (
        <div className="callout">
          <Icon name="alert" className="lead" />
          <strong>{r.noData}</strong> {r.noDataText(<code>scripts/import_study.py</code>)}
        </div>
      ) : (
        <div className="qc-summary" key={`qc-${model}`}>
          <p className="muted">
            {r.passedSummary(modelLabel(model), passed, total, ((passed / total) * 100).toFixed(1))}
          </p>
          <div className="qc-meter" aria-hidden="true"><i style={{ width: `${(passed / total) * 100}%` }} /></div>
        </div>
      )}
      {model === "sdxl" && (
        <div className="callout callout-in">
          <Icon name="alert" className="lead" />
          <strong>{r.sdxlTitle}</strong> {r.sdxlText}
        </div>
      )}
      <div className="table-wrap results-table" key={`table-${model}`}>
        <table className="results">
          <thead>
            <tr>
              <th>{r.target}</th>
              {styles.map((s) => (
                <th key={s.id} title={dataText(t.data.styles, s.id, s.description)}>
                  <span className="style-code">{s.code}</span> {dataText(t.data.styles, s.id, s.description)}
                </th>
              ))}
            </tr>
          </thead>
          <Reveal as="tbody">
            {targets.map((tg, i) => (
              <tr key={tg.id} className="reveal-item" style={vars({ "--i": i })}>
                <th scope="row">
                  <Swatch hex={tg.hex} label={`${dataText(t.data.targets, tg.id, tg.name)} ${tg.hex}`} />
                  {dataText(t.data.targets, tg.id, tg.name)}
                  <div className="sub muted mono" style={{ fontSize: "0.75rem", paddingLeft: 22 }}>{tg.hex}</div>
                </th>
                {styles.map((s) => <ResultCell key={s.id} g={byKey.get(`${tg.id}|${s.id}`)} t={t} hex={tg.hex} max={maxAcc} />)}
              </tr>
            ))}
          </Reveal>
        </table>
      </div>
      <div className="legend">
        <span>{r.legendAccuracy}</span>
        <span><span className="swatch-bar" />{r.legendBar}</span>
        <span><span className="swatch-hatch" />{r.legendLowN}</span>
      </div>

      <Disclosures />
    </div>
  );
}
