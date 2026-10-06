"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import { IS_ADMIN_APP } from "@/lib/appMode";
import { AuthError, auth, passwordProblem } from "@/lib/auth";
import { Field, FormError, StrengthMeter, SubmitButton } from "../../(auth)/_components/fields";

type Errors = { current_password?: string; new_password?: string; confirm?: string };

export default function ChangePasswordForm() {
  const { t } = useI18n();
  const c = t.auth.change;
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    const e: Errors = {};
    if (!current) e.current_password = c.errCurrentEmpty;
    const pw = passwordProblem(password);
    if (pw) e.new_password = pw === "short" ? t.auth.errPasswordShort : t.auth.errPasswordMix;
    else if (current && password === current) e.new_password = c.errSame;
    if (confirm !== password) e.confirm = t.auth.errMismatch;
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await auth.changePassword(current, password);
      setDone(true);
    } catch (err) {
      const a = err as AuthError;
      if (a.status === 400 && a.message === "Your current password is incorrect.") {
        setErrors({ current_password: a.message });
        setCurrent("");
      } else if (a.status === 400) {
        setErrors({ new_password: a.message });
      } else {
        setErrors(a.fields);
        setError(a.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="auth-form auth-step auth-success">
        <div className="auth-success-mark"><Icon name="check" /></div>
        <h2>{c.doneTitle}</h2>
        <p className="muted">{c.doneText}</p>
        <Link href={IS_ADMIN_APP ? "/admin/profile" : "/profile"} className="auth-submit">
          <span className="auth-submit-label">{c.backToProfile}</span>
          <Icon name="arrowRight" className="auth-submit-arrow" />
        </Link>
      </div>
    );
  }

  return (
    <form className="auth-form auth-step" onSubmit={submit} noValidate>
      <Field label={c.current} icon="key" type="password" autoComplete="current-password"
             value={current} delay={3} error={errors.current_password} autoFocus
             onChange={(e) => setCurrent(e.target.value)} />
      <Field label={t.auth.newPassword} icon="lock" type="password" autoComplete="new-password"
             value={password} delay={4} error={errors.new_password}
             onChange={(e) => setPassword(e.target.value)} />
      <StrengthMeter password={password} />
      <Field label={t.auth.confirmNewPassword} icon="lock" type="password"
             autoComplete="new-password" value={confirm} delay={5} error={errors.confirm}
             onChange={(e) => setConfirm(e.target.value)} />
      <FormError message={error} />
      <SubmitButton busy={busy}>{c.submit}</SubmitButton>
    </form>
  );
}
