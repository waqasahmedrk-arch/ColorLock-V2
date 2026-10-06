"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import { adminAuth, type SelfieRequired } from "@/lib/admin";
import { EMAIL_RE, goAfterAuth } from "@/lib/auth";
import type { RequestError } from "@/lib/chat";
import { translateServer } from "@/lib/i18n";
import { Field, FormError, OtpInput, ResendButton, SubmitButton, useCountdown } from "../_components/fields";
import SelfieStep from "./SelfieStep";

// Same pause as the user site's sign-in (LoginForm.tsx), for the same "verifying" moment.
const VERIFY_MS = 2000;

type Pending = { email: string; resendAfter: number };
type Selfie = { email: string; token: string; expiresIn: number };

// Admin sign-in, two steps: the password, then the 6-digit code emailed to the admin.
// The code also verifies the address of an admin account created by another admin.
// An admin with no selfie on file (first sign-in) gets a third step: the camera selfie.
export default function AdminLoginForm() {
  const { t } = useI18n();
  const c = t.adminLogin;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [selfie, setSelfie] = useState<Selfie | null>(null);

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
      const sent = await adminAuth.login(email.trim(), password);
      const left = VERIFY_MS - (performance.now() - started);
      if (left > 0) await new Promise((r) => window.setTimeout(r, left));
      setPassword("");
      setPending({ email: sent.email, resendAfter: sent.resend_after_s });
    } catch (err) {
      setError(translateServer(t, (err as RequestError).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ol className="auth-steps auth-rise" style={{ "--d": 2 } as React.CSSProperties} aria-label={c.stepsLabel}>
        <li className={pending ? "is-done" : "is-current"}>
          <span>{pending ? <Icon name="check" /> : 1}</span>{c.stepPassword}
        </li>
        <li className={selfie ? "is-done" : pending ? "is-current" : undefined}>
          <span>{selfie ? <Icon name="check" /> : 2}</span>{c.stepCode}
        </li>
        {selfie && <li className="is-current"><span>3</span>{c.stepSelfie}</li>}
      </ol>

      {selfie ? (
        <SelfieStep key={selfie.token} email={selfie.email} token={selfie.token} expiresIn={selfie.expiresIn}
                    remember={remember} onDone={() => goAfterAuth("login")}
                    onBack={() => { setSelfie(null); setPending(null); }} />
      ) : pending ? (
        <CodeStep key={pending.email} pending={pending} remember={remember} onBack={() => setPending(null)}
                  onSelfie={(s) => setSelfie({ email: pending.email, token: s.token, expiresIn: s.expires_in_s })} />
      ) : (
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
          <SubmitButton busy={busy} done={false} progressMs={VERIFY_MS}>
            {busy ? c.verifying : c.submit}
          </SubmitButton>
        </form>
      )}
    </>
  );
}

function CodeStep({ pending, remember, onBack, onSelfie }: {
  pending: Pending; remember: boolean; onBack: () => void; onSelfie: (s: SelfieRequired) => void;
}) {
  const { t } = useI18n();
  const c = t.adminLogin;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const countdown = useCountdown();
  const { start } = countdown;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => start(pending.resendAfter), []);

  async function submit(value = code) {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminAuth.verify(pending.email, value, remember);
      if ("selfie_required" in res) {
        onSelfie(res);
        return;
      }
      setDone(true);
      window.setTimeout(() => goAfterAuth("login"), 700);
    } catch (e) {
      setError(translateServer(t, (e as RequestError).message));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      const sent = await adminAuth.resend(pending.email);
      setInfo(t.auth.verify.resent);
      start(sent.resend_after_s);
    } catch (e) {
      setError(translateServer(t, (e as RequestError).message));
    }
  }

  return (
    <form className="auth-form auth-step" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="auth-mail-badge"><Icon name="shield" /></div>
      <p className="auth-step-lead">{c.codeLead(pending.email)}</p>
      <OtpInput value={code} error={!!error} disabled={busy || done}
                onChange={(v) => { setCode(v); setError(null); if (v.length === 6) submit(v); }} />
      <FormError message={error} />
      {info && !error && <p className="auth-info"><Icon name="check" /> {info}</p>}
      <SubmitButton busy={busy} done={done}>{done ? t.auth.login.done : c.codeSubmit}</SubmitButton>
      <ResendButton onResend={resend} countdown={countdown} />
      <button type="button" className="auth-link auth-back" data-no-loader onClick={onBack}>
        <Icon name="arrowLeft" /> {c.back}
      </button>
    </form>
  );
}
