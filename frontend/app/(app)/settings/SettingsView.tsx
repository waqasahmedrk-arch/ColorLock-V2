"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useI18n } from "@/components/I18nProvider";
import Icon, { type IconName } from "@/components/Icon";
import { AuthError, auth, type LoginSession } from "@/lib/auth";
import { describeDevice } from "@/lib/device";
import { history, HistoryError, type ExportFormat } from "@/lib/history";
import { NotificationError, notifications } from "@/lib/notifications";
import { LOCALE_COOKIE, htmlLang, translateServer, type Locale } from "@/lib/i18n";
import { SOUND_CHANGED, playChime, setSoundEnabled } from "@/lib/sound";
import DeleteAccountDialog from "./DeleteAccountDialog";

type Theme = "light" | "dark" | "system";
type Pending = "others" | "clear" | "delete" | null;

const THEME_KEY = "theme"; // same key as components/ThemeToggle.tsx
const THEMES: Theme[] = ["light", "dark", "system"];
const LANGS: { locale: Locale; label: string }[] = [
  { locale: "en", label: "English" },
  { locale: "zh", label: "繁體中文" },
];

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  try {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);
  return [toast, setToast] as const;
}

function Section({ id, icon, title, children, danger }: {
  id: string; icon: IconName; title: string; children: React.ReactNode; danger?: boolean;
}) {
  return (
    <section id={id} className={`settings-card${danger ? " is-danger" : ""}`}>
      <h2><span className="settings-card-icon" aria-hidden><Icon name={icon} /></span>{title}</h2>
      {children}
    </section>
  );
}

export default function SettingsView() {
  const router = useRouter();
  const { t, locale, lang } = useI18n();
  const s = t.settings;
  const [theme, setTheme] = useState<Theme>("system");
  const [langBusy, setLangBusy] = useState<Locale | null>(null);
  const [sessions, setSessions] = useState<LoginSession[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useToast();
  const [activity, setActivity] = useState<boolean | null>(null);
  const [activityBusy, setActivityBusy] = useState(false);
  const [sound, setSound] = useState<boolean | null>(null);
  const [soundBusy, setSoundBusy] = useState(false);

  const fail = useCallback((e: unknown) => {
    const err = e as AuthError | HistoryError | NotificationError;
    if (err.status === 401) return window.location.replace("/login?next=/settings");
    setError(translateServer(t, err.message));
  }, [t]);

  const loadSessions = useCallback(() => auth.sessions().then(setSessions).catch(fail), [fail]);

  useEffect(() => {
    setTheme(readTheme());
    loadSessions();
    history.list(0, 1).then((p) => setCount(p.total)).catch(fail);
    notifications.preferences().then((p) => {
      setActivity(p.activity);
      setSound(p.sound);
      setSoundEnabled(p.sound);
    }).catch(fail);
    // The bell's quick toggle changes it too.
    const onSound = (e: Event) => setSound((e as CustomEvent<{ on: boolean }>).detail.on);
    window.addEventListener(SOUND_CHANGED, onSound);
    return () => window.removeEventListener(SOUND_CHANGED, onSound);
  }, [loadSessions, fail]);

  async function toggleSound() {
    if (sound === null) return;
    setSoundBusy(true);
    try {
      const on = (await notifications.setPreferences({ sound: !sound })).sound;
      setSound(on);
      setSoundEnabled(on);
      if (on) playChime("notification", true);
      setToast(s.notifSaved);
    } catch (e) {
      fail(e);
    } finally {
      setSoundBusy(false);
    }
  }

  async function toggleActivity() {
    if (activity === null) return;
    setActivityBusy(true);
    try {
      setActivity((await notifications.setPreferences({ activity: !activity })).activity);
      setToast(s.notifSaved);
    } catch (e) {
      fail(e);
    } finally {
      setActivityBusy(false);
    }
  }

  const relative = useCallback((iso: string | null) => {
    if (!iso) return s.justNow;
    const secs = (new Date(iso).getTime() - Date.now()) / 1000;
    if (Math.abs(secs) < 60) return s.justNow;
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
    for (const [unit, size] of [["year", 31536000], ["month", 2592000], ["day", 86400],
      ["hour", 3600], ["minute", 60]] as const) {
      if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
    }
    return s.justNow;
  }, [lang, s.justNow]);

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric" });

  function chooseTheme(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  async function chooseLanguage(next: Locale) {
    if (next === locale || langBusy) return;
    setLangBusy(next);
    setError(null);
    try {
      await auth.setLanguage(next);
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = htmlLang(next);
      router.refresh();
      setToast(t.settings.languageSaved);
    } catch (e) {
      fail(e);
    } finally {
      setLangBusy(null);
    }
  }

  async function signOutOne(id: string) {
    setRemoving(id);
    setError(null);
    try {
      await auth.signOutSession(id);
      setSessions((list) => list?.filter((x) => x.id !== id) ?? null);
      setToast(s.signedOutOne);
    } catch (e) {
      fail(e);
    } finally {
      setRemoving(null);
    }
  }

  async function exportAs(format: ExportFormat) {
    setExporting(format);
    setError(null);
    try {
      await history.download(format);
      setToast(s.exported);
    } catch (e) {
      fail(e);
    } finally {
      setExporting(null);
    }
  }

  async function confirm() {
    if (pending === "delete" && !password) return setPwError(s.errPassword);
    setBusy(true);
    setError(null);
    try {
      if (pending === "others") {
        await auth.signOutOthers();
        await loadSessions();
        setToast(s.signedOutOthers);
      } else if (pending === "clear") {
        await history.clear();
        setCount(0);
        setToast(s.cleared);
      } else if (pending === "delete") {
        await auth.deleteAccount(password);
        return window.location.replace("/signup");
      }
      setPending(null);
    } catch (e) {
      const err = e as AuthError;
      if (pending === "delete" && err.status === 400) {
        setPwError(err.message);
        setPassword("");
      } else {
        setPending(null);
        fail(e);
      }
    } finally {
      setBusy(false);
    }
  }

  function closeDialog() {
    setPending(null);
    setPassword("");
    setPwError(null);
  }

  const others = sessions?.filter((x) => !x.current).length ?? 0;

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label={s.title}>
        {([["appearance", "sun"], ["notifications", "bell"], ["security", "shield"], ["data", "file"], ["danger", "trash"]] as const)
          .map(([id, icon]) => (
            <a key={id} href={`#${id}`} className={id === "danger" ? "is-danger" : undefined}>
              <Icon name={icon} /> {s.nav[id]}
            </a>
          ))}
      </nav>

      <div className="settings-main">
        {error && (
          <div className="auth-error" role="alert"><Icon name="alertCircle" /> {error}</div>
        )}

        <Section id="appearance" icon="sun" title={s.appearanceTitle}>
          <div className="settings-row is-stacked">
            <div className="settings-row-text">
              <h3>{s.theme}</h3>
              <p className="muted">{s.themeHint}</p>
            </div>
            <div className="settings-themes" role="radiogroup" aria-label={s.theme}>
              {THEMES.map((th) => (
                <button key={th} type="button" role="radio" aria-checked={theme === th} data-no-loader
                        className="settings-theme" data-theme-option={th} onClick={() => chooseTheme(th)}>
                  <span className="settings-theme-preview" aria-hidden>
                    <i /><i /><i />
                  </span>
                  <span className="settings-theme-label">
                    {theme === th && <Icon name="check" />} {s.themes[th]}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="settings-row is-stacked">
            <div className="settings-row-text">
              <h3>{s.language}</h3>
              <p className="muted">{s.languageHint}</p>
            </div>
            <div className="settings-choices" role="radiogroup" aria-label={s.language}>
              {LANGS.map((l) => (
                <button key={l.locale} type="button" role="radio" aria-checked={locale === l.locale}
                        lang={htmlLang(l.locale)} data-no-loader className="settings-choice"
                        disabled={!!langBusy} onClick={() => chooseLanguage(l.locale)}>
                  <Icon name={langBusy === l.locale ? "loader" : "globe"}
                        className={langBusy === l.locale ? "spin" : undefined} />
                  {l.label}
                  {locale === l.locale && <Icon name="check" className="settings-choice-check" />}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section id="notifications" icon="bell" title={s.notifTitle}>
          <div className="settings-row">
            <div className="settings-row-text">
              <h3>{s.notifSecurity}</h3>
              <p className="muted">{s.notifSecurityHint}</p>
            </div>
            <span className="settings-always"><Icon name="lock" /> {s.notifAlwaysOn}</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <h3 id="notif-activity">{s.notifActivity}</h3>
              <p className="muted">{s.notifActivityHint}</p>
            </div>
            <button type="button" role="switch" className="settings-switch" data-no-loader
                    aria-checked={activity ?? false} aria-labelledby="notif-activity"
                    disabled={activity === null || activityBusy} onClick={toggleActivity}>
              <span className="settings-switch-thumb" />
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <h3 id="notif-sound"><Icon name={sound === false ? "volumeOff" : "volume"} /> {s.notifSound}</h3>
              <p className="muted">{s.notifSoundHint}</p>
            </div>
            <div className="settings-sound">
              <button type="button" className="settings-link settings-sound-test" data-no-loader
                      onClick={() => playChime("notification", true)}>
                {s.notifSoundTest}
              </button>
              <button type="button" role="switch" className="settings-switch" data-no-loader
                      aria-checked={sound ?? false} aria-labelledby="notif-sound"
                      disabled={sound === null || soundBusy} onClick={toggleSound}>
                <span className="settings-switch-thumb" />
              </button>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <h3>{s.notifInbox}</h3>
              <p className="muted">{s.notifInboxHint}</p>
            </div>
            <Link href="/notifications" className="settings-link">
              {s.notifOpen} <Icon name="arrowRight" />
            </Link>
          </div>
        </Section>

        <Section id="security" icon="shield" title={s.securityTitle}>
          <div className="settings-row">
            <div className="settings-row-text">
              <h3>{s.password}</h3>
              <p className="muted">{s.passwordHint}</p>
            </div>
            <Link href="/change-password" className="settings-btn">
              <Icon name="key" /> {s.changePassword}
            </Link>
          </div>
          <div className="settings-row is-stacked">
            <div className="settings-row-head">
              <div className="settings-row-text">
                <h3>{s.devices}</h3>
                <p className="muted">{s.devicesHint}</p>
              </div>
              {others > 0 && (
                <button type="button" className="settings-btn" data-no-loader onClick={() => setPending("others")}>
                  <Icon name="logOut" /> {s.signOutOthers}
                </button>
              )}
            </div>
            {sessions === null ? (
              <div className="settings-skeleton" aria-busy="true"><i /><i /></div>
            ) : (
              <ul className="settings-devices">
                {sessions.map((x, i) => {
                  const d = describeDevice(x.user_agent);
                  return (
                    <li key={x.id} className={x.current ? "is-current" : undefined}
                        style={{ "--i": i } as React.CSSProperties}>
                      <span className="settings-device-icon" aria-hidden>
                        <Icon name={d?.mobile ? "smartphone" : "monitor"} />
                      </span>
                      <div className="settings-device-text">
                        <strong>
                          {d ? s.on(d.browser, d.os) : s.unknownDevice}
                          {x.current && <span className="badge ok">{s.thisDevice}</span>}
                        </strong>
                        <span className="muted">
                          {[x.ip, s.lastActive(relative(x.last_seen_at)), s.signedInOn(date(x.created_at))]
                            .filter(Boolean).join(" · ")}
                        </span>
                      </div>
                      {!x.current && (
                        <button type="button" className="settings-btn is-small" data-no-loader
                                disabled={removing === x.id} onClick={() => signOutOne(x.id)}>
                          {removing === x.id ? <Icon name="loader" className="spin" /> : <Icon name="logOut" />}
                          {s.signOut}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Section>

        <Section id="data" icon="file" title={s.dataTitle}>
          <div className="settings-row is-stacked">
            <div className="settings-row-head">
              <div className="settings-row-text">
                <h3>
                  {s.history}
                  {count !== null && <span className="badge">{s.historyCount(count)}</span>}
                </h3>
                <p className="muted">{s.historyHint}</p>
              </div>
              <Link href="/history" className="settings-link">
                {s.viewHistory} <Icon name="arrowRight" />
              </Link>
            </div>
            <div className="settings-actions">
              {(["xlsx", "csv", "json"] as const).map((f) => (
                <button key={f} type="button" className="settings-btn" data-no-loader
                        disabled={!count || !!exporting} onClick={() => exportAs(f)}>
                  <Icon name={exporting === f ? "loader" : "download"} className={exporting === f ? "spin" : undefined} />
                  {exporting === f ? s.exporting : f === "xlsx" ? s.exportExcel : f === "csv" ? s.exportCsv : s.exportJson}
                </button>
              ))}
              <button type="button" className="settings-btn is-danger" data-no-loader disabled={!count}
                      onClick={() => setPending("clear")}>
                <Icon name="trash" /> {s.clearHistory}
              </button>
            </div>
          </div>
        </Section>

        <Section id="danger" icon="trash" title={s.dangerTitle} danger>
          <div className="settings-row">
            <p className="muted settings-danger-text">{s.dangerText}</p>
            <button type="button" className="settings-btn is-solid-danger" data-no-loader
                    onClick={() => setPending("delete")}>
              <Icon name="trash" /> {s.deleteAccount}
            </button>
          </div>
        </Section>
      </div>

      {pending === "others" && (
        <ConfirmDialog icon="logOut" title={s.signOutOthersTitle} text={s.signOutOthersText}
                       confirmLabel={s.signOutOthers} busyLabel={s.signingOut} busy={busy}
                       onConfirm={confirm} onCancel={closeDialog} />
      )}
      {pending === "clear" && (
        <ConfirmDialog icon="trash" title={s.clearTitle} text={s.clearText}
                       confirmLabel={s.clearHistory} busyLabel={s.clearing} busy={busy}
                       onConfirm={confirm} onCancel={closeDialog} />
      )}
      {pending === "delete" && (
        <DeleteAccountDialog password={password} error={pwError} busy={busy}
                             onPassword={(v) => { setPassword(v); setPwError(null); }}
                             scoreCount={count} deviceCount={sessions?.length ?? 1}
                             exporting={exporting === "xlsx"} onExport={() => exportAs("xlsx")}
                             onConfirm={confirm} onCancel={closeDialog} />
      )}

      {toast && (
        <div className="settings-toast" role="status"><Icon name="check" /> {toast}</div>
      )}
    </div>
  );
}
