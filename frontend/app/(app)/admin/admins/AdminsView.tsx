"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/Avatar";
import Icon from "@/components/Icon";
import { admin, adminAuth, type UserRow } from "@/lib/admin";
import { ADMIN_URL } from "@/lib/appMode";
import { EMAIL_RE, passwordProblem } from "@/lib/auth";
import { Field, FormError, StrengthMeter } from "../../../(auth)/_components/fields";
import { Empty, ErrorState, useAdmin, useToast } from "../ui";

// 16 characters from an alphabet without look-alikes (no 0/O, 1/l/I), always with a letter
// and a digit so it passes the password rule.
function strongPassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%*";
  const pick = (n: number) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (v) => chars[v % chars.length]).join("");
  let pw = pick(16);
  while (passwordProblem(pw)) pw = pick(16);
  return pw;
}

export default function AdminsView() {
  const { a, ago, date, message } = useAdmin();
  const [admins, setAdmins] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [toastView, toast] = useToast();

  const load = useCallback(async () => {
    try {
      setAdmins((await admin.users({ status: "admins", sort: "name", limit: 100 })).items);
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, [message]);

  useEffect(() => {
    load();
    adminAuth.me().then((u) => setMeId(u.id)).catch(() => undefined);
  }, [load]);

  return (
    <>
      <div className="adm-head">
        <div>
          <p className="adm-eyebrow"><Icon name="crown" /> {a.nav.admins}</p>
          <h1>{a.adminsTitle}</h1>
          <p className="lead">{a.adminsLead}</p>
        </div>
        <button type="button" className="adm-btn is-primary" data-no-loader onClick={() => setAdding(true)}>
          <Icon name="user" /> {a.addAdmin}
        </button>
      </div>

      {error && !admins && <ErrorState text={error} onRetry={load} />}
      {!admins && !error && <div className="adm-card adm-table-skeleton" aria-busy="true"><i /><i /><i /></div>}
      {admins && admins.length === 0 && <Empty icon="users" title={a.noAdmins} />}
      {admins && admins.length > 0 && (
        <div className="adm-admins">
          {admins.map((u, i) => (
            <Link key={u.id} href={`/admin/users/${u.id}`} className="adm-admin-card"
                  style={{ "--i": i } as React.CSSProperties}>
              <span className="adm-admin-avatar">
                <Avatar name={u.name} src={u.avatar_url} size={56} />
                <i aria-hidden><Icon name="crown" /></i>
                {u.online && <span className="adm-online-dot" aria-hidden />}
              </span>
              <strong>{u.name}{u.id === meId && <span className="adm-you">{a.you}</span>}</strong>
              <small>{u.email}</small>
              {!u.is_verified && <span className="adm-chip is-warn"><Icon name="mail" />{a.pendingVerify}</span>}
              <span className="adm-admin-meta">
                <span><Icon name="calendar" /> {date(u.created_at)}</span>
                <span><Icon name="logIn" /> {ago(u.last_login_at)}</span>
              </span>
            </Link>
          ))}
          <button type="button" className="adm-admin-card is-add" data-no-loader onClick={() => setAdding(true)}
                  style={{ "--i": admins.length } as React.CSSProperties}>
            <span className="adm-admin-plus" aria-hidden>+</span>
            <strong>{a.addAdmin}</strong>
          </button>
        </div>
      )}

      {adding && (
        <NewAdminDialog onClose={() => setAdding(false)}
                        onCreated={(u) => { setAdmins((list) => [...(list ?? []), u]); toast(a.createdTitle); }} />
      )}
      {toastView}
    </>
  );
}

function NewAdminDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (u: UserRow) => void }) {
  const { t, a, message } = useAdmin();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [busy, onClose]);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const e: typeof errors = {};
    if (!name.trim()) e.name = t.auth.errName;
    if (!EMAIL_RE.test(email.trim())) e.email = t.auth.errEmail;
    const pw = passwordProblem(password);
    if (pw) e.password = pw === "short" ? t.auth.errPasswordShort : t.auth.errPasswordMix;
    setErrors(e);
    setError(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const user = await admin.createAdmin(name.trim(), email.trim(), password);
      setCreated({ name: user.name, email: user.email, password });
      onCreated(user);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyDetails() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(`${a.signInAt}: ${ADMIN_URL}/login\n${a.fieldEmail}: ${created.email}\n${a.fieldPassword}: ${created.password}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked: the details stay on screen to copy by hand.
    }
  }

  return createPortal(
    <div className="confirm-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={dialogRef} className="confirm-dialog adm-new-admin" role="dialog" aria-modal="true" aria-labelledby="new-admin-title">
        {created ? (
          <div className="adm-created">
            <div className="confirm-icon adm-created-icon"><Icon name="badgeCheck" /></div>
            <h2 id="new-admin-title">{a.createdTitle}</h2>
            <p className="muted">{a.createdText(created.name)}</p>
            <dl className="adm-creds">
              <div><dt>{a.signInAt}</dt><dd className="mono">{ADMIN_URL}/login</dd></div>
              <div><dt>{a.fieldEmail}</dt><dd className="mono">{created.email}</dd></div>
              <div><dt>{a.fieldPassword}</dt><dd className="mono">{created.password}</dd></div>
            </dl>
            <div className="confirm-actions">
              <button type="button" className="secondary" data-no-loader onClick={copyDetails}>
                <Icon name={copied ? "check" : "file"} /> {copied ? a.copied : a.copyDetails}
              </button>
              <button type="button" className="adm-btn is-primary" data-no-loader onClick={onClose}>{a.done}</button>
            </div>
          </div>
        ) : (
          <form className="auth-form" onSubmit={submit} noValidate>
            <div className="confirm-icon adm-created-icon"><Icon name="crown" /></div>
            <h2 id="new-admin-title">{a.newAdminTitle}</h2>
            <p className="muted">{a.newAdminText}</p>
            <Field label={a.fieldName} icon="user" autoComplete="off" value={name} delay={0}
                   error={errors.name} onChange={(e) => setName(e.target.value)} />
            <Field label={a.fieldEmail} icon="mail" type="email" autoComplete="off" value={email} delay={0}
                   error={errors.email} onChange={(e) => setEmail(e.target.value)} />
            <Field label={a.fieldPassword} icon="lock" type="password" autoComplete="new-password" value={password}
                   delay={0} error={errors.password} onChange={(e) => setPassword(e.target.value)} />
            <StrengthMeter password={password} />
            <button type="button" className="adm-generate" data-no-loader
                    onClick={() => { setPassword(strongPassword()); setErrors((x) => ({ ...x, password: undefined })); }}>
              <Icon name="sparkles" /> {a.generate}
            </button>
            <FormError message={error} />
            <div className="confirm-actions">
              <button type="button" className="secondary" data-no-loader onClick={onClose} disabled={busy}>{t.header.cancel}</button>
              <button type="submit" className="adm-btn is-primary" data-no-loader disabled={busy}>
                <Icon name={busy ? "loader" : "check"} className={busy ? "spin" : undefined} /> {busy ? a.creating : a.create}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
