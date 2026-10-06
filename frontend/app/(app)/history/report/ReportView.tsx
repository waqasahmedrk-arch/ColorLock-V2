"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import { fmt } from "@/lib/api";
import { history, type HistoryError, type HistoryRecord } from "@/lib/history";
import { dataText, translateServer } from "@/lib/i18n";

const BRAND = ["#4169E1", "#DC143C", "#228B22", "#DAA520"];
const PAGE = 100; // the API's largest page
const MAX = 2000; // a report this long is already ~60 printed pages

type Props = {
  version: string;
  threshold: number;
  crop: number;
  user: { name: string; email: string } | null;
};

// Loads the records the report covers and lays them out as a printable sheet. The sheet always
// uses light "paper" colours, whatever the site theme; report.css hides the site chrome in print.
export default function ReportView({ version, threshold, crop, user }: Props) {
  const { t, lang } = useI18n();
  const r = t.report;
  const [records, setRecords] = useState<HistoryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<{ id: string | null; q: string; from: string | null; to: string | null }>(
    { id: null, q: "", from: null, to: null });
  const printed = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const q = (params.get("q") ?? "").trim();
    const from = validDay(params.get("from"));
    const to = validDay(params.get("to"));
    setMode({ id, q, from, to });
    // Local calendar days -> instants: from local midnight, until the midnight after `to`.
    const range = {
      since: from ? localMidnight(from, 0).toISOString() : undefined,
      until: to ? localMidnight(to, 1).toISOString() : undefined,
    };
    const fail = (e: unknown) => {
      const err = e as HistoryError;
      if (err.status === 401) return window.location.replace("/login?next=/history");
      setError(err.status === 404 ? r.notFound : translateServer(t, err.message));
    };
    (async () => {
      try {
        if (id) {
          setRecords([await history.get(id)]);
          return;
        }
        const all: HistoryRecord[] = [];
        for (let offset = 0; offset < MAX; offset += PAGE) {
          const page = await history.list(offset, PAGE, q, range);
          all.push(...page.items);
          if (all.length >= page.total || page.items.length === 0) break;
        }
        setRecords(all);
      } catch (e) {
        fail(e);
      }
    })();
  }, [r.notFound, t]);

  // With ?print=1, open the print dialog once the data and fonts are in.
  useEffect(() => {
    if (!records || printed.current) return;
    if (new URLSearchParams(window.location.search).get("print") !== "1") return;
    printed.current = true;
    document.fonts.ready.then(() => window.setTimeout(() => window.print(), 300));
  }, [records]);

  const now = new Date().toLocaleString(lang, { dateStyle: "long", timeStyle: "short" });
  const when = (iso: string) => new Date(iso).toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" });
  const nameOf = (x: HistoryRecord) => x.name ?? x.filename ?? t.history.untitled;
  const dayLabel = (day: string) =>
    localMidnight(day, 0).toLocaleDateString(lang, { year: "numeric", month: "long", day: "numeric" });
  const single = !!mode.id;

  return (
    <div className="report">
      <div className="report-toolbar">
        <Link href="/history" className="report-btn"><Icon name="arrowLeft" /> {r.back}</Link>
        <button type="button" className="report-btn is-primary" data-no-loader disabled={!records}
                onClick={() => window.print()}>
          <Icon name="download" /> {r.print}
        </button>
      </div>

      {error && <div className="error"><Icon name="alertCircle" className="lead" />{error}</div>}
      {!records && !error && (
        <p className="report-loading muted"><Icon name="loader" className="spin" /> {r.loading}</p>
      )}

      {records && (
        <article className="report-sheet">
          <header className="report-head">
            <div className="report-brand">
              <span className="report-dots" aria-hidden>{BRAND.map((c) => <i key={c} style={{ background: c }} />)}</span>
              ColorLock
            </div>
            <h1>{single ? r.titleOne : r.title}</h1>
            <dl className="report-meta">
              {user && <><dt>{r.preparedFor}</dt><dd>{user.name} · {user.email}</dd></>}
              {!single && <><dt>{r.scope}</dt><dd>{mode.q ? r.scopeSearch(mode.q) : r.scopeAll}</dd></>}
              {!single && (mode.from || mode.to) && (
                <><dt>{r.dates}</dt><dd>{r.datesValue(dayLabel(mode.from ?? mode.to!), dayLabel(mode.to ?? mode.from!))}</dd></>
              )}
              <dt>{t.score.package}</dt><dd>colourlock {version}</dd>
              <dd className="report-generated">{r.generated(now)}</dd>
            </dl>
          </header>

          {records.length === 0 && <p className="report-empty">{r.empty}</p>}

          {single && records[0] && <SingleScore rec={records[0]} name={nameOf(records[0])} when={when} />}

          {!single && records.length > 0 && (
            <>
              <Summary records={records} />
              <table className="report-table">
                <thead>
                  <tr>
                    <th>{r.cols.n}</th><th>{r.cols.name}</th><th>{r.cols.date}</th>
                    <th>{r.cols.target}</th><th>{r.cols.measured}</th>
                    <th className="num">{r.cols.de}</th><th>{r.cols.qc}</th><th className="num">{r.cols.chroma}</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((x, i) => {
                    const res = x.result;
                    return (
                      <tr key={x.id}>
                        <td className="muted">{i + 1}</td>
                        <td className="report-name">{nameOf(x)}</td>
                        <td className="nowrap">{when(x.created_at)}</td>
                        <td><Chip hex={res.target.hex} label={dataText(t.data.targets, res.target.id, res.target.name)} /></td>
                        <td><Chip hex={res.sample_hex} /></td>
                        <td className="num strong">{fmt(res.delta_e00, 2)}</td>
                        <td><QcBadge pass={res.qc.pass} /></td>
                        <td className="num">{res.chroma.delta >= 0 ? "+" : ""}{fmt(res.chroma.delta, 1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          <footer className="report-notes">
            <h2>{r.method}</h2>
            <p>{r.methodText(version, threshold, crop)}</p>
            <p>{r.colourNote}</p>
            <p>{r.disclaimer}</p>
          </footer>
        </article>
      )}
    </div>
  );

  function Summary({ records }: { records: HistoryRecord[] }) {
    const n = records.length;
    const passed = records.filter((x) => x.result.qc.pass).length;
    const des = records.map((x) => x.result.delta_e00);
    const best = Math.min(...des);
    const mean = des.reduce((a, b) => a + b, 0) / n;
    return (
      <section className="report-summary" aria-label={r.summary}>
        <div><span>{r.count}</span><strong>{n}</strong></div>
        <div><span>{r.passed}</span><strong>{passed} <small>({Math.round((passed / n) * 100)}%)</small></strong></div>
        <div><span>{r.best}</span><strong>{fmt(best, 2)}</strong></div>
        <div><span>{r.mean}</span><strong>{fmt(mean, 2)}</strong></div>
      </section>
    );
  }

  function SingleScore({ rec, name, when }: { rec: HistoryRecord; name: string; when: (iso: string) => string }) {
    const res = rec.result;
    const v = t.score;
    const delta = `${res.chroma.delta >= 0 ? "+" : ""}${fmt(res.chroma.delta, 1)}`;
    return (
      <section className="report-one">
        <h2 className="report-one-name">{name}</h2>
        <p className="muted">{when(rec.created_at)}{rec.filename && rec.name ? ` · ${r.file}: ${rec.filename}` : ""}</p>

        <div className="report-compare">
          <figure>
            <span className="report-swatch" style={{ background: res.target.hex }} />
            <figcaption><strong>{v.target}</strong> · {dataText(t.data.targets, res.target.id, res.target.name)} · <code>{res.target.hex}</code></figcaption>
          </figure>
          <figure>
            <span className="report-swatch" style={{ background: res.sample_hex }} />
            <figcaption><strong>{v.measured}</strong> · <code>{res.sample_hex}</code></figcaption>
          </figure>
        </div>

        <div className="report-headline">
          <div><span>{v.deltaE}</span><strong>{fmt(res.delta_e00, 2)}</strong></div>
          <div><span>{v.flatnessQc}</span><QcBadge pass={res.qc.pass} big /></div>
        </div>

        <h3>{r.measurements}</h3>
        <dl className="report-kv">
          <dt>{r.flatness}</dt><dd>{fmt(res.flat_p95_de, 3)}</dd>
          <dt>{r.threshold}</dt><dd>≤ {res.qc.threshold}</dd>
          <dt>{r.chroma}</dt><dd>{fmt(res.chroma.sample, 1)} / {fmt(res.chroma.reference, 1)} / {delta}</dd>
          <dt>{t.image.sampleLab}</dt><dd><code>{res.sample_lab.map((x) => x.toFixed(2)).join(", ")}</code></dd>
          <dt>{t.image.targetLab}</dt><dd><code>{res.target.lab.map((x) => x.toFixed(2)).join(", ")}</code></dd>
          <dt>{t.image.keptPct}</dt><dd>{fmt(res.kept_pct, 2)}</dd>
          <dt>{v.package}</dt><dd>colourlock {res.package_version}</dd>
          <dt>{v.scoreId}</dt><dd><code>{rec.score_id}</code></dd>
        </dl>

        {res.warnings.length > 0 && (
          <>
            <h3>{r.warnings}</h3>
            <ul className="report-warnings">
              {res.warnings.map((w) => <li key={w}>{v.warnings[w] ?? w}</li>)}
            </ul>
          </>
        )}
        {!res.qc.pass && <p className="report-callout">{v.notFlat}</p>}
      </section>
    );
  }

  function QcBadge({ pass, big }: { pass: boolean; big?: boolean }) {
    return (
      <span className={`report-badge ${pass ? "ok" : "bad"}${big ? " big" : ""}`}>
        {pass ? t.score.pass : t.score.fail}
      </span>
    );
  }
}

// "2026-10-01" if it is one, else null.
function validDay(v: string | null): string | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00`).getTime()) ? v : null;
}

// Local midnight at the start of `day` plus `addDays` days.
function localMidnight(day: string, addDays: number): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d + addDays);
}

function Chip({ hex, label }: { hex: string; label?: string }) {
  return (
    <span className="report-chip">
      <i style={{ background: hex }} />
      <span>{label && <span className="report-chip-label">{label}</span>}<code>{hex}</code></span>
    </span>
  );
}
