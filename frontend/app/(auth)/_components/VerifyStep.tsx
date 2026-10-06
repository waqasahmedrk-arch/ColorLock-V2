"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import { AuthError, auth, type User } from "@/lib/auth";
import { FormError, OtpInput, ResendButton, SubmitButton, useCountdown } from "./fields";

// Enter the emailed sign-up code. Submits by itself once all six digits are in.
export default function VerifyStep({ email, resendAfter, remember, onVerified, onBack }: {
  email: string;
  resendAfter: number;
  remember?: boolean;
  onVerified: (user: User) => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const countdown = useCountdown();
  const { start } = countdown;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => start(resendAfter), []);

  async function submit(value = code) {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const user = await auth.verifyEmail(email, value, remember);
      setDone(true);
      window.setTimeout(() => onVerified(user), 700);
    } catch (e) {
      setError((e as AuthError).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      const sent = await auth.resendCode(email, "signup");
      setInfo(t.auth.verify.resent);
      start(sent.resend_after_s);
    } catch (e) {
      setError((e as AuthError).message);
    }
  }

  return (
    <form className="auth-form auth-step" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="auth-mail-badge"><Icon name="mail" /></div>
      <p className="auth-step-lead">{t.auth.verify.lead(email)}</p>
      <OtpInput value={code} error={!!error} disabled={busy || done}
                onChange={(v) => { setCode(v); setError(null); if (v.length === 6) submit(v); }} />
      <FormError message={error} />
      {info && !error && <p className="auth-info"><Icon name="check" /> {info}</p>}
      <SubmitButton busy={busy} done={done}>{done ? t.auth.verify.done : t.auth.verify.submit}</SubmitButton>
      <ResendButton onResend={resend} countdown={countdown} />
      <button type="button" className="auth-link auth-back" data-no-loader onClick={onBack}>
        <Icon name="arrowLeft" /> {t.auth.verify.differentEmail}
      </button>
    </form>
  );
}
