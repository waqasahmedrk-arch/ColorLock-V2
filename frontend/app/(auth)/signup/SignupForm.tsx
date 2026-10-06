"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { AuthError, EMAIL_RE, auth, passwordProblem, goAfterAuth } from "@/lib/auth";
import VerifyStep from "../_components/VerifyStep";
import { Field, FormError, StrengthMeter, SubmitButton } from "../_components/fields";

type Errors = Partial<Record<"name" | "email" | "password" | "confirm", string>>;

export default function SignupForm() {
  const { t } = useI18n();
  const [step, setStep] = useState<"details" | "verify">("details");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendAfter, setResendAfter] = useState(60);

  function validate(): Errors {
    const e: Errors = {};
    if (!name.trim()) e.name = t.auth.errName;
    if (!EMAIL_RE.test(email.trim())) e.email = t.auth.errEmail;
    const pw = passwordProblem(password);
    if (pw) e.password = pw === "short" ? t.auth.errPasswordShort : t.auth.errPasswordMix;
    if (confirm !== password) e.confirm = t.auth.errMismatch;
    return e;
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    setError(null);
    if (Object.keys(e).length) return;
    if (!agree) return setError(t.auth.errTerms);
    setBusy(true);
    try {
      const sent = await auth.signup(name.trim(), email.trim(), password);
      setEmail(sent.email);
      setResendAfter(sent.resend_after_s);
      setStep("verify");
    } catch (err) {
      const a = err as AuthError;
      setErrors(a.fields as Errors);
      setError(a.message);
    } finally {
      setBusy(false);
    }
  }

  if (step === "verify") {
    return (
      <VerifyStep
        email={email}
        resendAfter={resendAfter}
        onBack={() => setStep("details")}
        onVerified={() => goAfterAuth("signup")}
      />
    );
  }

  return (
    <form className="auth-form auth-step" onSubmit={onSubmit} noValidate>
      <Field label={t.auth.fullName} icon="user" autoComplete="name" value={name} delay={3}
             error={errors.name} onChange={(e) => setName(e.target.value)} />
      <Field label={t.auth.email} icon="mail" type="email" autoComplete="email" value={email}
             delay={4} error={errors.email} onChange={(e) => setEmail(e.target.value)} />
      <Field label={t.auth.password} icon="lock" type="password" autoComplete="new-password"
             value={password} delay={5} error={errors.password}
             onChange={(e) => setPassword(e.target.value)} />
      <StrengthMeter password={password} />
      <Field label={t.auth.confirmPassword} icon="lock" type="password" autoComplete="new-password"
             value={confirm} delay={6} error={errors.confirm}
             onChange={(e) => setConfirm(e.target.value)} />
      <label className="auth-check auth-rise" style={{ "--d": 7 } as React.CSSProperties}>
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>{t.auth.signup.terms}</span>
      </label>
      <FormError message={error} />
      <SubmitButton busy={busy}>{t.auth.signup.submit}</SubmitButton>
      <p className="auth-switch muted">
        {t.auth.signup.haveAccount} <Link href="/login">{t.auth.signup.signIn}</Link>
      </p>
    </form>
  );
}
