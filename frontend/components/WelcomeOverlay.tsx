"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import { WELCOME_KEY, type User, type WelcomeKind } from "@/lib/auth";

const EXIT_MS = 450; // matches .welcome.is-leaving
const TILES = ["#4169E1", "#DC143C", "#228B22", "#DAA520"];

// Greets the user by name right after they sign in or finish signing up, and stays until
// they press Continue. The login / sign-up forms leave a one-time marker in sessionStorage;
// without it this renders nothing, so ordinary page loads and refreshes never show it.
export default function WelcomeOverlay({ user }: { user: User | null }) {
  const { t, locale } = useI18n();
  const [kind, setKind] = useState<WelcomeKind | null>(null);
  const [leaving, setLeaving] = useState(false);
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let flag: string | null = null;
    try {
      flag = sessionStorage.getItem(WELCOME_KEY);
      sessionStorage.removeItem(WELCOME_KEY);
    } catch {
      return;
    }
    if (user && (flag === "login" || flag === "signup")) setKind(flag);
  }, [user]);

  const close = useCallback(() => {
    setLeaving(true);
    window.setTimeout(() => setKind(null), EXIT_MS);
  }, []);

  useEffect(() => {
    if (!kind) return;
    // Continue has focus, so Enter presses it; Escape is the usual keyboard way out of a dialog.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    continueRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [kind, close]);

  if (!kind || !user) return null;

  const w = t.welcome;
  const hour = new Date().getHours();
  // Local time: 5–11 morning, 12–17 afternoon, otherwise evening.
  const period = hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 18 ? "afternoon" : "evening";
  const greeting = w[period];
  const first = kind === "signup";
  // Latin names read better by first name; Chinese names are shown whole.
  const name = locale === "zh" ? user.name : user.name.split(" ")[0] || user.name;
  const title = first ? w.first(name) : w.back(name);
  const nameStart = title.lastIndexOf(name);

  return (
    <div className={`welcome${leaving ? " is-leaving" : ""}`} role="dialog" aria-modal="true"
         aria-labelledby="welcome-title" aria-describedby={first ? "welcome-text" : undefined}>
      <div className="welcome-glow" aria-hidden>
        {TILES.map((c, i) => <i key={c} style={{ "--c": c, "--i": i } as React.CSSProperties} />)}
      </div>
      <div className="welcome-card">
        <div className="welcome-avatar">
          <span className="welcome-ring" aria-hidden />
          <Avatar name={user.name} src={user.avatar_url} size={96} />
          <span className="welcome-check" aria-hidden><Icon name="check" /></span>
        </div>
        <p className="welcome-greeting" data-period={period}>
          <Icon name={period === "evening" ? "moon" : "sun"} /> {greeting}
        </p>
        <h2 id="welcome-title" aria-label={title}>
          <span aria-hidden>
            {title.slice(0, nameStart)}
            <span className="welcome-name">
              {Array.from(name).map((ch, i) => (
                <span key={i} style={{ "--i": i } as React.CSSProperties}>{ch === " " ? " " : ch}</span>
              ))}
            </span>
            {title.slice(nameStart + name.length)}
          </span>
        </h2>
        {first && <p id="welcome-text" className="welcome-text">{w.subtitleFirst}</p>}
        <button ref={continueRef} type="button" className="welcome-continue" data-no-loader onClick={close}>
          {w.continue} <Icon name="arrowRight" />
        </button>
      </div>
    </div>
  );
}
