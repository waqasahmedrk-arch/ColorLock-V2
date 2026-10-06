# Roadmap

Update checkboxes as work lands. Keep "Current focus" accurate.

**Current focus:** Phase 2 (API, explorer and scoring)

## Phase 0: Freeze the study inputs
- [x] Confirm the final `FLAT_P95_DE_MAX` and write the justification into `decisions.md` (D-QC)
- [x] Copy the full model revision shas and FLUX precision from `run_environment_*.txt` into `config/models.toml` (shas resolved via HF API, short shas only were printed — D-14)
- [x] Put the final manifests and PNGs in `data/study/` (gitignored)
- [x] Place `ColourLock_v15_local.ipynb` in `notebooks/`
- [ ] Decide GPU hosting for Phase 3 (RunPod Serverless / Modal / HF Endpoints) — not required to start Phase 1

## Phase 1: Extract the `colourlock` package
- [x] Scaffold `packages/colourlock` (pyproject, src layout)
- [x] Port `targets`, `extract`, `qc`, `metrics`, `prompts`, `stats` from the notebook; resolve every **VERIFY** in specs.md (found and corrected a real discrepancy: `sample_lab` is a KMeans dominant-cluster colour, not a median — see specs.md §2, decisions.md)
- [x] Unit tests on synthetic swatches and the CIEDE2000 reference pairs (41 passing; one memorized reference value in the first draft was wrong and was corrected against a verified source, not adjusted to pass)
- [x] Parity test over all 2,560 images (green) — 48/48 passing incl. stats parity vs notebook Step 10
- [x] Make the notebook import the package and confirm the tables are unchanged — added an additive "Phase 1 validation" section (4 cells) to the end of `notebooks/ColourLock_v15_local.ipynb` rather than rewriting the original cells in place: the original cells are the frozen provenance record of how the dataset was actually produced (their saved outputs are what makes the run auditable), and rewriting them risks silently altering that record for no real benefit, since it already finished executing. The new section installs `colourlock`, re-derives `group_summary`/H1/H2/H3 from the saved CSVs and asserts they match this notebook's own printed Step 10 output and `summary_by_model_colour_style.csv` (within its saved 2dp rounding), plus a 200-image extraction/QC spot check. Verified by running the same code outside the notebook (no local kernel available here) — all assertions pass. Full 2,560-image parity already covered by `pytest packages/colourlock/tests/parity -m slow`.

## Phase 2: API, explorer and scoring (CPU)
- [x] `infra/docker-compose.yml` (api, postgres, redis, minio) + `infra/api.Dockerfile` — **written but not run: no Docker on the dev machine.** `worker-mock` is added in Phase 3 with the worker itself.
- [x] Alembic schema from specs.md §8 (test checks the migration builds the same columns as the ORM models)
- [x] `scripts/import_study.py` loads the manifest, group summaries and hypotheses — verified against the real dataset: 2,560 images, 80 groups, H1–H3 matching the notebook; package values checked against `reliable_results.csv` at 1e-9 before anything is written
- [x] Routers: meta, targets, prompt-styles, prompts/validate, score, study/* (+ `/study/disclosures`, local signed `/files`). 38 API tests passing
- [x] Next.js frontend: results grid with low-n marking, hypotheses, image browser, image detail, score upload, provenance, disclosures on every results page — built and checked in a browser against the real imported data
- [ ] Deploy API and frontend (CPU) — needs a hosting choice and accounts (see architecture.md §6)

## Phase 3: Generation
- [ ] Worker with mock backend and the job lifecycle end-to-end
- [ ] `scripts/fetch_weights.py` (pinned revisions, to the volume)
- [ ] Diffusers backend with startup checks and warm-up
- [ ] Reproduction check: a service-generated SDXL image at a study seed matches the study metrics
- [ ] Deploy the GPU worker on a serverless platform with a persistent volume
- [ ] Rate limits, queue cap, stuck-job reaper

## Additions beyond the plan (2026-10-03)
- [x] Batch scoring: `POST /score/batch` and the `/score/batch` page (per-file errors, sortable table, CSV download)
- [x] Score explanation: `explain=true` on `/score` (flatness heat map over the QC crop, ΔL*/ΔC*/Δh) and the "Why this score" panel with an a*b* drift plot

## Additions beyond the plan (2026-10-04)
- [x] Admin panel (`/admin`): overview with 14-day sign-in chart, users (search/filter/sort), user detail (profile, sessions, sign-in history, audit), block/unblock, sign out everywhere, grant/revoke admin, delete; security page (all sign-in attempts, audit log). Admins via `ADMIN_EMAILS` or granted in the panel
- [x] Support chat: user widget (`components/ChatWidget.tsx`) <-> admin inbox (`/admin/messages`), polled; admin replies raise no notification, only the message sound (2026-10-05; the widget polls in background tabs too)
- [x] Notification sound (Web Audio chime), on/off saved to the account; toggle in the bell and Settings
- New auth tables: `login_events`, `chat_messages`, `admin_audit`; new `users` columns added by `_add_missing_columns`
- [x] Admin panel is its own site: `npm run dev:admin` (:3001, build dir `.next-admin`, `NEXT_PUBLIC_APP_MODE=admin`); `proxy.ts` keeps the two sites apart (`frontend/lib/appMode.ts`)

## Additions beyond the plan (2026-10-05)
- [x] Admin profile (`/admin/profile`, `/admin/change-password` on the admin site): same form as the user `/profile`, saved through the admin session via `/admin/auth/me` (PATCH, avatar POST/DELETE) and `/admin/auth/change-password`. Sidebar "My profile" link; the signed-in card in the sidebar links there too
- [x] Photos in the support chat, both ways: `POST /chat/image` and `POST /admin/chats/{id}/image` (multipart, optional caption). Re-encoded server-side (EXIF stripped, longest side ≤ `CHAT_IMAGE_MAX_SIDE`, ≤ `CHAT_IMAGE_MAX_BYTES`), stored under `chat/<user id>/`, served by signed URL; new `chat_messages.image_key/image_w/image_h`. Attach button, paste and drag-and-drop, preview, full-size viewer (`components/ChatPhoto.tsx`). Photos are deleted with the account

## Additions beyond the plan (2026-10-06)
- [x] Admin selfie check: an admin with no selfie on file (a new admin's first sign-in, or an existing admin's first since this shipped) gets a third sign-in step after the emailed code. `/admin/auth/verify` answers 202 with a short-lived token; `POST /admin/auth/selfie` (multipart) stores the photo and opens the session. The face + liveness check (one face, centred, a blink, a head turn) runs in the browser with MediaPipe Face Landmarker (`app/(auth)/admin-login/SelfieStep.tsx`); the model and WASM are self-hosted under `public/mediapipe` by `scripts/face-assets.mjs` (runs before dev/build, gitignored). The server checks only the token and that the upload is a real photo (≥ 240 px, re-encoded, EXIF stripped, ≤ `SELFIE_MAX_SIDE`), stored privately at `selfies/<user id>/`, never served, deleted with the account. New `users.selfie_key/selfie_at`; user detail shows "Admin selfie" date

## Phase 4: Release
- [ ] Zenodo artifact (PNGs, manifests, run environment, notebook, package) → DOI in the UI
- [ ] Load test /score
- [ ] Terms of service including the SDXL OpenRAIL++-M use restrictions
- [ ] Optional: HF Space scoring demo
