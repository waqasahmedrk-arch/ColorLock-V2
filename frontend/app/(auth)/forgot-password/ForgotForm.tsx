"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import { AuthError, EMAIL_RE, auth, passwordProblem } from "@/lib/auth";
import {
  Field, FormError, OtpInput, ResendButton, StrengthMeter, SubmitButton, useCountdown,
} from "../_components/fields";

type Step = "email" | "reset" | "done";

export default function ForgotForm() {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const countdown = useCountdown();

  async function sendCode(ev?: React.FormEvent) {
    ev?.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email.trim())) return setErrors({ email: t.auth.errEmail });
    setErrors({});
    setBusy(true);
    try {
      const sent = await auth.forgotPassword(email.trim());
      setEmail(sent.email);
      countdown.start(sent.resend_after_s);
      setStep("reset");
    } catch (e) {
      setError((e as AuthError).message);
    } finally {
      setBusy(false);
    }
  }

  async function reset(ev: React.FormEvent) {
    ev.preventDefault();
    const e: typeof errors = {};
    const pw = passwordProblem(password);
    if (pw) e.password = pw === "short" ? t.auth.errPasswordShort : t.auth.errPasswordMix;
    if (confirm !== password) e.confirm = t.auth.errMismatch;
    setErrors(e);
    setError(code.length === 6 ? null : t.auth.errCodeMissing);
    if (Object.keys(e).length || code.length !== 6) return;
    setBusy(true);
    try {
      await auth.resetPassword(email, code, password);
      setStep("done");
    } catch (err) {
      const a = err as AuthError;
      setErrors(a.fields);
      setError(a.message);
      if (a.status === 400) setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      const sent = await auth.resendCode(email, "reset");
      countdown.start(sent.resend_after_s);
    } catch (e) {
      setError((e as AuthError).message);
    }
  }

  if (step === "done") {
    return (
      <div className="auth-form auth-step auth-success">
        <div className="auth-success-mark"><Icon name="check" /></div>
        <h2>{t.auth.forgot.doneTitle}</h2>
        <p className="muted">{t.auth.forgot.doneText}</p>
        <Link href="/login" className="auth-submit">
          <span className="auth-submit-label">{t.auth.forgot.backToSignIn}</span>
          <Icon name="arrowRight" className="auth-submit-arrow" />
        </Link>
      </div>
    );
  }

  if (step === "reset") {
    return (
      <form key="reset" className="auth-form auth-step" onSubmit={reset} noValidate>
        <div className="auth-mail-badge"><Icon name="key" /></div>
        <p className="auth-step-lead">{t.auth.forgot.lead(email)}</p>
        <OtpInput value={code} error={!!error && code.length < 6}
                  onChange={(v) => { setCode(v); setError(null); }} />
        <Field label={t.auth.newPassword} icon="lock" type="password" autoComplete="new-password"
               value={password} delay={1} error={errors.password}
               onChange={(e) => setPassword(e.target.value)} />
        <StrengthMeter password={password} />
        <Field label={t.auth.confirmNewPassword} icon="lock" type="password"
               autoComplete="new-password" value={confirm} delay={2} error={errors.confirm}
               onChange={(e) => setConfirm(e.target.value)} />
        <FormError message={error} />
        <SubmitButton busy={busy}>{t.auth.forgot.submit}</SubmitButton>
        <ResendButton onResend={resend} countdown={countdown} />
        <button type="button" className="auth-link auth-back" data-no-loader
                onClick={() => { setStep("email"); setCode(""); setError(null); }}>
          <Icon name="arrowLeft" /> {t.auth.verify.differentEmail}
        </button>
      </form>
    );
  }

  return (
    <form key="email" className="auth-form auth-step" onSubmit={sendCode} noValidate>
      <Field label={t.auth.email} icon="mail" type="email" autoComplete="email" value={email}
             delay={3} error={errors.email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      <FormError message={error} />
      <SubmitButton busy={busy}>{t.auth.forgot.sendCode}</SubmitButton>
      <p className="auth-switch muted">
        {t.auth.forgot.remembered} <Link href="/login">{t.auth.forgot.backToSignIn}</Link>
      </p>
    </form>
  );
}
