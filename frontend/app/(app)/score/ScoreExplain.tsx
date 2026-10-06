"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { fmt, type ScoreExplain as Explain, type ScoreResult } from "@/lib/api";
import type { Dict } from "@/lib/i18n";

const pct = (n: number, of: number) => `${(n / of) * 100}%`;
const signed = (x: number, digits = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(digits)}`;

// Why this score: where the flatness gate looks (with a per-pixel heat map) and how the sample
// drifted from the target on the a*b* plane. Display only; the metrics come from the score.
export default function ScoreExplain({ r, ex, preview, t }: { r: ScoreResult; ex: Explain; preview: string; t: Dict }) {
  const v = t.score.explain;
  const [view, setView] = useState<"heat" | "photo">("heat");
  const [x0, y0, x1, y1] = ex.crop_box;
  const crop = {
    left: pct(x0, ex.width), top: pct(y0, ex.height),
    width: pct(x1 - x0, ex.width), height: pct(y1 - y0, ex.height),
  };
  const share = ex.share_over_threshold * 100;

  return (
    <section className="card score-explain score-anim" style={{ "--d": "0.4s" } as React.CSSProperties}>
      <h3 className="score-explain-title"><Icon name="search" />{v.title}</h3>

      <div className="score-explain-grid">
        <div className="score-explain-panel">
          <div className="score-explain-head">
            <h4>{v.whereTitle}</h4>
            <span className="score-explain-seg" data-active={view}>
              <span className="score-explain-thumb" aria-hidden />
              <button type="button" data-no-loader aria-pressed={view === "heat"} onClick={() => setView("heat")}>{v.heat}</button>
              <button type="button" data-no-loader aria-pressed={view === "photo"} onClick={() => setView("photo")}>{v.photo}</button>
            </span>
          </div>
          <div className="score-explain-frame" data-view={view}
               style={{ maxWidth: `calc(360px * ${ex.width / ex.height})` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="" />
            <span className="score-explain-crop" style={crop} aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ex.heatmap_png} alt="" className="score-explain-heat" />
            </span>
          </div>
          <div className="score-explain-legend" aria-hidden>
            <span className="score-explain-ramp" />
            <span className="score-explain-ticks">
              <i style={{ left: "0%" }}>0</i>
              <i style={{ left: "50%" }}>{ex.threshold}</i>
              <i style={{ left: "100%" }}>{fmt(ex.scale_max, 0)}+</i>
            </span>
            <span className="score-explain-unit">ΔE00 · {v.fromMedian}</span>
          </div>
          <p className="score-explain-text">
            {v.shareText(share.toFixed(1), ex.threshold, fmt(r.flat_p95_de, 2), r.qc.pass)}
          </p>
        </div>

        <div className="score-explain-panel">
          <div className="score-explain-head"><h4>{v.driftTitle}</h4></div>
          <AbPlot r={r} v={v} t={t} />
          <dl className="score-explain-diffs">
            <DiffRow label={v.dL} value={ex.diff.dL} span={20}
                     text={Math.abs(ex.diff.dL) < 0.5 ? v.same : ex.diff.dL > 0 ? v.lighter : v.darker} />
            <DiffRow label={v.dC} value={ex.diff.dC} span={20}
                     text={Math.abs(ex.diff.dC) < 0.5 ? v.same : ex.diff.dC > 0 ? v.moreSat : v.lessSat} />
            {ex.diff.hue_shift_deg === null ? (
              <div className="score-explain-diff">
                <dt>{v.dH}</dt><dd className="muted">{v.noHue}</dd>
              </div>
            ) : (
              <DiffRow label={v.dH} value={ex.diff.hue_shift_deg} span={45} unit="°"
                       text={Math.abs(ex.diff.hue_shift_deg) < 1 ? v.same : v.hueShift} />
            )}
          </dl>
        </div>
      </div>
      <p className="score-explain-note muted"><Icon name="info" />{v.note}</p>
    </section>
  );
}

function DiffRow({ label, value, span, text, unit = "" }: { label: string; value: number; span: number; text: string; unit?: string }) {
  const w = Math.min(1, Math.abs(value) / span) * 50;
  return (
    <div className="score-explain-diff">
      <dt>{label}</dt>
      <dd>
        <span className="score-explain-bar" aria-hidden>
          <i style={{ "--w": `${w}%`, [value >= 0 ? "left" : "right"]: "50%" } as React.CSSProperties} />
        </span>
        <b className="mono">{signed(value)}{unit}</b>
        <span className="muted">{text}</span>
      </dd>
    </div>
  );
}

// a*b* plane seen from above: distance from the centre is chroma, angle is hue.
function AbPlot({ r, v, t }: { r: ScoreResult; v: Dict["score"]["explain"]; t: Dict }) {
  const [, ta, tb] = r.target.lab;
  const [, sa, sb] = r.sample_lab;
  const reach = Math.max(Math.abs(ta), Math.abs(tb), Math.abs(sa), Math.abs(sb), 1);
  const range = Math.max(40, Math.ceil((reach + 8) / 20) * 20);
  const S = 220, C = S / 2, k = (C - 14) / range;
  const px = (a: number) => C + a * k;
  const py = (b: number) => C - b * k;
  const rings = [0.25, 0.5, 0.75, 1].map((f) => f * range);
  const [x1, y1, x2, y2] = [px(ta), py(tb), px(sa), py(sb)];
  const len = Math.hypot(x2 - x1, y2 - y1);

  return (
    <figure className="score-ab">
      <svg viewBox={`0 0 ${S} ${S}`} role="img"
           aria-label={`${v.abLabel}: ${t.score.targetShort} a*=${ta.toFixed(1)} b*=${tb.toFixed(1)}, ${t.score.sampleShort} a*=${sa.toFixed(1)} b*=${sb.toFixed(1)}`}>
        <defs>
          <marker id="ab-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10z" fill="currentColor" />
          </marker>
        </defs>
        {rings.map((rr) => <circle key={rr} className="ab-ring" cx={C} cy={C} r={rr * k} />)}
        <line className="ab-axis" x1={14} y1={C} x2={S - 14} y2={C} />
        <line className="ab-axis" x1={C} y1={14} x2={C} y2={S - 14} />
        <text className="ab-label" x={S - 12} y={C - 5} textAnchor="end">+a* {v.red}</text>
        <text className="ab-label" x={16} y={C - 5}>−a* {v.green}</text>
        <text className="ab-label" x={C + 5} y={20}>+b* {v.yellow}</text>
        <text className="ab-label" x={C + 5} y={S - 12}>−b* {v.blue}</text>
        <text className="ab-label ab-range" x={C + range * k - 2} y={C + 12} textAnchor="end">{range}</text>
        {len > 4 && (
          <line className="ab-drift" x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#ab-arrow)"
                style={{ "--len": len } as React.CSSProperties} />
        )}
        <circle className="ab-point ab-target" cx={x1} cy={y1} r={7} fill={r.target.hex} />
        <circle className="ab-point ab-sample" cx={x2} cy={y2} r={6} fill={r.sample_hex} />
      </svg>
      <figcaption>
        <span><i className="ab-key target" style={{ background: r.target.hex }} />{t.score.targetShort}</span>
        <span><i className="ab-key sample" style={{ background: r.sample_hex }} />{t.score.sampleShort}</span>
        <span className="muted">ΔE00 {fmt(r.delta_e00, 2)}</span>
      </figcaption>
    </figure>
  );
}
