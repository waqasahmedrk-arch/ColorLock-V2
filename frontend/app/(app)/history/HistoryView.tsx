"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import Swatch from "@/components/Swatch";
import { fmt } from "@/lib/api";
import { HistoryError, history, type HistoryRecord, type HistoryStats } from "@/lib/history";
import { dataText, translateServer, type Dict } from "@/lib/i18n";
import ReportDialog from "./ReportDialog";

const PAGE = 20;
const EXIT_MS = 320; // matches the .is-removing animation

type Pending = { kind: "one"; record: HistoryRecord } | { kind: "all" } | null;

const SEARCH_MS = 300; // debounce for the search box

// The search term as the API applies it: whitespace collapsed and trimmed.
const tidy = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");

// Wraps each case-insensitive occurrence of `term` in <mark>.
function highlight(text: string, term: string): React.ReactNode {
  if (!term) return text;
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  const out: React.ReactNode[] = [];
  let at = 0;
  for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, at)) {
    if (i > at) out.push(text.slice(at, i));
    out.push(<mark key={i}>{text.slice(i, i + needle.length)}</mark>);
    at = i + needle.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export default function HistoryView() {
  const { t, lang } = useI18n();
  const h = t.history;
  const [items, setItems] = useState<HistoryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // `query` is what's in the search box; `qRef` is the term the list was last loaded with.
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const qRef = useRef("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fail = useCallback((e: unknown) => {
    const err = e as HistoryError;
    if (err.status === 401) return window.location.replace("/login?next=/history");
    setError(translateServer(t, err.message));
  }, [t]);

  // (Re)load one page of records plus fresh totals. A page left empty (its last record was
  // deleted, or it no longer exists) steps back to the last page that has records.
  const load = useCallback(async (p = 0) => {
    const q = qRef.current;
    try {
      let res = await history.list(p * PAGE, PAGE, q);
      if (res.items.length === 0 && p > 0 && res.total > 0) {
        p = Math.ceil(res.total / PAGE) - 1;
        res = await history.list(p * PAGE, PAGE, q);
      }
      setItems(res.items);
      setTotal(res.total);
      setStats(res.stats);
      setPage(p);
      setError(null);
      // Keep ?page= and ?q= in the address bar so reloads and shared links land on the same page.
      const url = new URL(window.location.href);
      if (p > 0) url.searchParams.set("page", String(p + 1));
      else url.searchParams.delete("page");
      if (q) url.searchParams.set("q", q);
      else url.searchParams.delete("q");
      window.history.replaceState(window.history.state, "", url);
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }, [fail]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const n = Number(params.get("page"));
    qRef.current = tidy(params.get("q") ?? "");
    setQuery(qRef.current);
    load(Number.isInteger(n) && n > 1 ? n - 1 : 0);
  }, [load]);

  // Search a moment after typing stops; a new term always starts from the first page.
  useEffect(() => {
    const term = tidy(query);
    if (term === qRef.current) return;
    const id = window.setTimeout(async () => {
      qRef.current = term;
      setSearching(true);
      setOpen(new Set());
      await load(0);
      setSearching(false);
    }, SEARCH_MS);
    return () => window.clearTimeout(id);
  }, [query, load]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);

  async function goTo(p: number) {
    if (p === page || paging) return;
    setPaging(true);
    setOpen(new Set());
    await load(p);
    setPaging(false);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "one") {
        const id = pending.record.id;
        await history.remove(id);
        setPending(null);
        // Let the row fold away, then refresh the list and the totals.
        setRemoving((s) => new Set(s).add(id));
        await new Promise((r) => window.setTimeout(r, EXIT_MS));
        await load(page);
        setRemoving((s) => { const n = new Set(s); n.delete(id); return n; });
        setToast(h.deleted);
      } else {
        await history.clear();
        setPending(null);
        await load();
        setToast(h.cleared);
      }
    } catch (e) {
      setPending(null);
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  // Excel always covers the whole history, whatever the search: it's the research dataset.
  async function exportExcel() {
    setExporting(true);
    try {
      await history.download("xlsx");
      setToast(t.settings.exported);
    } catch (e) {
      fail(e);
    } finally {
      setExporting(false);
    }
  }

  const when = (iso: string) => new Date(iso).toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" });
  // The user's name for the score; older records without one fall back to the file name.
  const nameOf = (r: HistoryRecord) => r.name ?? r.filename ?? h.untitled;
  const term = qRef.current;

  if (loading) {
    return (
      <div className="history" aria-busy="true">
        <div className="history-stats">{[0, 1, 2, 3].map((i) => <div key={i} className="history-stat skeleton" />)}</div>
        {[0, 1, 2].map((i) => <div key={i} className="history-row skeleton" style={{ height: 88 }} />)}
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="history-empty">
        <div className="history-empty-icon is-error"><Icon name="alertCircle" /></div>
        <h2>{h.loadError}</h2>
        <p className="muted">{error}</p>
        <button type="button" data-no-loader onClick={() => { setLoading(true); load(); }}>
          <Icon name="reset" /> {h.retry}
        </button>
      </div>
    );
  }

  // The "no scores yet" screen is only for an empty history, not for a search with no matches.
  if (items.length === 0 && !term && !(stats?.count)) {
    return (
      <div className="history-empty">
        <div className="history-empty-icon"><Icon name="history" /></div>
        <h2>{h.empty}</h2>
        <p className="muted">{h.emptyText}</p>
        <Link href="/score" className="button"><Icon name="pipette" /> {h.scoreNow}</Link>
        {toast && <Toast text={toast} />}
      </div>
    );
  }

  // Group rows under a heading per local calendar day.
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const dayLabel = (d: Date) =>
    dayKey(d) === dayKey(now) ? h.today
      : dayKey(d) === dayKey(yesterday) ? h.yesterday
        : d.toLocaleDateString(lang, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  let lastDay = "";
  let index = 0;

  return (
    <div className="history">
      {stats && (
        <div className="history-stats">
          <Stat label={h.statCount} value={String(stats.count)} icon="history" delay={0} />
          <Stat label={h.statPass} icon="check" delay={1}
                value={`${stats.qc_pass_count}`}
                sub={stats.count ? `${Math.round((stats.qc_pass_count / stats.count) * 100)}%` : undefined} />
          <Stat label={h.statBest} value={fmt(stats.best_delta_e00, 2)} icon="ruler" delay={2} />
          <Stat label={h.statMean} value={fmt(stats.mean_delta_e00, 2)} icon="chart" delay={3} />
        </div>
      )}

      <div className={`history-search${searching ? " is-searching" : ""}`} role="search">
        <Icon name={searching ? "loader" : "search"} className={searching ? "spin" : undefined} />
        <input ref={searchRef} type="search" value={query} placeholder={h.searchPlaceholder}
               aria-label={h.searchLabel} maxLength={100} enterKeyHint="search"
               onChange={(e) => setQuery(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); } }} />
        {query && (
          <button type="button" className="history-search-clear" data-no-loader aria-label={h.clearSearch}
                  title={h.clearSearch} onClick={() => { setQuery(""); searchRef.current?.focus(); }}>
            <Icon name="x" />
          </button>
        )}
      </div>

      <div className="history-toolbar" ref={topRef}>
        <span className="muted">{items.length > 0 && h.showing(page * PAGE + 1, page * PAGE + items.length, total)}</span>
        <div className="history-toolbar-actions">
          {items.length > 0 && (
            // Pick a date range, then the report opens in a new tab with the print dialog.
            <button type="button" className="history-pdf" data-no-loader aria-haspopup="dialog"
                    onClick={() => setReportOpen(true)}>
              <Icon name="download" /> {t.report.pdfReport}
            </button>
          )}
          {items.length > 0 && (
            <button type="button" className="history-pdf is-excel" data-no-loader disabled={exporting}
                    title={t.report.excelTitle} onClick={exportExcel}>
              <Icon name={exporting ? "loader" : "file"} className={exporting ? "spin" : undefined} />
              {exporting ? t.settings.exporting : t.report.excel}
            </button>
          )}
          <button type="button" className="history-clear" data-no-loader onClick={() => setPending({ kind: "all" })}>
            <Icon name="trash" /> {h.clearAll}
          </button>
        </div>
      </div>

      {error && <div className="error"><Icon name="alertCircle" className="lead" />{error}</div>}

      {items.length === 0 && term && (
        <div className="history-no-match">
          <div className="history-empty-icon"><Icon name="search" /></div>
          <h2>{h.noMatches(term)}</h2>
          <p className="muted">{h.noMatchesText}</p>
          <button type="button" className="secondary" data-no-loader onClick={() => setQuery("")}>
            <Icon name="x" /> {h.clearSearch}
          </button>
        </div>
      )}

      <ol className="history-list" key={page} aria-busy={paging || undefined} data-paging={paging ? "" : undefined}>
        {items.map((r) => {
          const d = new Date(r.created_at);
          const key = dayKey(d);
          const heading = key !== lastDay ? dayLabel(d) : null;
          lastDay = key;
          const expanded = open.has(r.id);
          const res = r.result;
          const target = dataText(t.data.targets, res.target.id, res.target.name);
          return (
            <li key={r.id} className={removing.has(r.id) ? "is-removing" : undefined}>
              {heading && <h3 className="history-day">{heading}</h3>}
              <article className="history-row" style={{ "--i": Math.min(index++, 12) } as React.CSSProperties}>
                <div className="history-swatches" aria-hidden>
                  <span style={{ background: res.target.hex }} />
                  <span style={{ background: res.sample_hex }} />
                </div>
                <div className="history-main">
                  <div className="history-name" title={nameOf(r)}>
                    <Icon name="file" /> <span>{r.name ? highlight(r.name, term) : nameOf(r)}</span>
                  </div>
                  {r.name && r.filename && (
                    <div className="history-file muted" title={r.filename}>{h.file}: {r.filename}</div>
                  )}
                  <div className="history-meta muted">
                    <span><Swatch hex={res.target.hex} />{h.target}: {target} {res.target.hex}</span>
                    <span>{h.measured}: <code>{res.sample_hex}</code></span>
                  </div>
                  <time className="history-time muted" dateTime={r.created_at}>
                    <Icon name="clock" /> {h.scoredAt} {when(r.created_at)}
                  </time>
                </div>
                <div className="history-score">
                  <span className="history-de">{fmt(res.delta_e00, 2)}</span>
                  <span className="kicker">ΔE00</span>
                  <span className={`badge ${res.qc.pass ? "ok" : "bad"}`}>
                    <Icon name={res.qc.pass ? "check" : "x"} />{res.qc.pass ? t.images.qcPass : t.images.qcFail}
                  </span>
                </div>
                <div className="history-actions">
                  <a className="history-icon-btn" target="_blank" rel="noopener"
                     href={`/history/report?id=${encodeURIComponent(r.id)}&print=1`}
                     title={t.report.pdfOne} aria-label={`${t.report.pdfOne}: ${nameOf(r)}`}>
                    <Icon name="download" />
                  </a>
                  <button type="button" className="history-icon-btn" data-no-loader aria-expanded={expanded}
                          aria-controls={`details-${r.id}`}
                          title={expanded ? h.hideDetails : h.details}
                          onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}>
                    <Icon name="chevronDown" className={expanded ? "is-flipped" : undefined} />
                    <span className="sr-only">{expanded ? h.hideDetails : h.details}</span>
                  </button>
                  <button type="button" className="history-icon-btn is-danger" data-no-loader
                          title={h.delete} aria-label={h.deleteLabel(nameOf(r))}
                          onClick={() => setPending({ kind: "one", record: r })}>
                    <Icon name="trash" />
                  </button>
                </div>
                <div id={`details-${r.id}`} className="history-details" data-open={expanded ? "" : undefined}>
                  <div className="history-details-inner">
                    <Details r={r} t={t} />
                  </div>
                </div>
              </article>
            </li>
          );
        })}
      </ol>

      {total > PAGE && (
        <Pagination page={page} pages={Math.ceil(total / PAGE)} busy={paging} onChange={goTo} h={h} />
      )}

      {pending && (
        <ConfirmDialog
          icon="trash"
          title={pending.kind === "one" ? h.deleteTitle : h.clearTitle}
          text={pending.kind === "one" ? h.deleteText(nameOf(pending.record), when(pending.record.created_at)) : h.clearText(stats?.count ?? total)}
          confirmLabel={pending.kind === "one" ? h.delete : h.clearAll}
          busyLabel={h.deleting}
          busy={busy}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      )}
      {reportOpen && <ReportDialog q={term} onClose={() => setReportOpen(false)} />}
      {toast && <Toast text={toast} />}
    </div>
  );
}

// Page numbers to show: always the first and last, the current one with a neighbour on each
// side, and a gap marker ("…") wherever pages are skipped. Indexes are 0-based.
function pageItems(page: number, pages: number): (number | "gap")[] {
  const keep = new Set([0, pages - 1, page - 1, page, page + 1]);
  // Near either end, show enough numbers that a single hidden page never becomes "…".
  if (page <= 2) [1, 2, 3].forEach((p) => keep.add(p));
  if (page >= pages - 3) [pages - 4, pages - 3, pages - 2].forEach((p) => keep.add(p));
  const sorted = [...keep].filter((p) => p >= 0 && p < pages).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(p - sorted[i - 1] === 2 ? p - 1 : "gap");
    out.push(p);
  });
  return out;
}

function Pagination({ page, pages, busy, onChange, h }: {
  page: number; pages: number; busy: boolean; onChange: (p: number) => void; h: Dict["history"];
}) {
  return (
    <nav className="history-pager" aria-label={h.pagination}>
      <button type="button" className="history-page-btn is-step" data-no-loader
              disabled={page === 0 || busy} onClick={() => onChange(page - 1)}>
        <Icon name="chevronLeft" /><span className="history-page-word">{h.prev}</span>
      </button>
      <ol className="history-pages">
        {pageItems(page, pages).map((p, i) =>
          p === "gap" ? (
            <li key={`gap-${i}`} className="history-page-gap" aria-hidden>…</li>
          ) : (
            <li key={p}>
              <button type="button" className="history-page-btn" data-no-loader disabled={busy && p !== page}
                      aria-current={p === page ? "page" : undefined} aria-label={h.pageLabel(p + 1)}
                      onClick={() => onChange(p)}>
                {busy && p === page ? <Icon name="loader" className="spin" /> : p + 1}
              </button>
            </li>
          ),
        )}
      </ol>
      <span className="history-page-of muted">{h.pageOf(page + 1, pages)}</span>
      <button type="button" className="history-page-btn is-step" data-no-loader
              disabled={page >= pages - 1 || busy} onClick={() => onChange(page + 1)}>
        <span className="history-page-word">{h.next}</span><Icon name="chevronRight" />
      </button>
    </nav>
  );
}

function Stat({ label, value, sub, icon, delay }: {
  label: string; value: string; sub?: string; icon: "history" | "check" | "ruler" | "chart"; delay: number;
}) {
  return (
    <div className="history-stat" style={{ "--i": delay } as React.CSSProperties}>
      <span className="kicker"><Icon name={icon} /> {label}</span>
      <span className="stat">{value}{sub && <small className="muted"> · {sub}</small>}</span>
    </div>
  );
}

function Details({ r, t }: { r: HistoryRecord; t: Dict }) {
  const res = r.result;
  const s = t.score;
  const delta = `${res.chroma.delta >= 0 ? "+" : ""}${fmt(res.chroma.delta, 1)}`;
  return (
    <>
      <div className="history-compare">
        <figure><Swatch hex={res.target.hex} large /><figcaption>{s.target} · {res.target.hex}</figcaption></figure>
        <figure><Swatch hex={res.sample_hex} large /><figcaption>{s.measured} · {res.sample_hex}</figcaption></figure>
      </div>
      <dl className="kv">
        <dt>{s.flatnessQc}</dt><dd>{s.flatnessValue(fmt(res.flat_p95_de, 3), res.qc.threshold)}</dd>
        <dt>{s.chroma}</dt>
        <dd>
          {t.image.chromaValue(fmt(res.chroma.sample, 1), fmt(res.chroma.reference, 1), delta)}{" "}
          <span className="muted">({res.chroma.delta < 0 ? s.lessSaturated : s.asSaturated})</span>
        </dd>
        <dt>{t.image.sampleLab}</dt><dd className="mono">{res.sample_lab.map((v) => v.toFixed(2)).join(", ")}</dd>
        <dt>{t.image.targetLab}</dt><dd className="mono">{res.target.lab.map((v) => v.toFixed(2)).join(", ")}</dd>
        <dt>{s.package}</dt><dd>colourlock {res.package_version}</dd>
        <dt>{s.scoreId}</dt><dd className="mono">{r.score_id}</dd>
      </dl>
      {res.warnings.length > 0 && (
        <ul className="history-warnings">
          {res.warnings.map((w) => <li key={w}><Icon name="alert" /> {s.warnings[w] ?? w}</li>)}
        </ul>
      )}
    </>
  );
}

function Toast({ text }: { text: string }) {
  return <div className="history-toast" role="status"><Icon name="check" /> {text}</div>;
}
