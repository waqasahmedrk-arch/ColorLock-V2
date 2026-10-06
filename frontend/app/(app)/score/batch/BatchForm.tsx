"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CountUp from "@/components/CountUp";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import { fmt, PUBLIC_API_BASE, type BatchItem, type BatchResponse, type Problem, type Target } from "@/lib/api";
import { dataText, translateServer } from "@/lib/i18n";

const MAX_FILES = 20; // matches the API's max_batch_files
const ACCEPT = ["image/png", "image/jpeg"];
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const CUSTOM = "__custom__";

type Entry = { id: string; file: File; url: string };
type SortKey = "index" | "delta" | "flat" | "chroma";

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Spreadsheet-safe CSV cell: quoted, and a leading formula character neutralised.
function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function toCsv(res: BatchResponse): string {
  const head = ["filename", "target_id", "target_hex", "sample_hex", "sample_L", "sample_a", "sample_b",
    "delta_e00", "flat_p95_de", "qc_pass", "qc_threshold", "chroma_sample", "chroma_reference",
    "chroma_delta", "kept_pct", "warnings", "package_version", "score_id", "error"];
  const rows = res.items.map((it) => {
    const r = it.result;
    return [
      it.filename, res.target.id, res.target.hex, r?.sample_hex, r?.sample_lab[0], r?.sample_lab[1], r?.sample_lab[2],
      r?.delta_e00, r?.flat_p95_de, r ? r.qc.pass : "", res.qc_threshold, r?.chroma.sample, r?.chroma.reference,
      r?.chroma.delta, r?.kept_pct, r?.warnings.join(";"), res.package_version, r?.score_id,
      it.error ? [it.error.title, it.error.detail].filter(Boolean).join(": ") : "",
    ];
  });
  return [head, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export default function BatchForm({ targets }: { targets: Target[] }) {
  const { t } = useI18n();
  const b = t.batch;
  const v = t.score;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [customHex, setCustomHex] = useState("#4169E1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ res: BatchResponse; thumbs: string[] } | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "index", dir: 1 });
  const inputRef = useRef<HTMLInputElement>(null);
  const urls = useRef(new Set<string>());

  const custom = targetId === CUSTOM;
  const hexValid = !custom || HEX_RE.test(customHex);

  // Revoke every preview URL when the page goes away.
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  function track(file: File): Entry {
    const url = URL.createObjectURL(file);
    urls.current.add(url);
    return { id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`, file, url };
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const all = Array.from(list);
    const ok = all.filter((f) => ACCEPT.includes(f.type));
    const room = MAX_FILES - entries.length;
    const taken = ok.slice(0, Math.max(0, room));
    const notes = [];
    if (ok.length < all.length) notes.push(b.skipped(all.length - ok.length));
    if (ok.length > room) notes.push(b.tooMany(MAX_FILES));
    setNotice(notes.length ? notes.join(" ") : null);
    setEntries((prev) => [...prev, ...taken.map(track)]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function remove(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function reset() {
    setEntries([]);
    setResult(null);
    setError(null);
    setNotice(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!entries.length || !hexValid) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const body = new FormData();
    entries.forEach((en) => body.append("images", en.file));
    if (custom) body.append("target_hex", customHex);
    else body.append("target_id", targetId);
    try {
      const res = await fetch(`${PUBLIC_API_BASE}/score/batch`, { method: "POST", body, credentials: "include" });
      const json = await res.json();
      if (!res.ok) {
        const p = json as Problem;
        setError(p.detail ? `${translateServer(t, p.title)}: ${translateServer(t, p.detail)}` : translateServer(t, p.title));
      } else {
        setResult({ res: json as BatchResponse, thumbs: entries.map((en) => en.url) });
        setSort({ key: "index", dir: 1 });
      }
    } catch {
      setError(v.unreachable);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!result) return;
    const blob = new Blob(["﻿" + toCsv(result.res)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url, download: `colorlock-batch-${new Date().toISOString().slice(0, 10)}.csv`,
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="score-layout">
      <form className="card score-form" onSubmit={onSubmit}>
        <section className="score-step">
          <h2><span className="score-step-num">1</span>{b.images}</h2>
          {entries.length < MAX_FILES && (
            <label
              htmlFor="batch-files"
              className={`score-drop batch-drop${dragging ? " is-dragging" : ""}${entries.length ? " is-compact" : ""}`}
              onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
              onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
            >
              <span className="score-drop-icon"><Icon name="upload" /></span>
              <strong>{dragging ? v.dropActive : b.dropTitle}</strong>
              <span className="muted">{v.dropOr}</span>
              <span className="score-drop-hint">{b.dropHint(MAX_FILES)}</span>
            </label>
          )}
          <input ref={inputRef} id="batch-files" className="score-file-input" type="file" multiple
                 accept={ACCEPT.join(",")} aria-label={b.images} onChange={(e) => addFiles(e.target.files)} />
          {notice && <p className="batch-notice"><Icon name="info" />{notice}</p>}
          {entries.length > 0 && (
            <>
              <div className="batch-list-head">
                <span>{b.count(entries.length, MAX_FILES)}</span>
                <button type="button" className="score-ghost" data-no-loader onClick={reset} disabled={busy}>
                  <Icon name="trash" />{b.clear}
                </button>
              </div>
              <ul className="batch-list">
                {entries.map((en, i) => (
                  <li key={en.id} style={{ "--i": i } as React.CSSProperties}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={en.url} alt="" />
                    <span className="batch-file-name" title={en.file.name}>{en.file.name}</span>
                    <span className="muted">{fileSize(en.file.size)}</span>
                    <button type="button" className="score-ghost score-icon-btn" data-no-loader aria-label={`${v.remove} ${en.file.name}`}
                            onClick={() => remove(en.id)} disabled={busy}>
                      <Icon name="x" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <fieldset className="score-step">
          <legend><h2><span className="score-step-num">2</span>{v.targetColour}</h2></legend>
          <div className="score-targets">
            {targets.map((tg, i) => {
              const name = dataText(t.data.targets, tg.id, tg.name);
              return (
                <label key={tg.id} className="score-target" style={{ "--i": i, "--c": tg.hex } as React.CSSProperties} title={`${name} ${tg.hex}`}>
                  <input type="radio" name="target" value={tg.id} checked={targetId === tg.id} onChange={() => setTargetId(tg.id)} />
                  <span className="score-target-chip" aria-hidden><Icon name="check" /></span>
                  <span className="score-target-name">{name}</span>
                  <span className="score-target-hex">{tg.hex}</span>
                </label>
              );
            })}
            <label className="score-target is-custom" style={{ "--i": targets.length, "--c": hexValid ? customHex : "transparent" } as React.CSSProperties}>
              <input type="radio" name="target" value={CUSTOM} checked={custom} onChange={() => setTargetId(CUSTOM)} />
              <span className="score-target-chip" aria-hidden><Icon name="check" /></span>
              <span className="score-target-name">{v.custom}</span>
              <span className="score-target-hex">{custom ? customHex : "#RRGGBB"}</span>
            </label>
          </div>
          {custom && (
            <div className="score-custom">
              <label className="field">
                {v.hex}
                <span className="score-custom-row">
                  <input type="color" value={hexValid ? customHex : "#000000"} aria-label={v.hex}
                         onChange={(e) => setCustomHex(e.target.value.toUpperCase())} />
                  <input type="text" value={customHex} onChange={(e) => setCustomHex(e.target.value.trim())}
                         aria-invalid={!hexValid} spellCheck={false} maxLength={7} />
                </span>
              </label>
              {!hexValid && <span className="score-hex-error"><Icon name="alertCircle" />{v.hexError}</span>}
            </div>
          )}
        </fieldset>

        <button type="submit" className="score-submit" disabled={!entries.length || !hexValid || busy}>
          {busy ? <><Icon name="loader" className="spin" />{b.scoring(entries.length)}</>
                : <><Icon name="pipette" />{b.submit(entries.length || 0)}</>}
        </button>
      </form>

      <div className="score-output" aria-live="polite">
        {error && <div className="error score-error"><Icon name="alertCircle" className="lead" />{error}</div>}
        {busy && (
          <div className="card batch-progress">
            <p className="muted"><Icon name="loader" className="spin lead" />{b.scoring(entries.length)}</p>
            <div className="batch-progress-grid">
              {entries.map((en, i) => (
                <span key={en.id} style={{ "--i": i } as React.CSSProperties}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={en.url} alt="" />
                </span>
              ))}
            </div>
          </div>
        )}
        {!busy && !result && !error && (
          <div className="card score-empty">
            <div className="score-empty-art" aria-hidden>
              <i style={{ background: "#4169E1" }} /><i style={{ background: "#DC143C" }} />
              <i style={{ background: "#228B22" }} /><i style={{ background: "#DAA520" }} />
            </div>
            <h3>{b.emptyTitle}</h3>
            <p className="muted">{b.emptyText}</p>
          </div>
        )}
        {!busy && result && (
          <BatchResults res={result.res} thumbs={result.thumbs} sort={sort} setSort={setSort}
                        onDownload={download} onReset={reset} />
        )}
      </div>
    </div>
  );
}

function BatchResults({ res, thumbs, sort, setSort, onDownload, onReset }: {
  res: BatchResponse; thumbs: string[]; sort: { key: SortKey; dir: 1 | -1 };
  setSort: (s: { key: SortKey; dir: 1 | -1 }) => void; onDownload: () => void; onReset: () => void;
}) {
  const { t } = useI18n();
  const b = t.batch;
  const v = t.score;
  const ok = res.items.filter((it) => it.result);
  const deltas = ok.map((it) => it.result!.delta_e00);
  const passed = ok.filter((it) => it.result!.qc.pass).length;
  const maxDelta = Math.max(1, ...deltas);
  const targetName = dataText(t.data.targets, res.target.id, res.target.name);

  const rows = useMemo(() => {
    const value = (it: BatchItem): number => {
      const r = it.result;
      if (sort.key === "index") return it.index;
      if (!r) return Infinity; // failed rows sink to the bottom either way
      return sort.key === "delta" ? r.delta_e00 : sort.key === "flat" ? r.flat_p95_de : r.chroma.delta;
    };
    return [...res.items].sort((x, y) => {
      const a = value(x), c = value(y);
      if (a === Infinity || c === Infinity) return a === c ? 0 : a === Infinity ? 1 : -1;
      return (a - c) * sort.dir;
    });
  }, [res.items, sort]);

  const th = (key: SortKey, label: string, cls = "") => (
    <th className={cls} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button type="button" data-no-loader className="batch-sort" title={b.sortBy(label)}
              onClick={() => setSort({ key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : 1 })}>
        {label}
        <Icon name={sort.key === key && sort.dir === -1 ? "arrowUp" : "chevronDown"} />
      </button>
    </th>
  );

  return (
    <div className="batch-result">
      <div className="card batch-head score-anim">
        <div className="batch-target">
          <span className="batch-target-swatch" style={{ background: res.target.hex }} />
          <div>
            <div className="kicker">{v.target}</div>
            <strong>{targetName}</strong> <span className="mono muted">{res.target.hex}</span>
          </div>
        </div>
        <div className="batch-actions">
          <button type="button" className="score-ghost" data-no-loader onClick={onReset}><Icon name="reset" />{b.newBatch}</button>
          <button type="button" className="batch-download" data-no-loader onClick={onDownload}><Icon name="download" />{b.download}</button>
        </div>
      </div>

      <div className="batch-summary score-anim" style={{ "--d": "0.08s" } as React.CSSProperties}>
        <div><span>{b.summaryScored}</span><strong><CountUp value={ok.length} /></strong></div>
        <div><span>{b.summaryFailed}</span><strong className={ok.length < res.items.length ? "bad" : ""}><CountUp value={res.items.length - ok.length} /></strong></div>
        <div><span>{b.summaryPassed}</span><strong><CountUp value={passed} /><small> / {ok.length}</small></strong></div>
        <div><span>{b.summaryMedian}</span><strong>{deltas.length ? <CountUp value={median(deltas)} digits={2} /> : "—"}</strong></div>
        <div><span>{b.summaryRange}</span><strong className="batch-range">{deltas.length ? `${fmt(Math.min(...deltas), 1)}–${fmt(Math.max(...deltas), 1)}` : "—"}</strong></div>
      </div>
      <p className="batch-descriptive muted"><Icon name="info" />{b.descriptive}</p>

      <div className="card batch-table-wrap score-anim" style={{ "--d": "0.16s" } as React.CSSProperties}>
        <table className="batch-table">
          <thead>
            <tr>
              {th("index", b.colImage)}
              <th>{b.colMeasured}</th>
              {th("delta", b.colDelta, "num")}
              {th("flat", b.colFlat, "num")}
              <th>{b.colQc}</th>
              {th("chroma", b.colChroma, "num")}
            </tr>
          </thead>
          <tbody>
            {rows.map((it, i) => {
              const r = it.result;
              return (
                <tr key={it.index} className={r ? "" : "is-error"} style={{ "--i": i } as React.CSSProperties}>
                  <td>
                    <span className="batch-name">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {thumbs[it.index] && <img src={thumbs[it.index]} alt="" />}
                      <span title={it.filename ?? ""}>{it.filename ?? `#${it.index + 1}`}</span>
                      {r && r.warnings.length > 0 && (
                        <span className="batch-warn" title={r.warnings.map((w) => v.warnings[w] ?? w).join("\n")}>
                          <Icon name="alert" />{b.warningsCount(r.warnings.length)}
                        </span>
                      )}
                    </span>
                  </td>
                  {r ? (
                    <>
                      <td><span className="batch-measured"><i style={{ background: r.sample_hex }} /><span className="mono">{r.sample_hex}</span></span></td>
                      <td className="num">
                        <span className="batch-delta">
                          <b>{fmt(r.delta_e00, 2)}</b>
                          <span className="batch-delta-bar" aria-hidden><i style={{ "--w": `${(r.delta_e00 / maxDelta) * 100}%`, background: r.sample_hex } as React.CSSProperties} /></span>
                        </span>
                      </td>
                      <td className="num">{fmt(r.flat_p95_de, 2)}</td>
                      <td><span className={`badge ${r.qc.pass ? "ok" : "bad"}`}><Icon name={r.qc.pass ? "check" : "x"} />{r.qc.pass ? v.pass : v.fail}</span></td>
                      <td className={`num ${r.chroma.delta < 0 ? "neg" : ""}`}>{r.chroma.delta >= 0 ? "+" : "−"}{fmt(Math.abs(r.chroma.delta), 1)}</td>
                    </>
                  ) : (
                    <td colSpan={5} className="batch-error">
                      <Icon name="alertCircle" /><strong>{b.error}</strong>
                      <span>{translateServer(t, it.error?.title ?? "")}{it.error?.detail ? `: ${translateServer(t, it.error.detail)}` : ""}</span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
