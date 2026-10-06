// Client for the signed-in user's score history (/history). Uses the session cookie.

import { PUBLIC_API_BASE, type Problem, type ScoreResult } from "@/lib/api";

export interface HistoryRecord {
  id: string;
  score_id: string;
  created_at: string; // ISO 8601, UTC
  filename: string | null;
  name: string | null; // the user's label; records saved before names existed have none
  result: ScoreResult;
}

// xlsx: every measured value plus an "About" sheet, for research use.
export type ExportFormat = "csv" | "json" | "xlsx";

export interface HistoryStats {
  count: number;
  qc_pass_count: number;
  best_delta_e00: number | null;
  mean_delta_e00: number | null;
}

export interface HistoryPage {
  items: HistoryRecord[];
  total: number;
  offset: number;
  limit: number;
  stats: HistoryStats;
}

export class HistoryError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, method = "GET"): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${PUBLIC_API_BASE}/history${path}`, { method, credentials: "include", cache: "no-store" });
  } catch {
    throw new HistoryError(0, "Can't reach the server. Is the API running?");
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const p = body as Problem | null;
    throw new HistoryError(res.status, p?.detail ?? p?.title ?? res.statusText);
  }
  return body as T;
}

export const history = {
  // `q` filters by score name (case-insensitive substring); `since` (inclusive) / `until`
  // (exclusive) are ISO instants for the date range. Stats stay whole-history.
  list: (offset: number, limit: number, q = "", range: { since?: string; until?: string } = {}) => {
    const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    if (q.trim()) params.set("q", q.trim());
    if (range.since) params.set("since", range.since);
    if (range.until) params.set("until", range.until);
    return call<HistoryPage>(`?${params}`);
  },
  get: (id: string) => call<HistoryRecord>(`/${encodeURIComponent(id)}`),
  nameAvailable: (name: string) =>
    call<{ name: string; available: boolean }>(`/name-available?name=${encodeURIComponent(name)}`),
  remove: (id: string) => call<void>(`/${encodeURIComponent(id)}`, "DELETE"),
  clear: () => call<void>("", "DELETE"),
  // Downloads the whole history as a file named by the API (colorlock-history-<date>.<ext>).
  download: async (format: ExportFormat) => {
    let res: Response;
    try {
      res = await fetch(`${PUBLIC_API_BASE}/history/export?format=${format}`,
                        { credentials: "include", cache: "no-store" });
    } catch {
      throw new HistoryError(0, "Can't reach the server. Is the API running?");
    }
    if (!res.ok) {
      const p = (await res.json().catch(() => null)) as Problem | null;
      throw new HistoryError(res.status, p?.detail ?? p?.title ?? res.statusText);
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1]
      ?? `colorlock-history.${format}`;
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
