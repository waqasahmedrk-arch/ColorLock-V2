# Technical specification

> Source of truth for metric behaviour is notebook v15. All **VERIFY** items
> below have been resolved against `notebooks/ColourLock_v15_local.ipynb`
> (2026-09-23). Where this file previously described a simpler algorithm
> than the notebook actually uses, the notebook's version is recorded here.

## 1. Colour science conventions

- Colour space pipeline: sRGB (8-bit) → float [0,1] → CIELAB (D65, 2° observer) via `skimage.color.rgb2lab`.
- Colour difference: CIEDE2000 via `skimage.color.deltaE_ciede2000` (kL = kC = kH = 1).
- Chroma: `C* = sqrt(a*² + b*²)`.
- Targets: 8 CSS3/X11 hex values, converted to Lab via `rgb2lab(hex_to_rgb255(hex)/255)`. Verbatim from notebook Step 2 (`ALL_COLOURS`):

  | id | hex | name |
  |---|---|---|
  | royal_blue | `#4169E1` | royal blue |
  | firebrick_red | `#B22222` | firebrick red |
  | forest_green | `#228B22` | forest green |
  | goldenrod | `#DAA520` | goldenrod |
  | dark_orchid | `#9932CC` | dark orchid purple |
  | sienna_brown | `#A0522D` | sienna brown |
  | teal | `#008080` | teal |
  | crimson | `#DC143C` | crimson |

  (The notebook derives target Lab from the *mean* RGB of a generated placeholder swatch's inner 80%, which for a flat-colour swatch is numerically identical to converting the hex directly — confirmed no divergence.)
- Input normalisation for uploads: apply any embedded ICC profile to convert to sRGB, drop alpha (composite on white only if alpha is present, and flag it), convert to RGB 8-bit.

## 2. Per-image metrics (package: `colourlock.metrics`, `colourlock.qc`, `colourlock.extract`)

There are **two separate "central colour" computations** in the notebook; they are not interchangeable and both must be ported:

| Metric | Definition |
|---|---|
| `crop` | Central 50% crop: `arr[h*0.25:h*0.75, w*0.25:w*0.75]` (25% trimmed each side). Used by both computations below. |
| `sample_lab` | **PCA/KMeans dominant-cluster colour**, not a median. Convert crop pixels to Lab; if pixel count > 20,000, subsample to 20,000 via `np.random.default_rng(GLOBAL_SEED=0).choice(...)`; run `KMeans(n_clusters=4, n_init=4, random_state=0)` on the Lab pixels; pick the **largest cluster by pixel count** (not chroma-weighted — that was reverted in v8/notebook history as an H2 confound); take that cluster's centroid, convert back Lab→RGB→Lab (round-trip, matches notebook `lab2rgb` then `rgb2lab` via the RGB columns written to the manifest). If the crop has fewer than `n_clusters*5` pixels, fall back to the plain mean. Requires **scikit-learn** (`sklearn.cluster.KMeans`) — see conventions.md update. |
| `delta_e00` | ΔE00(sample_lab, target_lab). Accuracy for one image. |
| `flat_p95_de` | A **separate, simpler** computation from `sample_lab` above: convert the crop to Lab, subsample by stride 2 in both axes (`QC_PIXEL_STRIDE=2`, i.e. every other pixel), take the per-channel **median** of that strided Lab array (`flat_median_lab`), then the 95th percentile of ΔE00(pixel_lab, flat_median_lab) over the strided pixels. Lower is flatter. This `flat_median_lab` is QC-only and is never used as `sample_lab`. |
| `qc_pass` | `flat_p95_de <= FLAT_P95_DE_MAX`. |
| `chroma_sample` / `chroma_reference` / `chroma_delta` | C* of `sample_lab` (the KMeans dominant colour, not the QC median), C* of the target chip, and sample − reference. Negative means desaturation (the H2 direction). |
| `kept_pct` | Legacy QC metric, unrelated to `sample_lab`/`flat_p95_de`: sample the 4 corner 15×15 patches as background colour, mask pixels within Euclidean RGB distance 28 of it as background, apply binary closing then opening (5×5 structure), invert to get the foreground mask over the **full image** (not the crop). `kept_pct = 100 * foreground_mask.sum() / mask.size` — percent of pixels classified as non-background (if the mask is empty, it falls back to the whole image). Computed and logged for every image for ablation only; not used for QC gating in the frozen dataset (`QC_METRIC = "flatness"`). |

Configuration (`config/qc.toml`):

```toml
[qc]
flat_p95_de_max = 3.0      # PLACEHOLDER: replace with calibrated Step 7a value
crop_fraction   = 0.5
percentile      = 95
calibration_note = "Chosen from Step 7b visual review on <date>; see decisions.md D-QC"
```

## 3. Group-level metrics (study only: `colourlock.stats`)

- `consistency` for a group (model × colour × style, n = 32 before QC): mean ΔE00 of each QC-passed sample to the group centroid, where **centroid = arithmetic mean Lab** (`pts.mean(axis=0)`, not median) of the QC-passed samples' `sample_lab`.
- `accuracy_mean`: mean `delta_e00` of QC-passed samples.
- SD with `ddof=1`.
- `chroma_dev_from_target` (H2's actual column) = `sample_chroma - target_chroma`, signed. There is a second, descriptive-only column `chroma_dev_from_centroid` (sample chroma − the group's own centroid chroma) that must **not** be used for H2 — testing deviation from a group's own mean is guaranteed to be non-significant by construction (this was v7's bug, fixed in v8).
- H1: Spearman correlation of `accuracy_mean` vs `consistency_mean` across all (model × colour × style) groups. **The notebook rounds `summary_df` to 2dp before this correlation** (a side effect of `summary_df = pd.DataFrame(summary_rows).round(2)` being computed once and reused everywhere downstream); without replicating that rounding the rho/p values are close but measurably off (0.2764/0.0630 vs the notebook's printed 0.279/0.0604). Round to 2dp immediately before the correlation, not in `group_summary()` itself (other callers want full precision).
- H2: one-sided Wilcoxon signed-rank on `chroma_dev_from_target` (alternative: median < 0, i.e. systematically desaturated vs the reference chip).
- H3: Levene test + Kruskal–Wallis across the five prompt styles on the `dE00_to_centroid` (consistency) distribution, styles with < 3 samples excluded from the test.
- Guard rail (port this too): before reporting H1–H3, check total QC-passed n and count of groups with n≥10; below a floor (notebook uses `n<100` images or `<5` groups with n≥10) label results as unreliable/smoke-test rather than findings. **This dataset does NOT trip that floor overall (772 images, 33/46 groups ≥10) but the 33 are almost entirely FLUX — see decisions.md D-16: SDXL has 0 groups with n≥10.** Report per-model group counts alongside any pooled statistic.

These functions run offline on the study dataset. The API serves their stored outputs.

## 4. Generation parameters (must match the study)

| Param | FLUX.1-schnell | SDXL base 1.0 |
|---|---|---|
| Repo | `black-forest-labs/FLUX.1-schnell` (gated) | `stabilityai/stable-diffusion-xl-base-1.0` |
| Revision | full sha from `config/models.toml` | full sha from `config/models.toml` |
| Precision | study value (bf16 or fp8_layerwise; **VERIFY**) | fp16, `variant="fp16"` |
| Steps | 4 | 30 |
| Guidance | 0.0 | CFG 7.0 |
| Negative prompt | none (not supported) | study negative prompt (length-checked) |
| Resolution | 512 × 512 | 512 × 512 |
| Seed | `slot_i + attempt * 1000` in the study; user-provided or random in the app | same |
| Generator | `torch.Generator(device="cuda").manual_seed(seed)` (**VERIFY** device) | same |

Anything that deviates is saved with `off_study = true`.

`config/models.toml`:

```toml
[flux]
repo_id   = "black-forest-labs/FLUX.1-schnell"
revision  = "<full 40-char sha>"
precision = "bf16"            # or "fp8_layerwise"
[sdxl]
repo_id   = "stabilityai/stable-diffusion-xl-base-1.0"
revision  = "<full 40-char sha>"
precision = "fp16"
use_negative_prompt = true
```

## 5. Prompt construction (`colourlock.prompts`)

- Five styles, per-colour description templates (notebook `colour_descs`), given colour `{hex, colour_name, anchor_object}` and its Lab `[L,a,b]`:
  - `A_hex_only`: `colour HEX #{hex}`
  - `B_named_hex`: `colour {colour_name}, HEX #{hex}`
  - `C_reference_anchor`: `a colour matching {anchor_object}, a {colour_name} shade`
  - `D_explicit_cielab`: `colour at CIELAB L={L:.1f} a={a:.1f} b={b:.1f} ({colour_name})`
  - `E_name_only`: `colour {colour_name}`
- Full prompt = `", ".join(PROMPT_HEAD + [f"pure uniform {colour_desc}"] + PROMPT_TAIL_USED)` where:
  - `PROMPT_HEAD = ["flat matte solid colour fill", "no gradient", "no vignette", "no shadows", "no lighting falloff"]` (always included, front-loaded).
  - `PROMPT_TAIL_USED` is the **actual clause set frozen for this dataset** (6 of 14 candidates, fit greedily against the CLIP budget using the single worst-case colour spec across the whole run): `["filling the entire image edge to edge", "no texture", "no pattern", "no object", "no garment", "no border"]`. This is a run artifact, not a formula — hard-code it as the default so `build_prompt` reproduces the study exactly; do not re-derive it per call (D-03/`PROMPT_FIT_CLIP=True`).
  - `PROMPT_FIT_CLIP=False` (ablation, off-study) reproduces the v6 prompt template instead: `"no gradient, no vignette, no lighting falloff, no shadows, no texture, no pattern, flat matte solid colour fill, a single flat solid colour filling the entire image edge to edge, pure uniform {colour_desc}, ..."` (v6 base, out of scope for phase 1).
- SDXL negative prompt: `", ".join(_SDXL_NEG_CLAUSES)` where `_SDXL_NEG_CLAUSES = ["gradient", "vignette", "lighting falloff", "shadow", "shading", "texture", "noise", "grain", "pattern", "object", "product", "garment", "fabric folds", "text", "logo", "watermark", "reflection", "glossy highlight", "border", "frame", "3d render"]`. All 21 clauses fit the budget in the study run (51 tokens) — none were dropped.
- `validate_prompt(text) -> {tokens: int, fits: bool}` uses the SDXL repo's `CLIPTokenizer` (`black-forest-labs`/SDXL tokenizer, pinned revision from `config/models.toml`); budget 77 total including BOS/EOS (`CLIP_BUDGET = 75` for content). Falls back to a conservative regex-based token estimate (`len(re.findall(r"[\w#]+|[^\w\s]", text)) * 1.35 + 2`) only if the tokenizer can't load — log a warning when this happens, never use it silently in production.
- The negative prompt is checked the same way.

## 6. Package public API

```python
# colourlock/targets.py
TARGETS: dict[str, Target]            # id -> Target(name, hex, lab)
def target_from_hex(hex: str) -> Target

# colourlock/extract.py
def load_srgb(image_bytes: bytes) -> tuple[np.ndarray, list[str]]  # (H,W,3 uint8), warnings
def central_crop(rgb: np.ndarray, fraction: float = 0.5) -> np.ndarray   # uint8/float RGB, not Lab
def to_lab(rgb: np.ndarray) -> np.ndarray
def dominant_lab(rgb_crop: np.ndarray, n_clusters: int = 4, max_px: int = 20_000,
                  seed: int = 0) -> np.ndarray   # (3,) -- KMeans largest-cluster centroid; this IS sample_lab
def flat_median_lab(rgb_crop: np.ndarray, stride: int = 2) -> np.ndarray  # (3,) -- QC-only, NOT sample_lab

# colourlock/qc.py
def flat_p95_de(rgb_crop: np.ndarray, median_lab: np.ndarray, stride: int = 2,
                 percentile: float = 95) -> float
def qc_pass(value: float, threshold: float) -> bool
def kept_pct(rgb_full: np.ndarray, patch: int = 15, distance_threshold: float = 28) -> float   # legacy

# colourlock/metrics.py
def score_image(image_bytes: bytes, target: Target, cfg: QCConfig) -> ScoreResult

# colourlock/stats.py   (offline only)
def group_summary(df) -> pd.DataFrame
def run_h1(summary_df), run_h2(clean_df), run_h3(clean_df) -> HypothesisResult
# Named run_h*, not test_h* -- pytest auto-collects any `test_`-prefixed
# callable imported into a test module's namespace, which broke test_stats.py.

# colourlock/prompts.py
def build_prompt(target: Target, style: Literal["A","B","C","D","E"]) -> str
def validate_prompt(text: str) -> PromptCheck
```

`ScoreResult` (pydantic model, also the API response body):

```json
{
  "target": {"id": "…", "name": "…", "hex": "#RRGGBB", "lab": [L, a, b]},
  "sample_lab": [L, a, b],
  "delta_e00": 0.0,
  "flat_p95_de": 0.0,
  "qc": {"pass": true, "threshold": 0.0},
  "chroma": {"sample": 0.0, "reference": 0.0, "delta": 0.0},
  "kept_pct": 0.0,
  "warnings": ["jpeg_input"],
  "package_version": "x.y.z"
}
```

## 7. HTTP API (FastAPI, prefix `/api/v1`)

| Method | Path | Purpose | Response |
|---|---|---|---|
| GET | `/health` | liveness | `{status}` |
| GET | `/provenance` | model shas, precisions, QC threshold, package + git version | object |
| GET | `/targets` | the 8 study targets | list |
| GET | `/prompt-styles` | style ids, descriptions, example prompt | list |
| POST | `/prompts/validate` | CLIP token check | `{tokens, fits}` |
| POST | `/score` | multipart `image` + `target_id` or `target_hex` | `ScoreResult` |
| POST | `/generate` | `{model, target_id, style, seed?}` | `202 {job_id}` |
| GET | `/jobs/{job_id}` | status + result when done | `Job` |
| GET | `/study/summary` | per-group table | list |
| GET | `/study/hypotheses` | H1–H3 results | list |
| GET | `/study/images` | filters: model, target_id, style, qc_pass, page, page_size | paged list |
| GET | `/study/images/{image_id}` | manifest record + signed image URL + study prompt, negative prompt and generation parameters | object |
| GET | `/study/disclosures` | the methodological disclosures (research-context.md §6), served so every results page shows the same text (FR-1.4) | list |
| GET | `/files/{key}?expires&sig` | local-storage backend only: serves an object behind an HMAC-signed, expiring URL. 404 with the S3 backend (clients get presigned S3 URLs) | PNG |

Additions beyond the original table (Phase 2, 2026-09-23):
- `ScoreResult` responses from `/score` also carry `score_id` and `sample_hex`; study image records carry `sample_hex`. `sample_hex` is a display-only Lab→sRGB conversion (clipped) done in the API so the frontend never converts colour itself; it is never used in a metric.
- `/study/summary` rows carry `n` (generated, 32), `n_qc_pass`, `qc_pass_rate` and `low_n` (`n_qc_pass < 10`, FR-1.1). All 80 cells are returned, including cells where no image passed QC (their metrics are `null`).
- `style` filters accept the full id (`B_named_hex`) or its letter (`B`). Model keys are `flux` / `sdxl` (the manifest's `FLUX_local` / `SDXL`).

Accounts (2026-09-28):
- `POST /auth/change-password` `{current_password, new_password}` → `204`. Signed-in only (`401` otherwise). A wrong `current_password` is `400` "Incorrect password"; a `new_password` equal to the current one is `400` "Same password"; a weak `new_password` is `422` (same rule as sign-up: 8+ characters, a letter and a number). On success every other session of the user is signed out; the calling session stays signed in.

Settings page (2026-09-28), all signed-in only (`401` otherwise):
- `GET /auth/sessions` → the user's unexpired sessions `[{id, created_at, last_seen_at, expires_at, user_agent, ip, current}]`, this one first. `id` is a 16-char prefix of the stored token hash (not a credential). `last_seen_at` is refreshed at most every 5 minutes.
- `DELETE /auth/sessions/{id}` → `204` signs that session out (`404` if not the user's); `DELETE /auth/sessions` → `204` signs out every session except this one.
- `PATCH /auth/me/preferences` `{language: "en"|"zh"}` → `UserOut` (which now carries `language`). Also sets the `lang` cookie; login and sign-up verification set it again from the account, so the choice follows the user to other browsers.
- `GET /history/export?format=csv|json` → the user's score history as a download (`Content-Disposition: attachment`). CSV cells that would start a spreadsheet formula are prefixed with `'`.
- `POST /auth/me/delete` `{password}` → `204`. Wrong password is `400` "Incorrect password". Deletes the user, their sessions, score history, pending codes and profile photo, and clears the session cookie. Study data is untouched.
Scoring additions (2026-10-03):
- `POST /score` accepts an optional form field `explain=true`. The response then carries `explain`: `{width, height, crop_box: [x0,y0,x1,y1], stride, heatmap_png (data URI, one RGBA pixel per sampled crop pixel), scale_max, threshold, share_over_threshold, diff: {dL, dC, dH, hue_shift_deg}}`. Display only: the heat map is per-pixel ΔE00 from the same `flat_median_lab` the QC gate uses, over the same stride-sampled crop, so `share_over_threshold > 0.05` corresponds to failing the p95 gate. `explain` is never stored with the score or the history record.
- `POST /score/batch` multipart `images` (repeated, ≤ `MAX_BATCH_FILES` = 20, combined ≤ `MAX_BATCH_BYTES` = 50 MB) + `target_id` or `target_hex` → `{target, qc_threshold, package_version, items: [{index, filename, result: ScoreResult | null, error: {title, detail} | null}]}`. Each image is validated and scored on its own; a bad file fails only its row. Each success writes a `scores` row (`source='upload'`); batch scores are not added to the named history.

Errors use RFC 9457 problem+json: `{type, title, status, detail}`.

`Job` states: `queued → loading_model → generating → scoring → succeeded | failed`.

```json
{
  "job_id": "uuid", "status": "succeeded",
  "request": {"model": "sdxl", "target_id": "…", "style": "B", "seed": 7},
  "timings_ms": {"queue": 0, "load": 0, "generate": 0, "score": 0},
  "result": {
    "image_url": "signed url",
    "generation": {"model_id": "…", "revision": "…", "precision": "fp16",
                   "seed": 7, "prompt": "…", "negative_prompt": "…",
                   "steps": 30, "guidance": 7.0, "width": 512, "height": 512,
                   "off_study": false},
    "score": { "…": "ScoreResult" }
  },
  "error": null
}
```

Limits: upload ≤ 10 MB, long side ≤ 2048 px, `PIL.Image.MAX_IMAGE_PIXELS` set;
`/generate` rate-limited per IP (default 10/hour); queue depth cap returns 503.

## 8. Database (Postgres, SQLAlchemy 2 + Alembic)

```
study_images   (image_id PK, model, target_id, style, slot, seed_used, prompt_hash,
                generated_at, file_key, delta_e00, flat_p95_de, qc_pass, chroma_sample,
                chroma_reference, chroma_delta, consistency_de00 NULL, kept_pct,
                sample_L, sample_a, sample_b)
study_groups   (model, target_id, style, n, n_qc_pass, accuracy_mean, accuracy_sd,
                accuracy_yield_pct, consistency_mean, consistency_sd,
                consistency_yield_pct, chroma_dev_target_mean, flat_p95_de_median,
                PK(model,target_id,style))              -- metrics NULL when n_qc_pass = 0
study_hypotheses (id PK, name, test, statistic, p_value, direction, notes, extra JSON)
jobs           (job_id PK, status, request JSONB, created_at, started_at, finished_at,
                timings JSONB, error TEXT, client_hash)
generations    (job_id PK/FK, model_id, revision, precision, seed, prompt,
                negative_prompt, steps, guidance, width, height, off_study, file_key)
scores         (score_id PK, job_id FK NULL, source ENUM('upload','generation'),
                result JSONB, package_version, qc_threshold, created_at)
```

`study_*` tables are loaded once by `scripts/import_study.py` from the final
manifest and never modified by the app. How the import derives each column:

- `delta_e00`, `chroma_*`, `sample_L/a/b` are computed for **all 2,560** images with the package, from the manifest's stored dominant colour (`dom_R/G/B`, converted exactly as the notebook's `_rgb_cols_to_lab`). The notebook computed them only for the 772 QC-passed images; for those, the import checks its values against `reliable_results.csv` (tolerance 1e-9) and aborts on any mismatch.
- `consistency_de00` is the notebook's `dE00_to_centroid`, so it exists only for QC-passed images.
- `kept_pct` is the full-precision `kept_pct` column, not the 2dp-rounded `kept_pct_legacy`.
- `study_groups` has a row for all 80 cells; metrics come from `colourlock.stats.group_summary` over the QC-passed images.
- `study_hypotheses.extra` stores the sample guard and per-model counts (QC-passed images, groups, groups with n ≥ 10) so the UI can state the D-16 caveat next to every pooled statistic. Uploaded images are not stored by
default (only the score); stored if the user opts in.

## 9. Storage

S3-compatible (MinIO locally, R2/S3 in production). Keys:
`study/{model}/{target_id}/{style}/{image_id}.png`,
`generated/{yyyy}/{mm}/{job_id}.png`. Access through signed URLs only.
