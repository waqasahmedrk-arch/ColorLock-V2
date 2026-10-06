"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { AuthError, EMAIL_RE, auth, goAfterAuth } from "@/lib/auth";
import VerifyStep from "../_components/VerifyStep";

// How long the button shows "Verifying credentials…" after a correct sign-in, before
// "Signed in". The API answers at once; this is a deliberate pause. Wrong credentials are
// reported as soon as the API answers.
const VERIFY_MS = 3500;
import { Field, FormError, SubmitButton } from "../_components/fields";

export default function LoginForm() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Set when an unverified account tries to sign in: finish verification inline.
  const [verify, setVerify] = useState<{ email: string; resendAfter: number } | null>(null);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const e: typeof errors = {};
    if (!EMAIL_RE.test(email.trim())) e.email = t.auth.errEmail;
    if (!password) e.password = t.auth.errPasswordEmpty;
    setErrors(e);
    setError(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    const started = performance.now();
    try {
      await auth.login(email.trim(), password, remember);
      const left = VERIFY_MS - (performance.now() - started);
      if (left > 0) await new Promise((r) => window.setTimeout(r, left));
      setBusy(false);
      setDone(true);
      window.setTimeout(() => goAfterAuth("login"), 700);
    } catch (err) {
      const a = err as AuthError;
      if (a.type === "/problems/email-unverified") {
        // A cooldown refusal just means a code is already on its way.
        const sent = await auth.resendCode(email.trim(), "signup").catch(() => null);
        setVerify({ email: email.trim().toLowerCase(), resendAfter: sent?.resend_after_s ?? 60 });
      } else {
        setError(a.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (verify) {
    return (
      <VerifyStep email={verify.email} resendAfter={verify.resendAfter} remember={remember}
                  onVerified={() => goAfterAuth("signup")} onBack={() => setVerify(null)} />
    );
  }

  return (
    <form className="auth-form auth-step" onSubmit={onSubmit} noValidate>
      <Field label={t.auth.email} icon="mail" type="email" autoComplete="email" value={email}
             delay={3} error={errors.email} onChange={(e) => setEmail(e.target.value)} />
      <Field label={t.auth.password} icon="lock" type="password" autoComplete="current-password"
             value={password} delay={4} error={errors.password}
             onChange={(e) => setPassword(e.target.value)} />
      <div className="auth-row auth-rise" style={{ "--d": 5 } as React.CSSProperties}>
        <label className="auth-check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>{t.auth.login.remember}</span>
        </label>
        <Link href="/forgot-password">{t.auth.login.forgot}</Link>
      </div>
      <FormError message={error} />
      <SubmitButton busy={busy} done={done} progressMs={VERIFY_MS}>
        {done ? t.auth.login.done : busy ? t.auth.login.verifying : t.auth.login.submit}
      </SubmitButton>
      <p className="auth-switch muted">
        {t.auth.login.newHere} <Link href="/signup">{t.auth.login.create}</Link>
      </p>
    </form>
  );
}
