"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { admin, type UserPage, type UserSort, type UserStatus } from "@/lib/admin";
import { Empty, ErrorState, StatusChips, UserCell, useAdmin } from "../ui";

const LIMIT = 15;
const STATUSES: UserStatus[] = ["all", "active", "online", "blocked", "admins", "unverified"];
const SORTS: UserSort[] = ["newest", "oldest", "last_login", "name"];

export default function UsersView({ initialStatus, initialQuery }: { initialStatus: UserStatus; initialQuery: string }) {
  const router = useRouter();
  const { a, ago, date, message } = useAdmin();
  const [query, setQuery] = useState(initialQuery);
  const [q, setQ] = useState(initialQuery); // debounced
  const [status, setStatus] = useState<UserStatus>(initialStatus);
  const [sort, setSort] = useState<UserSort>("newest");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<UserPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => { setQ(query); setOffset(0); }, 280);
    return () => window.clearTimeout(id);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPage(await admin.users({ q, status, sort, offset, limit: LIMIT }));
      setError(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [q, status, sort, offset, message]);

  useEffect(() => { load(); }, [load]);

  // Keep the filter in the URL so a refresh or a shared link shows the same list.
  useEffect(() => {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (q) params.set("q", q);
    const qs = params.toString();
    window.history.replaceState(null, "", `/admin/users${qs ? `?${qs}` : ""}`);
  }, [status, q]);

  const total = page?.total ?? 0;

  return (
    <>
      <div className="adm-head">
        <div>
          <p className="adm-eyebrow"><Icon name="users" /> {a.nav.users}</p>
          <h1>{a.usersTitle}</h1>
          <p className="lead">{a.usersLead}</p>
        </div>
      </div>

      <div className="adm-toolbar adm-rise">
        <label className="adm-search">
          <Icon name="search" />
          <input type="search" value={query} placeholder={a.search} aria-label={a.search}
                 onChange={(e) => setQuery(e.target.value)} />
          {loading && page && <Icon name="loader" className="spin" />}
        </label>
        <label className="adm-select">
          <span>{a.sort}</span>
          <select value={sort} onChange={(e) => { setSort(e.target.value as UserSort); setOffset(0); }}>
            {SORTS.map((s) => <option key={s} value={s}>{a.sorts[s]}</option>)}
          </select>
        </label>
      </div>

      <div className="adm-tabs adm-rise" role="tablist" aria-label={a.usersTitle}>
        {STATUSES.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={status === s} className="adm-tab" data-no-loader
                  onClick={() => { setStatus(s); setOffset(0); }}>
            {a.filters[s]}
          </button>
        ))}
      </div>

      {error && !page && <ErrorState text={error} onRetry={load} />}

      {page && (
        <section className={`adm-card adm-table-card adm-rise${loading ? " is-loading" : ""}`}>
          {page.items.length === 0 ? <Empty icon="users" title={a.noUsers} /> : (
            <div className="adm-table-scroll">
              <table className="adm-table is-hover">
                <thead>
                  <tr>
                    <th>{a.cols.user}</th>
                    <th>{a.cols.status}</th>
                    <th>{a.cols.joined}</th>
                    <th>{a.cols.lastLogin}</th>
                    <th className="num">{a.cols.sessions}</th>
                    <th className="num">{a.cols.scores}</th>
                    <th aria-hidden />
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((u, i) => (
                    <tr key={u.id} style={{ "--i": i } as React.CSSProperties} className={u.is_blocked ? "is-blocked" : undefined}
                        onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) router.push(`/admin/users/${u.id}`); }}>
                      <td><UserCell user={u} href={`/admin/users/${u.id}`} /></td>
                      <td><StatusChips user={u} /></td>
                      <td title={date(u.created_at, true)}>{date(u.created_at)}</td>
                      <td title={u.last_login_at ? date(u.last_login_at, true) : undefined}>{ago(u.last_login_at)}</td>
                      <td className="num">{u.sessions}</td>
                      <td className="num">{u.scores}</td>
                      <td className="adm-row-go"><Icon name="chevronRight" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {total > 0 && (
            <div className="adm-pager">
              <span className="muted">{a.showing(offset + 1, Math.min(offset + LIMIT, total), total)}</span>
              <span>
                <button type="button" className="adm-btn is-icon" data-no-loader aria-label={a.prev} title={a.prev}
                        disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
                  <Icon name="chevronLeft" />
                </button>
                <button type="button" className="adm-btn is-icon" data-no-loader aria-label={a.next} title={a.next}
                        disabled={offset + LIMIT >= total || loading} onClick={() => setOffset(offset + LIMIT)}>
                  <Icon name="chevronRight" />
                </button>
              </span>
            </div>
          )}
        </section>
      )}
      {!page && !error && <div className="adm-card adm-table-skeleton" aria-busy="true"><i /><i /><i /><i /><i /></div>}
    </>
  );
}
