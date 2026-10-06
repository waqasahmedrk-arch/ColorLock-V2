"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/Avatar";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import type { User } from "@/lib/auth";
import { describeDevice } from "@/lib/device";

const EXIT_MS = 200; // matches .so.is-leaving

// "Sign out?" confirmation: which account, and that only this browser is signed out (the API
// deletes just this session). Cancel has focus first, so Enter or Escape never signs out by
// accident; while signing out it can't be dismissed.
export default function SignOutDialog({ user, busy, onConfirm, onCancel }: {
  user: User;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const h = t.header;
  const [leaving, setLeaving] = useState(false);
  const [device, setDevice] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const cancel = () => {
    if (busy) return;
    setLeaving(true);
    window.setTimeout(onCancel, EXIT_MS);
  };
  const cancelRef2 = useRef(cancel);
  cancelRef2.current = cancel;

  useEffect(() => {
    const d = describeDevice(navigator.userAgent);
    if (d) setDevice(t.settings.on(d.browser, d.os));
  }, [t]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelRef2.current();
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
  }, []);

  return createPortal(
    <div className={`so${leaving ? " is-leaving" : ""}${busy ? " is-busy" : ""}`}
         onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div ref={dialogRef} className="so-dialog" role="alertdialog" aria-modal="true"
           aria-labelledby="so-title" aria-describedby="so-text" aria-busy={busy || undefined}>
        <div className="so-account">
          <div className="so-avatar">
            <Avatar name={user.name} src={user.avatar_url} size={64} />
            <span className="so-status" aria-hidden />
          </div>
          <div className="so-who">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
        </div>

        <div className="so-body">
          <h2 id="so-title">{h.confirmSignOutTitle}</h2>
          <p id="so-text">{h.confirmSignOutText}</p>
          <p className="so-device">
            <Icon name="monitor" />
            <span>{device ? h.signOutDevice(device) : h.signOutDeviceUnknown}</span>
          </p>
        </div>

        <div className="so-actions">
          <button ref={cancelRef} type="button" className="so-btn" data-no-loader onClick={cancel} disabled={busy}>
            {h.cancel}
          </button>
          <button type="button" className="so-btn is-danger" data-no-loader onClick={onConfirm} disabled={busy}>
            {busy ? <Icon name="loader" className="spin" /> : <Icon name="logOut" />}
            {busy ? h.signingOut : h.signOut}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
