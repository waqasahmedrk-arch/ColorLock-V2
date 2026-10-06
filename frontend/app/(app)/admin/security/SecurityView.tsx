"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { admin, type AuditEntry, type LoginEvent } from "@/lib/admin";
import { DeviceText, Empty, ErrorState, useAdmin } from "../ui";

type Tab = "events" | "failed" | "audit";
const TABS: Tab[] = ["events", "failed", "audit"];

export default function SecurityView({ initialTab }: { initialTab: Tab }) {
  const { a, ago, date, message } = useAdmin();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [events, setEvents] = useState<LoginEvent[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      if (tab === "audit") setAudit(await admin.audit(200));
      else setEvents(await admin.loginEvents(tab === "failed", 200));
      setError(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }, [tab, message]);

  useEffect(() => {
    load();
    window.history.replaceState(null, "", tab === "events" ? "/admin/security" : `/admin/security?tab=${tab}`);
  }, [load, tab]);

  const rows = tab === "audit" ? audit : events;

  return (
    <>
      <div className="adm-head">
        <div>
          <p className="adm-eyebrow"><Icon name="shield" /> {a.nav.security}</p>
          <h1>{a.securityTitle}</h1>
          <p className="lead">{a.securityLead}</p>
        </div>
        <button type="button" className="adm-btn" data-no-loader onClick={load} disabled={busy}>
          <Icon name="reset" className={busy ? "spin" : undefined} /> {a.refresh}
        </button>
      </div>

      <div className="adm-tabs adm-rise" role="tablist">
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" className="adm-tab" data-no-loader aria-selected={tab === k}
                  onClick={() => { setTab(k); if (k !== "audit") setEvents(null); }}>
            <Icon name={k === "audit" ? "crown" : k === "failed" ? "alert" : "logIn"} /> {a.tabs[k]}
          </button>
        ))}
      </div>

      {error && !rows && <ErrorState text={error} onRetry={load} />}
      {!rows && !error && <div className="adm-card adm-table-skeleton" aria-busy="true"><i /><i /><i /><i /><i /></div>}

      {tab !== "audit" && events && (
        <section className={`adm-card adm-table-card adm-rise${busy ? " is-loading" : ""}`}>
          {events.length === 0 ? <Empty icon="check" title={tab === "failed" ? a.noFailed : a.noEvents} /> : (
            <div className="adm-table-scroll">
              <table className="adm-table">
                <thead><tr><th>{a.when}</th><th>{a.account}</th><th>{a.result}</th><th>{a.where}</th><th>{a.device}</th><th>{a.ip}</th></tr></thead>
                <tbody>
                  {events.map((e, i) => (
                    <tr key={e.id} style={{ "--i": Math.min(i, 20) } as React.CSSProperties}>
                      <td title={date(e.created_at, true)}>{ago(e.created_at)}</td>
                      <td>{e.user_id ? <Link href={`/admin/users/${e.user_id}`}>{e.email}</Link> : <span className="muted">{e.email}</span>}</td>
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
      )}

      {tab === "audit" && audit && (
        <section className={`adm-card adm-table-card adm-rise${busy ? " is-loading" : ""}`}>
          {audit.length === 0 ? <Empty icon="shield" title={a.noAudit} /> : (
            <div className="adm-table-scroll">
              <table className="adm-table">
                <thead><tr><th>{a.when}</th><th>{a.action}</th><th>{a.account}</th><th>{a.by}</th></tr></thead>
                <tbody>
                  {audit.map((e, i) => (
                    <tr key={e.id} style={{ "--i": Math.min(i, 20) } as React.CSSProperties}>
                      <td title={date(e.created_at, true)}>{ago(e.created_at)}</td>
                      <td><strong>{a.audit(e.action, e.detail)}</strong></td>
                      <td>{e.target_id && e.action !== "delete"
                        ? <Link href={`/admin/users/${e.target_id}`}>{e.target_email}</Link>
                        : <span className="muted">{e.target_email ?? a.none}</span>}</td>
                      <td className="muted">{e.admin_email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
