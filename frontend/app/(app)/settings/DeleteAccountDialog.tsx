"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/components/I18nProvider";
import Icon, { type IconName } from "@/components/Icon";
import { Field } from "../../(auth)/_components/fields";

const EXIT_MS = 200; // matches .da.is-leaving

// Account deletion: spells out what goes (with the user's own numbers), offers an export first,
// and needs both the password and an explicit "I understand" before the button arms. Locked
// while deleting; a wrong password shakes the dialog and clears the field.
export default function DeleteAccountDialog({
  password, onPassword, error, busy, scoreCount, deviceCount, exporting, onExport, onConfirm, onCancel,
}: {
  password: string;
  onPassword: (v: string) => void;
  error: string | null;
  busy: boolean;
  scoreCount: number | null;
  deviceCount: number;
  exporting: boolean;
  onExport: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const s = t.settings;
  const [ack, setAck] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [shake, setShake] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const ready = ack && !!password && !busy;

  const cancel = () => {
    if (busy) return;
    setLeaving(true);
    window.setTimeout(onCancel, EXIT_MS);
  };
  const cancelLatest = useRef(cancel);
  cancelLatest.current = cancel;

  // A new error (wrong password) shakes the dialog once.
  useEffect(() => { if (error) setShake((n) => n + 1); }, [error]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelLatest.current();
      if (e.key !== "Tab") return;
      // Keep Tab inside the dialog.
      const items = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])");
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

  const losses: { icon: IconName; text: string }[] = [
    { icon: "user", text: s.deleteProfile },
    { icon: "history", text: scoreCount === null ? s.history : s.historyCount(scoreCount) },
    { icon: "bell", text: s.deleteNotifications },
    { icon: "monitor", text: s.deleteSessions(deviceCount) },
  ];

  return createPortal(
    <div className={`da${leaving ? " is-leaving" : ""}`}
         onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div key={shake} ref={dialogRef} className={`da-dialog${shake ? " is-shaking" : ""}`} role="alertdialog"
           aria-modal="true" aria-labelledby="da-title" aria-describedby="da-text" aria-busy={busy || undefined}>
        <header className="da-head">
          <span className="da-icon" aria-hidden><Icon name="alert" /></span>
          <h2 id="da-title">{s.deleteTitle}</h2>
          <p id="da-text">{s.deleteText}</p>
        </header>

        <div className="da-body">
          <p className="da-label">{s.deleteWill}</p>
          <ul className="da-losses">
            {losses.map((l, i) => (
              <li key={l.icon} style={{ "--i": i } as React.CSSProperties}>
                <span className="da-loss-icon" aria-hidden><Icon name={l.icon} /></span>
                {l.text}
              </li>
            ))}
          </ul>

          {!!scoreCount && (
            <div className="da-export">
              <span><Icon name="download" /> {s.deleteExportHint}</span>
              <button type="button" className="da-export-btn" data-no-loader onClick={onExport}
                      disabled={exporting || busy}>
                <Icon name={exporting ? "loader" : "file"} className={exporting ? "spin" : undefined} />
                {exporting ? s.exporting : s.exportExcel}
              </button>
            </div>
          )}

          <div className="da-field">
            <Field label={t.auth.password} icon="lock" type="password" autoComplete="current-password"
                   value={password} delay={0} error={error} disabled={busy}
                   onChange={(e) => onPassword(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter" && ready) onConfirm(); }} />
          </div>

          <label className="da-ack">
            <input type="checkbox" checked={ack} disabled={busy} onChange={(e) => setAck(e.target.checked)} />
            <span className="da-ack-box" aria-hidden><Icon name="check" /></span>
            <span>{s.deleteAck}</span>
          </label>
        </div>

        <footer className="da-actions">
          <button ref={cancelRef} type="button" className="da-btn" data-no-loader onClick={cancel} disabled={busy}>
            {t.header.cancel}
          </button>
          <button type="button" className="da-btn is-danger" data-no-loader onClick={onConfirm} disabled={!ready}>
            <Icon name={busy ? "loader" : "trash"} className={busy ? "spin" : undefined} />
            {busy ? s.deleting : s.deleteAccount}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
