// Typed client for the ColourLock API (claude/specs.md §7).

// On Vercel the API is a service on the same domain under /api (vercel.json), so the browser
// calls it relative to the page. Vercel sets NEXT_PUBLIC_VERCEL_ENV on every deployment.
const ON_VERCEL = Boolean(process.env.NEXT_PUBLIC_VERCEL_ENV);
export const PUBLIC_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? (ON_VERCEL ? "/api/v1" : "http://localhost:8000/api/v1");
// Server components may reach the API on an internal address, and need an absolute URL:
// on Vercel, the production domain (or this deployment's own URL for previews).
const VERCEL_HOST = process.env.NEXT_PUBLIC_VERCEL_ENV === "production"
  ? process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ?? process.env.NEXT_PUBLIC_VERCEL_URL
  : process.env.NEXT_PUBLIC_VERCEL_URL;
export const SERVER_API_BASE = process.env.API_INTERNAL_BASE_URL
  ?? (PUBLIC_API_BASE.startsWith("/") && VERCEL_HOST ? `https://${VERCEL_HOST}${PUBLIC_API_BASE}` : PUBLIC_API_BASE);

export type ModelKey = "flux" | "sdxl";
export const MODELS: { key: ModelKey; label: string }[] = [
  { key: "flux", label: "FLUX.1-schnell" },
  { key: "sdxl", label: "SDXL base 1.0" },
];
export const modelLabel = (m: string) => MODELS.find((x) => x.key === m)?.label ?? m;

export type Lab = [number, number, number];

export interface Target {
  id: string;
  name: string;
  hex: string;
  lab: Lab;
  chroma: number;
  anchor_object: string;
}

export interface PromptStyle {
  id: string;
  code: string;
  description: string;
  example_target_id: string;
  example_prompt: string;
}

export interface StudyGroup {
  model: ModelKey;
  target_id: string;
  style: string;
  n: number;
  n_qc_pass: number;
  qc_pass_rate: number;
  low_n: boolean;
  accuracy_mean: number | null;
  accuracy_sd: number | null;
  accuracy_yield_pct: number | null;
  consistency_mean: number | null;
  consistency_sd: number | null;
  consistency_yield_pct: number | null;
  chroma_dev_target_mean: number | null;
  flat_p95_de_median: number | null;
}

export interface PerModelCounts {
  n_images_qc_pass: number;
  n_groups: number;
  n_groups_ge_10: number;
}

export interface Hypothesis {
  id: string;
  name: string;
  test: string;
  statistic: number | null;
  p_value: number | null;
  direction: string;
  notes: string;
  extra: {
    sample_guard?: { n_images: number; n_groups: number; n_groups_ge_10: number; reliable: boolean };
    per_model?: Record<ModelKey, PerModelCounts>;
  };
}

export interface Disclosure {
  id: number;
  title: string;
  text: string;
}

export interface StudyImage {
  image_id: string;
  model: ModelKey;
  target_id: string;
  style: string;
  slot: number;
  seed_used: number;
  delta_e00: number;
  flat_p95_de: number;
  qc_pass: boolean;
  chroma_sample: number;
  chroma_reference: number;
  chroma_delta: number;
  consistency_de00: number | null;
  kept_pct: number;
  sample_lab: Lab;
  sample_hex: string;
  image_url: string;
}

export interface StudyImageDetail extends StudyImage {
  prompt_hash: string;
  generated_at: string | null;
  prompt: string;
  negative_prompt: string | null;
  generation: Record<string, string | number | boolean>;
}

export interface StudyImagePage {
  items: StudyImage[];
  total: number;
  page: number;
  page_size: number;
}

export interface ScoreResult {
  score_id: string;
  name?: string | null; // the user's label, when the score was saved to their history
  target: { id: string; name: string; hex: string; lab: Lab };
  sample_lab: Lab;
  sample_hex: string;
  delta_e00: number;
  flat_p95_de: number;
  qc: { pass: boolean; threshold: number };
  chroma: { sample: number; reference: number; delta: number };
  kept_pct: number;
  warnings: string[];
  package_version: string;
  explain?: ScoreExplain | null; // only when the request asked for it
}

// Display-only diagnostics for one score (POST /score with explain=true).
export interface ScoreExplain {
  width: number;
  height: number;
  crop_box: [number, number, number, number]; // x0, y0, x1, y1 in image pixels
  stride: number;
  heatmap_png: string; // data: URI, one pixel per sampled crop pixel
  scale_max: number;
  threshold: number;
  share_over_threshold: number;
  diff: { dL: number; dC: number; dH: number; hue_shift_deg: number | null };
}

export interface BatchItem {
  index: number;
  filename: string | null;
  result: ScoreResult | null;
  error: { title: string; detail: string | null } | null;
}

export interface BatchResponse {
  target: ScoreResult["target"];
  qc_threshold: number;
  package_version: string;
  items: BatchItem[];
}

export interface Provenance {
  package_version: string;
  git_commit: string;
  study_run: string;
  qc: { flat_p95_de_max: number; crop_fraction: number; percentile: number; stride: number };
  models: Record<
    ModelKey,
    { repo_id: string; revision: string; precision: string; steps: number; guidance: number; resolution: number }
  >;
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
}

export class ApiError extends Error {
  constructor(public problem: Problem) {
    super(problem.detail ?? problem.title);
  }
}

async function get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const url = new URL(SERVER_API_BASE + path);
  for (const [k, v] of Object.entries(params ?? {})) if (v) url.searchParams.set(k, v);
  // Signed image URLs expire, so never serve study pages from a stale cache.
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as Problem | null;
    throw new ApiError(problem ?? { type: "about:blank", title: res.statusText, status: res.status });
  }
  return (await res.json()) as T;
}

export const api = {
  targets: () => get<Target[]>("/targets"),
  promptStyles: () => get<PromptStyle[]>("/prompt-styles"),
  provenance: () => get<Provenance>("/provenance"),
  summary: (model?: ModelKey) => get<StudyGroup[]>("/study/summary", { model }),
  hypotheses: () => get<Hypothesis[]>("/study/hypotheses"),
  disclosures: () => get<Disclosure[]>("/study/disclosures"),
  images: (params: Record<string, string | undefined>) =>
    get<StudyImagePage>("/study/images", params),
  image: (id: string) => get<StudyImageDetail>(`/study/images/${encodeURIComponent(id)}`),
};

export function fmt(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined || Number.isNaN(value) ? "—" : value.toFixed(digits);
}

export function fmtP(p: number | null): string {
  if (p === null) return "—";
  if (p < 0.0001) return "p < 0.0001";
  return `p = ${p.toFixed(p < 0.01 ? 4 : 3)}`;
}
