"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/components/I18nProvider";
import Icon, { type IconName } from "@/components/Icon";
import { history } from "@/lib/history";

type Range = "all" | "today" | "week" | "month" | "custom";
const OPTIONS: { key: Range; icon: IconName }[] = [
  { key: "all", icon: "history" },
  { key: "today", icon: "sun" },
  { key: "week", icon: "calendar" },
  { key: "month", icon: "calendar" },
  { key: "custom", icon: "filter" },
];
const COUNT_MS = 250; // debounce for the live count
const EXIT_MS = 200; // matches .rd.is-leaving

// YYYY-MM-DD for a local calendar day (what <input type="date"> uses).
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}
// Local midnight at the start of `day` plus `addDays` days.
function midnight(day: string, addDays = 0): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d + addDays);
}

// Picks which scores go into the history PDF report, shows how many that is, then opens the
// report in a new tab with ?from= / ?to= (local days, inclusive) and the current name search.
export default function ReportDialog({ q, onClose }: { q: string; onClose: () => void }) {
  const { t, lang } = useI18n();
  const r = t.report;
  const today = ymd(new Date());
  const [range, setRange] = useState<Range>("all");
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(today);
  const [count, setCount] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const bounds: { from?: string; to?: string } =
    range === "today" ? { from: today, to: today }
      : range === "week" ? { from: daysAgo(6), to: today }
        : range === "month" ? { from: daysAgo(29), to: today }
          : range === "custom" ? { from, to } : {};
  const invalid = range === "custom" && (!from || !to || from > to);

  const short = (day: string) => midnight(day).toLocaleDateString(lang, { month: "short", day: "numeric" });
  const long = (day: string) =>
    midnight(day).toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric" });
  const span = (a: string, b: string) => (a === b ? short(a) : `${short(a)} – ${short(b)}`);
  const hint: Record<Range, string> = {
    all: r.allHint,
    today: short(today),
    week: span(daysAgo(6), today),
    month: span(daysAgo(29), today),
    custom: !invalid && from && to ? span(from, to) : "—",
  };

  const close = () => {
    setLeaving(true);
    window.setTimeout(onClose, EXIT_MS);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  // Live count of the scores the report would hold.
  useEffect(() => {
    if (invalid) { setCount(null); return; }
    setCount(null);
    let live = true;
    const id = window.setTimeout(() => {
      history.list(0, 1, q, {
        since: bounds.from ? midnight(bounds.from).toISOString() : undefined,
        until: bounds.to ? midnight(bounds.to, 1).toISOString() : undefined,
      }).then((p) => { if (live) setCount(p.total); }).catch(() => { if (live) setCount(null); });
    }, COUNT_MS);
    return () => { live = false; window.clearTimeout(id); };
  }, [q, bounds.from, bounds.to, invalid]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key !== "Tab") return;
      // Keep Tab inside the dialog.
      const items = dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]):not([type='radio']), input[type='radio']:checked");
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, []);

  function create() {
    if (invalid || count === 0) return;
    const params = new URLSearchParams({ print: "1" });
    if (q) params.set("q", q);
    if (bounds.from) params.set("from", bounds.from);
    if (bounds.to) params.set("to", bounds.to);
    window.open(`/history/report?${params}`, "_blank", "noopener");
    close();
  }

  return createPortal(
    <div className={`rd${leaving ? " is-leaving" : ""}`}
         onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={dialogRef} className="rd-dialog" role="dialog" aria-modal="true"
           aria-labelledby="rd-title" aria-describedby="rd-sub">
        <header className="rd-head">
          <span className="rd-head-icon" aria-hidden><Icon name="file" /></span>
          <div>
            <h2 id="rd-title">{r.dialogTitle}</h2>
            <p id="rd-sub">{r.dialogSub}</p>
          </div>
          <button type="button" className="rd-close" data-no-loader aria-label={r.close} title={r.close} onClick={close}>
            <Icon name="x" />
          </button>
        </header>

        <fieldset className="rd-options">
          <legend className="sr-only">{r.range}</legend>
          {OPTIONS.map(({ key, icon }, i) => (
            <label key={key} className={`rd-option${key === "custom" ? " is-wide" : ""}`}
                   style={{ "--i": i } as React.CSSProperties}>
              <input type="radio" name="rd-range" value={key} checked={range === key}
                     onChange={() => setRange(key)} />
              <span className="rd-option-icon" aria-hidden><Icon name={icon} /></span>
              <span className="rd-option-text">
                <strong>{r.ranges[key]}</strong>
                <small>{hint[key]}</small>
              </span>
              <span className="rd-option-check" aria-hidden><Icon name="check" /></span>
            </label>
          ))}
        </fieldset>

        {/* Folds open under the options when "Custom range" is chosen. */}
        <div className="rd-custom" data-open={range === "custom" ? "" : undefined} aria-hidden={range !== "custom"}>
          <div className="rd-custom-inner">
            <div className="rd-dates">
              <label>
                <span>{r.from}</span>
                <input type="date" value={from} max={today} tabIndex={range === "custom" ? 0 : -1}
                       aria-invalid={invalid} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <span className="rd-arrow" aria-hidden><Icon name="arrowRight" /></span>
              <label>
                <span>{r.to}</span>
                <input type="date" value={to} max={today} tabIndex={range === "custom" ? 0 : -1}
                       aria-invalid={invalid} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
            {invalid && <p className="rd-error" role="alert"><Icon name="alertCircle" /> {r.rangeError}</p>}
          </div>
        </div>

        <div className="rd-summary" aria-live="polite">
          <span className="rd-summary-label">{r.includes}</span>
          <div className="rd-summary-row">
            <span className={`rd-count${count === 0 ? " is-zero" : ""}`}>
              {invalid ? "—"
                : count === null ? <><Icon name="loader" className="spin" /> {r.counting}</>
                  : <span key={count} className="rd-count-value">{count === 0 ? r.noneInRange : r.countScores(count)}</span>}
            </span>
            <span className="rd-summary-dates">
              <Icon name="calendar" />
              {bounds.from && bounds.to && !invalid
                ? (bounds.from === bounds.to ? long(bounds.from) : `${long(bounds.from)} – ${long(bounds.to)}`)
                : range === "all" ? r.ranges.all : "—"}
            </span>
          </div>
          {q && <p className="rd-summary-search"><Icon name="search" /> {r.searchNote(q)}</p>}
        </div>

        <footer className="rd-foot">
          <span className="rd-foot-note">{r.opensInTab}</span>
          <div className="rd-actions">
            <button type="button" className="rd-btn" data-no-loader onClick={close}>{t.header.cancel}</button>
            <button type="button" className="rd-btn is-primary" data-no-loader onClick={create}
                    disabled={invalid || count === 0}>
              <Icon name="download" /> {r.create}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
