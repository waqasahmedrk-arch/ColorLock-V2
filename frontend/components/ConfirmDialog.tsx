"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/components/I18nProvider";
import Icon, { type IconName } from "@/components/Icon";

// A modal "are you sure?" for destructive actions. Rendered into <body> so the sticky
// header can't clip it. Cancel has focus first, so Enter or Escape never confirms by accident.
export default function ConfirmDialog({
  icon, title, text, confirmLabel, busyLabel, busy, onConfirm, onCancel, children,
}: {
  icon: IconName;
  title: string;
  text: string;
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
      if (e.key !== "Tab") return;
      // Keep Tab inside the dialog.
      const items = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
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
  }, [busy, onCancel]);

  return createPortal(
    <div className="confirm-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div ref={dialogRef} className="confirm-dialog" role="alertdialog" aria-modal="true"
           aria-labelledby="confirm-title" aria-describedby="confirm-text">
        <div className="confirm-icon"><Icon name={icon} /></div>
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-text" className="muted">{text}</p>
        {children}
        <div className="confirm-actions">
          <button ref={cancelRef} type="button" className="secondary" data-no-loader onClick={onCancel}
                  disabled={busy}>
            {t.header.cancel}
          </button>
          <button type="button" className="confirm-danger" data-no-loader onClick={onConfirm} disabled={busy}>
            <Icon name={busy ? "loader" : icon} className={busy ? "spin" : undefined} />
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
