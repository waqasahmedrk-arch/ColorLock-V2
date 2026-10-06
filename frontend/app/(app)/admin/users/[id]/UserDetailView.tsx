"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import ConfirmDialog from "@/components/ConfirmDialog";
import Icon, { type IconName } from "@/components/Icon";
import { admin, adminAuth, type UserDetail } from "@/lib/admin";
import { DeviceText, Empty, ErrorState, StatusChips, useAdmin, useToast } from "../../ui";

type Pending = "block" | "signout" | "role" | "delete" | null;

export default function UserDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { a, ago, date, message } = useAdmin();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [ending, setEnding] = useState<string | null>(null);
  const [toastView, toast] = useToast();

  const load = useCallback(async () => {
    try {
      setUser(await admin.user(id));
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, [id, message]);

  useEffect(() => {
    load();
    adminAuth.me().then((u) => setMeId(u.id)).catch(() => undefined);
  }, [load]);

  async function run(action: () => Promise<UserDetail | void>, done: string) {
    setBusy(true);
    try {
      const next = await action();
      if (next) setUser(next);
      toast(done);
      setPending(null);
      setReason("");
    } catch (e) {
      toast(message(e), true);
    } finally {
      setBusy(false);
    }
  }

  async function endSession(sessionId: string) {
    setEnding(sessionId);
    try {
      setUser(await admin.signOutSession(id, sessionId));
      toast(a.toasts.sessionEnded);
    } catch (e) {
      toast(message(e), true);
    } finally {
      setEnding(null);
    }
  }

  if (error && !user) return <><BackLink label={a.back} /><ErrorState text={error} onRetry={load} /></>;
  if (!user) return <><BackLink label={a.back} /><div className="adm-card adm-profile-skeleton" aria-busy="true" /></>;

  const self = user.id === meId;
  const f = a.fields;
  const profile: [IconName, string, React.ReactNode][] = [
    ["mail", f.email, <a key="e" href={`mailto:${user.email}`}>{user.email}</a>],
    ["phone", f.phone, user.phone ?? a.none],
    ["briefcase", f.job, user.job_title ?? a.none],
    ["user", f.gender, user.gender ? a.genders[user.gender] ?? user.gender : a.none],
    ["calendar", f.dob, user.date_of_birth ? date(`${user.date_of_birth}T00:00:00`) : a.none],
    ["globe", f.language, user.language ? a.languages[user.language] ?? user.language : a.none],
    ["clock", f.joined, date(user.created_at, true)],
    ["badgeCheck", f.verified, user.verified_at ? date(user.verified_at, true) : a.notVerified],
    ...(user.is_admin || user.selfie_at
      ? [["camera", f.selfie, user.selfie_at ? date(user.selfie_at, true) : a.noSelfie] as [IconName, string, React.ReactNode]]
      : []),
    ["logIn", f.lastLogin, user.last_login_at ? `${date(user.last_login_at, true)} · ${ago(user.last_login_at)}` : a.never],
    ["trophy", f.activity, user.notify_activity ? a.on : a.off],
    ["volume", f.sound, user.notify_sound ? a.on : a.off],
    ["bell", f.notifications, String(user.notifications)],
  ];

  return (
    <>
      <BackLink label={a.back} />

      <section className={`adm-profile adm-rise${user.is_blocked ? " is-blocked" : ""}`}>
        <div className="adm-profile-banner" aria-hidden />
        <div className="adm-profile-body">
          <span className="adm-profile-avatar">
            <Avatar name={user.name} src={user.avatar_url} size={84} />
            {user.online && <i className="adm-online-dot" aria-hidden />}
          </span>
          <div className="adm-profile-who">
            <h1>{user.name}</h1>
            <p className="muted">{user.email}</p>
            <StatusChips user={user} />
          </div>
          <div className="adm-actions">
            {self ? <p className="adm-self-note"><Icon name="info" /> {a.youNote}</p> : (
              <>
                <Link href={`/admin/messages?user=${user.id}`} className="adm-btn is-primary">
                  <Icon name="message" /> {a.actions.message}
                </Link>
                {user.is_blocked ? (
                  <button type="button" className="adm-btn is-ok" data-no-loader disabled={busy}
                          onClick={() => run(() => admin.unblock(user.id), a.toasts.unblocked)}>
                    <Icon name="unlock" /> {a.actions.unblock}
                  </button>
                ) : (
                  <button type="button" className="adm-btn is-danger" data-no-loader disabled={user.is_admin}
                          title={user.is_admin ? a.actions.removeAdmin : undefined} onClick={() => setPending("block")}>
                    <Icon name="ban" /> {a.actions.block}
                  </button>
                )}
                <button type="button" className="adm-btn" data-no-loader disabled={!user.session_list.length}
                        onClick={() => setPending("signout")}>
                  <Icon name="logOut" /> {a.actions.signOutAll}
                </button>
                <button type="button" className="adm-btn" data-no-loader
                        disabled={!user.is_admin && (user.is_blocked || !user.is_verified)} onClick={() => setPending("role")}>
                  <Icon name="crown" /> {user.is_admin ? a.actions.removeAdmin : a.actions.makeAdmin}
                </button>
                <button type="button" className="adm-btn is-danger is-ghost" data-no-loader disabled={user.is_admin}
                        onClick={() => setPending("delete")}>
                  <Icon name="trash" /> {a.actions.delete}
                </button>
              </>
            )}
          </div>
        </div>
        {user.is_blocked && (
          <div className="adm-blocked">
            <Icon name="ban" />
            <span>
              <strong>{a.blockedBanner(user.blocked_at ? ago(user.blocked_at) : "")}</strong>
              {user.blocked_reason && <span>{a.blockedReason(user.blocked_reason)}</span>}
            </span>
          </div>
        )}
      </section>

      <div className="adm-grid-2">
        <section className="adm-card adm-rise">
          <div className="adm-card-head"><h2><Icon name="user" /> {a.sections.profile}</h2></div>
          <dl className="adm-dl">
            {profile.map(([icon, label, value]) => (
              <div key={label}>
                <dt><Icon name={icon} /> {label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="adm-card adm-rise">
          <div className="adm-card-head"><h2><Icon name="shield" /> {a.sections.security}</h2></div>
          <div className="adm-sec-stats">
            {([
              ["key", a.secStats.sessions, user.sessions, false],
              ["monitor", a.secStats.devices, user.known_devices, false],
              ["alert", a.secStats.failed24h, user.failed_logins_24h, user.failed_logins_24h > 0],
              ["lock", a.secStats.failedTotal, user.failed_logins_total, user.failed_logins_total >= 5],
            ] as [IconName, string, number, boolean][]).map(([icon, label, value, warn]) => (
              <div key={label} className={warn ? "is-warn" : undefined}>
                <Icon name={icon} />
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <dl className="adm-dl">
            <div><dt><Icon name="lock" /> {f.password}</dt><dd className="muted">{a.passwordValue}</dd></div>
            <div><dt><Icon name="globe" /> {f.lastIp}</dt><dd className="mono">{user.last_ip ?? a.none}</dd></div>
            <div><dt><Icon name="message" /> {f.messages}</dt><dd>
              {user.messages}{" "}
              {user.messages > 0 && <Link href={`/admin/messages?user=${user.id}`} className="adm-link">{a.actions.message} <Icon name="arrowRight" /></Link>}
            </dd></div>
            <div><dt><Icon name="pipette" /> {a.cols.scores}</dt><dd>{user.scores}</dd></div>
          </dl>
        </section>
      </div>

      <section className="adm-card adm-rise">
        <div className="adm-card-head"><h2><Icon name="key" /> {a.sections.sessions}</h2></div>
        {user.session_list.length === 0 ? <Empty icon="shield" title={a.noSessions} /> : (
          <ul className="adm-sessions">
            {user.session_list.map((s, i) => (
              <li key={s.id} style={{ "--i": i } as React.CSSProperties}>
                <DeviceText ua={s.user_agent} />
                <span className="mono muted">{s.ip ?? a.none}</span>
                <span className="muted">{a.started} {ago(s.created_at)}</span>
                <span className="muted">{a.lastActive} {ago(s.last_seen_at)}</span>
                {!self && (
                  <button type="button" className="adm-btn is-small" data-no-loader disabled={ending === s.id}
                          onClick={() => endSession(s.id)}>
                    <Icon name={ending === s.id ? "loader" : "logOut"} className={ending === s.id ? "spin" : undefined} /> {a.endSession}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="adm-card adm-table-card adm-rise">
        <div className="adm-card-head"><h2><Icon name="history" /> {a.sections.history}</h2></div>
        {user.login_events.length === 0 ? <Empty icon="shield" title={a.noEvents} /> : (
          <div className="adm-table-scroll">
            <table className="adm-table">
              <thead><tr><th>{a.when}</th><th>{a.result}</th><th>{a.where}</th><th>{a.device}</th><th>{a.ip}</th></tr></thead>
              <tbody>
                {user.login_events.map((e, i) => (
                  <tr key={e.id} style={{ "--i": i } as React.CSSProperties}>
                    <td title={date(e.created_at, true)}>{ago(e.created_at)}</td>
                    <td><span className={`adm-chip ${e.success ? "is-ok" : "is-bad"}`}>
                      <Icon name={e.success ? "check" : "x"} />{a.reasons[e.reason] ?? e.reason}
                    </span></td>
                    <td><span className={`adm-chip${e.scope === "admin" ? " is-admin" : ""}`}>
                      <Icon name={e.scope === "admin" ? "crown" : "globe"} />{a.scopes[e.scope] ?? e.scope}
                    </span></td>
                    <td><DeviceText ua={e.user_agent} /></td>
                    <td className="mono">{e.ip ?? a.none}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="adm-card adm-rise">
        <div className="adm-card-head"><h2><Icon name="crown" /> {a.sections.audit}</h2></div>
        {user.audit.length === 0 ? <Empty icon="shield" title={a.noAuditUser} /> : (
          <ol className="adm-timeline">
            {user.audit.map((e, i) => (
              <li key={e.id} style={{ "--i": i } as React.CSSProperties}>
                <strong>{a.audit(e.action, e.detail)}</strong>
                <span className="muted">{e.admin_email} · {date(e.created_at, true)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {pending === "block" && (
        <ConfirmDialog icon="ban" title={a.blockTitle(user.name)} text={a.blockText} confirmLabel={a.actions.block}
                       busyLabel={a.blocking} busy={busy} onCancel={() => setPending(null)}
                       onConfirm={() => run(() => admin.block(user.id, reason.trim()), a.toasts.blocked)}>
          <label className="adm-reason">
            <span>{a.blockReason}</span>
            <textarea rows={2} maxLength={255} value={reason} placeholder={a.blockReasonPh}
                      onChange={(e) => setReason(e.target.value)} />
          </label>
        </ConfirmDialog>
      )}
      {pending === "signout" && (
        <ConfirmDialog icon="logOut" title={a.signOutTitle} text={a.signOutText} confirmLabel={a.actions.signOutAll}
                       busyLabel={a.signingOut} busy={busy} onCancel={() => setPending(null)}
                       onConfirm={() => run(() => admin.signOutAll(user.id), a.toasts.signedOut)} />
      )}
      {pending === "role" && (
        <ConfirmDialog icon="crown" title={user.is_admin ? a.revokeTitle(user.name) : a.grantTitle(user.name)}
                       text={user.is_admin ? a.revokeText : a.grantText}
                       confirmLabel={user.is_admin ? a.actions.removeAdmin : a.actions.makeAdmin}
                       busyLabel={a.saving} busy={busy} onCancel={() => setPending(null)}
                       onConfirm={() => run(() => admin.setRole(user.id, !user.is_admin),
                                            user.is_admin ? a.toasts.revoked : a.toasts.granted)} />
      )}
      {pending === "delete" && (
        <ConfirmDialog icon="trash" title={a.deleteTitle(user.name)} text={a.deleteText} confirmLabel={a.actions.delete}
                       busyLabel={a.deleting} busy={busy} onCancel={() => setPending(null)}
                       onConfirm={() => run(async () => {
                         await admin.remove(user.id);
                         router.replace("/admin/users");
                       }, a.toasts.deleted)} />
      )}
      {toastView}
    </>
  );
}

function BackLink({ label }: { label: string }) {
  return <p className="adm-back-link"><Link href="/admin/users"><Icon name="arrowLeft" /> {label}</Link></p>;
}
