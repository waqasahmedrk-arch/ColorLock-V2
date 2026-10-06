"use client";

import { useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import type { DayCount } from "@/lib/admin";

// Sign-ins per day as stacked columns: successful (accent) under failed (status red). One
// shared axis; sign-ups go in the tooltip and the table, not on a second scale. Each column
// has a hover/focus tooltip, and the same numbers are available as a table.
export default function ActivityChart({ series }: { series: DayCount[] }) {
  const { t, lang } = useI18n();
  const a = t.admin;
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.map((d) => d.logins + d.failed));
  // A round top for the axis: 1, 2, 5, 10, 20, 50…
  const step = [1, 2, 5].map((m) => m * 10 ** Math.floor(Math.log10(max))).find((v) => v * 2 >= max)
    ?? 10 ** Math.ceil(Math.log10(max));
  const top = Math.max(step * 2, max);
  const label = (day: string, long = false) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString(lang, long
      ? { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }
      : { day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <div className="adm-chart">
      {/* The colour key is the 14-day totals in the card head (Overview.tsx). */}
      <div className="adm-chart-plot" role="img"
           aria-label={`${a.chartTitle}: ${series.map((d) => `${label(d.day)} ${a.chartTip(d.logins, d.failed, d.signups)}`).join("; ")}`}>
        <div className="adm-chart-grid" aria-hidden>
          <span data-v={top} /><span data-v={top / 2} /><span data-v={0} />
        </div>
        <div className="adm-chart-cols" onMouseLeave={() => setHover(null)}>
          {series.map((d, i) => {
            const ok = (d.logins / top) * 100;
            const bad = (d.failed / top) * 100;
            return (
              <div key={d.day} className={`adm-col${hover === i ? " is-hover" : ""}`} tabIndex={0}
                   style={{ "--i": i } as React.CSSProperties}
                   onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
                <div className="adm-col-bar">
                  {d.failed > 0 && <span className="adm-seg is-failed" style={{ height: `${bad}%` }} />}
                  {d.logins > 0 && <span className="adm-seg is-ok" style={{ height: `${ok}%` }} />}
                </div>
                <span className="adm-col-label">{i % 2 === series.length % 2 ? "" : label(d.day)}</span>
                {hover === i && (
                  <div className="adm-tip" role="tooltip" data-edge={i < 2 ? "start" : i > series.length - 3 ? "end" : undefined}>
                    <strong>{label(d.day, true)}</strong>
                    <span><i className="is-ok" />{a.chartOk}<b>{d.logins}</b></span>
                    <span><i className="is-failed" />{a.chartFailed}<b>{d.failed}</b></span>
                    <span><i className="is-new" />{a.chartSignups}<b>{d.signups}</b></span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <details className="adm-chart-table">
        <summary>{a.chartTable}</summary>
        <table className="adm-table">
          <thead><tr><th>{a.chartDay}</th><th>{a.chartOk}</th><th>{a.chartFailed}</th><th>{a.chartSignups}</th></tr></thead>
          <tbody>
            {series.map((d) => (
              <tr key={d.day}><td>{label(d.day, true)}</td><td>{d.logins}</td><td>{d.failed}</td><td>{d.signups}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
