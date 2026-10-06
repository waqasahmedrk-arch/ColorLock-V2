"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import CountUp from "@/components/CountUp";
import Icon, { type IconName } from "@/components/Icon";
import { admin, adminAuth, type Stats } from "@/lib/admin";
import ActivityChart from "./ActivityChart";
import { DeviceText, Empty, ErrorState, StatusChips, UserCell, useAdmin } from "./ui";

const REFRESH_MS = 60_000; // auto-refresh while the tab is visible
const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

// A KPI tile. `meter` (0–100) draws a thin bar that fills on load, for values that are a share
// of all accounts.
function Tile({ icon, label, value, hint, tone, href, meter, i }: {
  icon: IconName; label: string; value: number; hint?: string; tone: string; href?: string; meter?: number; i: number;
}) {
  const body = (
    <>
      <span className="adm-tile-top">
        <span className="adm-tile-icon" aria-hidden><Icon name={icon} /></span>
        {href && <Icon name="arrowRight" className="adm-tile-go" />}
      </span>
      <span className="adm-tile-label">{label}</span>
      <strong className="adm-tile-value"><CountUp value={value} /></strong>
      {hint && <span className="adm-tile-hint">{hint}</span>}
      {meter !== undefined && (
        <span className="adm-tile-meter" aria-hidden><i style={{ width: `${Math.max(meter, 2)}%` }} /></span>
      )}
    </>
  );
  const props = { className: "adm-tile", "data-tone": tone, style: { "--i": i } as React.CSSProperties };
  return href ? <Link href={href} {...props}>{body}</Link> : <div {...props}>{body}</div>;
}

export default function Overview() {
  const { a, ago, message } = useAdmin();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [, setTick] = useState(0); // re-renders the "Updated …" stamp

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setStats(await admin.stats());
      setUpdatedAt(new Date().toISOString());
      setError(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }, [message]);

  useEffect(() => {
    load();
    adminAuth.me().then((u) => setMe(u.name.split(" ")[0])).catch(() => undefined);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_MS);
    const tick = window.setInterval(() => setTick((n) => n + 1), 15_000);
    return () => { window.clearInterval(id); window.clearInterval(tick); };
  }, [load]);

  const s = stats;
  const totals = s?.series.reduce(
    (t, d) => ({ logins: t.logins + d.logins, failed: t.failed + d.failed, signups: t.signups + d.signups }),
    { logins: 0, failed: 0, signups: 0 },
  );
  const verifiedPct = s ? pct(s.verified, s.users) : 0;

  return (
    <>
      <section className="adm-hero">
        <div className="adm-hero-text">
          <p className="adm-eyebrow"><Icon name="dashboard" /> {a.nav.overview}</p>
          <h1>{me ? a.greeting(me) : a.nav.overview}</h1>
          <p className="lead">{a.overviewLead}</p>
        </div>
        <div className="adm-hero-side">
          <span className="adm-live" title={a.autoRefresh}>
            <i aria-hidden /> {a.live}
            {updatedAt && <small>· {a.updated(ago(updatedAt))}</small>}
          </span>
          <button type="button" className="adm-btn" data-no-loader onClick={load} disabled={busy}>
            <Icon name="reset" className={busy ? "spin" : undefined} /> {a.refresh}
          </button>
        </div>
      </section>

      {error && !s && <ErrorState text={error} onRetry={load} />}
      {!s && !error && (
        <div className="adm-ov-skeleton" aria-busy="true">
          <div className="adm-tiles">{[0, 1, 2, 3].map((i) => <div key={i} className="adm-tile is-skeleton" />)}</div>
          <div className="adm-ov-grid"><i /><i /></div>
        </div>
      )}

      {s && totals && (
        <>
          <div className="adm-tiles">
            <Tile i={0} icon="users" tone="accent" label={a.stats.users} value={s.users}
                  hint={a.hints.users(s.verified)} href="/admin/users" />
            <Tile i={1} icon="activity" tone="ok" label={a.stats.online} value={s.online}
                  hint={a.hints.online} href="/admin/users?status=online" meter={pct(s.online, s.users)} />
            <Tile i={2} icon="message" tone="violet" label={a.stats.unread} value={s.chat_unread}
                  hint={a.hints.unread(s.chat_waiting)} href="/admin/messages" />
            <Tile i={3} icon="ban" tone="bad" label={a.stats.blocked} value={s.blocked}
                  hint={a.ofUsers(pct(s.blocked, s.users))} href="/admin/users?status=blocked" meter={pct(s.blocked, s.users)} />
          </div>

          <div className="adm-ov-grid">
            <section className="adm-card adm-ov-chart adm-rise">
              <div className="adm-card-head">
                <div>
                  <h2><Icon name="activity" /> {a.chartTitle}</h2>
                  <p className="muted">{a.chartLead}</p>
                </div>
                <dl className="adm-totals" aria-label={a.totals14d}>
                  <div><dt><i className="is-ok" />{a.chartOk}</dt><dd><CountUp value={totals.logins} /></dd></div>
                  <div><dt><i className="is-failed" />{a.chartFailed}</dt><dd><CountUp value={totals.failed} /></dd></div>
                  <div><dt><i className="is-new" />{a.chartSignups}</dt><dd><CountUp value={totals.signups} /></dd></div>
                </dl>
              </div>
              <ActivityChart series={s.series} />
            </section>

            <section className="adm-card adm-health adm-rise">
              <div className="adm-card-head">
                <div>
                  <h2><Icon name="badgeCheck" /> {a.health}</h2>
                  <p className="muted">{a.healthLead}</p>
                </div>
              </div>
              <div className="adm-ring" role="img" aria-label={`${verifiedPct}% ${a.verifiedShare}`}>
                <svg viewBox="0 0 120 120" aria-hidden>
                  <defs>
                    <linearGradient id="adm-ring-grad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#4169e1" />
                      <stop offset="55%" stopColor="#6a4fd8" />
                      <stop offset="100%" stopColor="#b03aa8" />
                    </linearGradient>
                  </defs>
                  <circle className="adm-ring-track" cx="60" cy="60" r={RING_R} />
                  <circle className="adm-ring-fill" cx="60" cy="60" r={RING_R}
                          style={{ "--c": RING_C, strokeDasharray: RING_C, strokeDashoffset: RING_C * (1 - verifiedPct / 100) } as React.CSSProperties} />
                </svg>
                <span><strong><CountUp value={verifiedPct} />%</strong><small>{a.verifiedShare}</small></span>
              </div>
              <ul className="adm-health-list">
                {([
                  ["badgeCheck", a.stats.verified, s.verified],
                  ["mail", a.stats.unverified, s.unverified],
                  ["crown", a.stats.admins, s.admins],
                  ["key", a.stats.sessions, s.active_sessions],
                  ["sparkles", a.stats.signups7d, s.signups_7d],
                  ["logIn", a.stats.logins24h, s.logins_24h],
                  ["alert", a.stats.failed24h, s.failed_24h],
                  ["pipette", a.stats.scores, s.scores],
                ] as [IconName, string, number][]).map(([icon, label, value], i) => (
                  <li key={label} style={{ "--i": i } as React.CSSProperties}
                      data-warn={icon === "alert" && value > 0 ? "" : undefined}>
                    <span className="adm-health-icon" aria-hidden><Icon name={icon} /></span>
                    <span>{label}</span>
                    <strong><CountUp value={value} /></strong>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className="adm-grid-3">
            <section className="adm-card adm-rise">
              <div className="adm-card-head">
                <h2><Icon name="users" /> {a.recentUsers}</h2>
                <Link href="/admin/users" className="adm-link">{a.viewAll} <Icon name="arrowRight" /></Link>
              </div>
              <ul className="adm-list">
                {s.recent_users.map((u, i) => (
                  <li key={u.id} style={{ "--i": i } as React.CSSProperties}>
                    <UserCell user={u} href={`/admin/users/${u.id}`} />
                    <span className="adm-list-side">
                      <StatusChips user={u} compact />
                      <small>{ago(u.created_at)}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="adm-card adm-rise">
              <div className="adm-card-head">
                <h2><Icon name="lock" /> {a.recentFailed}</h2>
                <Link href="/admin/security?tab=failed" className="adm-link">{a.viewAll} <Icon name="arrowRight" /></Link>
              </div>
              {s.recent_failed.length === 0 ? <Empty icon="check" title={a.noFailed} /> : (
                <ul className="adm-fails">
                  {s.recent_failed.map((e, i) => (
                    <li key={e.id} style={{ "--i": i } as React.CSSProperties}>
                      <span className="adm-event-icon is-bad" aria-hidden><Icon name="lock" /></span>
                      <div className="adm-fail-body">
                        <div className="adm-fail-top">
                          {e.user_id
                            ? <Link href={`/admin/users/${e.user_id}`} className="adm-fail-email" title={e.email}>{e.email}</Link>
                            : <span className="adm-fail-email" title={e.email}>{e.email}</span>}
                          <time dateTime={e.created_at}>{ago(e.created_at)}</time>
                        </div>
                        <div className="adm-fail-meta">
                          <span className="adm-chip is-bad">{a.reasons[e.reason] ?? e.reason}</span>
                          <span className="adm-fail-ip" title={e.ip ?? undefined}><Icon name="globe" />{e.ip ?? a.none}</span>
                          <DeviceText ua={e.user_agent} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="adm-card adm-rise">
              <div className="adm-card-head">
                <h2><Icon name="shield" /> {a.recentAudit}</h2>
                <Link href="/admin/security?tab=audit" className="adm-link">{a.viewAll} <Icon name="arrowRight" /></Link>
              </div>
              {s.recent_audit.length === 0 ? <Empty icon="shield" title={a.noAudit} /> : (
                <ul className="adm-list">
                  {s.recent_audit.map((e, i) => (
                    <li key={e.id} style={{ "--i": i } as React.CSSProperties}>
                      <span className="adm-event">
                        <span className="adm-event-icon" aria-hidden><Icon name="shield" /></span>
                        <span className="adm-user-text">
                          <strong>{a.audit(e.action, e.detail)}</strong>
                          <small>
                            {e.target_id && e.action !== "delete"
                              ? <Link href={`/admin/users/${e.target_id}`}>{e.target_email}</Link>
                              : e.target_email} · {e.admin_email}
                          </small>
                        </span>
                      </span>
                      <span className="adm-list-side"><small>{ago(e.created_at)}</small></span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
