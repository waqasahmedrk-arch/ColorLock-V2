"use client";

import { useId, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import Icon, { type IconName } from "@/components/Icon";
import { passwordScore } from "@/lib/auth";
import { translateServer } from "@/lib/i18n";

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  icon: IconName;
  error?: string | null;
  delay?: number;
};

export function Field({ label, icon, error, delay = 3, type = "text", ...rest }: InputProps) {
  const id = useId();
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const isPassword = type === "password";
  return (
    <div className={`auth-field-row auth-rise${error ? " has-error" : ""}`}
         style={{ "--d": delay } as React.CSSProperties}>
      <div className="auth-input">
        <Icon name={icon} className="auth-input-icon" />
        <input id={id} type={isPassword && shown ? "text" : type} placeholder=" "
               aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} {...rest} />
        <label htmlFor={id}>{label}</label>
        {isPassword && (
          <button type="button" className="auth-eye" data-no-loader onClick={() => setShown(!shown)}
                  aria-label={shown ? t.auth.hidePassword : t.auth.showPassword} aria-pressed={shown}>
            <Icon name={shown ? "eyeOff" : "eye"} />
          </button>
        )}
      </div>
      {error && <p id={`${id}-err`} className="auth-field-error" role="alert">{translateServer(t, error)}</p>}
    </div>
  );
}

export function StrengthMeter({ password }: { password: string }) {
  const { t } = useI18n();
  const score = passwordScore(password);
  return (
    <div className="auth-strength" data-score={score} aria-live="polite">
      <div className="auth-strength-bars">{[1, 2, 3, 4].map((n) => <i key={n} />)}</div>
      <span>{password ? t.auth.strength[score] : t.auth.strengthHint}</span>
    </div>
  );
}

export function SubmitButton({ busy, children, done, progressMs }: {
  busy: boolean;
  children: React.ReactNode;
  done?: boolean;
  // While busy, a bar fills across the button over this many ms.
  progressMs?: number;
}) {
  return (
    <button type="submit" className={`auth-submit${done ? " is-done" : ""}`} disabled={busy || done}
            data-no-loader aria-busy={busy}>
      {busy && progressMs ? (
        <span className="auth-submit-progress" aria-hidden
              style={{ "--ms": `${progressMs}ms` } as React.CSSProperties} />
      ) : null}
      <span className="auth-submit-label">{children}</span>
      {busy && <Icon name="loader" className="spin" />}
      {done && <Icon name="check" className="auth-submit-check" />}
      {!busy && !done && <Icon name="arrowRight" className="auth-submit-arrow" />}
    </button>
  );
}

// Accepts API messages too: they are shown translated when the dictionary knows them.
export function FormError({ message }: { message: string | null }) {
  const { t } = useI18n();
  if (!message) return null;
  // key restarts the shake when a new error replaces the old one.
  return (
    <div key={message} className="auth-error" role="alert">
      <Icon name="alertCircle" /> {translateServer(t, message)}
    </div>
  );
}

// Six single-digit boxes: typing advances, backspace retreats, paste fills them all.
export function OtpInput({ value, onChange, error, disabled, autoFocus = true }: {
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const { t } = useI18n();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");

  function setAt(i: number, d: string) {
    const next = digits.slice();
    next[i] = d;
    onChange(next.join("").slice(0, 6));
  }

  function fill(text: string, from: number) {
    const clean = text.replace(/\D/g, "");
    if (!clean) return;
    const next = digits.slice();
    for (let k = 0; k < clean.length && from + k < 6; k++) next[from + k] = clean[k];
    onChange(next.join(""));
    refs.current[Math.min(from + clean.length, 5)]?.focus();
  }

  return (
    <div className={`auth-otp${error ? " is-error" : ""}`} role="group" aria-label={t.auth.codeGroup}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          className={d ? "is-filled" : undefined}
          style={{ "--i": i } as React.CSSProperties}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={t.auth.digit(i + 1)}
          maxLength={6}
          value={d}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            if (v.length > 1) return fill(v, i);
            setAt(i, v);
            if (v && i < 5) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !d && i > 0) {
              refs.current[i - 1]?.focus();
              setAt(i - 1, "");
              e.preventDefault();
            } else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            else if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            fill(e.clipboardData.getData("text"), i);
          }}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}

export function useCountdown() {
  const [left, setLeft] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  function start(seconds: number) {
    window.clearInterval(timer.current);
    setLeft(seconds);
    timer.current = window.setInterval(() => {
      setLeft((s) => {
        if (s <= 1) window.clearInterval(timer.current);
        return Math.max(0, s - 1);
      });
    }, 1000);
  }
  return { left, start };
}

export function ResendButton({ onResend, countdown }: {
  onResend: () => void;
  countdown: ReturnType<typeof useCountdown>;
}) {
  const { t } = useI18n();
  return (
    <p className="auth-resend muted">
      {t.auth.verify.didntGet}{" "}
      <button type="button" className="auth-link" data-no-loader disabled={countdown.left > 0}
              onClick={onResend}>
        {countdown.left > 0 ? t.auth.verify.resendIn(countdown.left) : t.auth.verify.resend}
      </button>
    </p>
  );
}
