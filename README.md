# ColourLock

How accurately and consistently do off-the-shelf text-to-image models reproduce a
colour you ask for?

ColourLock is a measurement study. Two models, **FLUX.1-schnell** and **SDXL base 1.0**,
were each asked for 8 CSS3/X11 colours in 5 prompt styles, 32 times per combination:
2,560 images in total. Every image is measured in CIELAB with CIEDE2000 (ΔE00) against
its target colour. Nothing was trained or fine-tuned; the models ran unchanged from
Hugging Face at pinned revisions.

This repository contains:

- **`colourlock`**, the Python package that does the measuring. It reproduces the
  research notebook's numbers on all 2,560 study images, and that is enforced by tests.
- **An API** (FastAPI) that serves the study results and scores uploaded images with the
  same code.
- **A web app** (Next.js) to explore the results, browse every study image, and score
  your own image.

## Results at a glance

| Hypothesis | Test | Result |
|---|---|---|
| **H1** Accuracy and consistency decouple | Spearman ρ across 46 groups | ρ = 0.279, p = 0.060: no significant correlation, consistent with H1 |
| **H2** Colour drift is biased toward desaturation | One-sided Wilcoxon signed-rank, n = 772 | W = 159371, p = 0.950: not supported (median chroma deviation +7.29) |
| **H3** One prompt style is most consistent | Levene + Kruskal–Wallis | H = 415.80, p < 0.0001: styles differ; "named colour + hex" is tightest on average, but the omnibus test doesn't establish a winner over the runner-up |

**Read this before comparing the two models:** at the study's flatness QC threshold,
only 9 of 1,280 SDXL images (0.7%) passed, against 763 of 1,280 FLUX images (59.6%).
The pooled results rest almost entirely on FLUX. This and six other methodological
disclosures are listed in [`claude/research-context.md` §6](claude/research-context.md)
and shown on every results page of the app.

## How an image is measured

1. Take the central 50% of the image (by width and height).
2. **Sample colour:** cluster the crop's pixels in CIELAB (k-means, k = 4, fixed seed)
   and take the largest cluster's centre.
3. **Accuracy:** ΔE00 between the sample colour and the target.
4. **Flatness QC:** the 95th-percentile ΔE00 of the crop's pixels from their median
   colour. The image passes if this is ≤ 3.0.
5. **Chroma drift:** the sample's chroma minus the target's. Negative means less
   saturated than the target.

Consistency is computed per group of images: the mean ΔE00 of each QC-passed image from
the group's average colour. Exact definitions, including the details needed for parity
with the notebook, are in [`claude/specs.md`](claude/specs.md).

## Repository layout

```
packages/colourlock/   measurement package (targets, extraction, QC, metrics, prompts, stats)
backend/api/           FastAPI app, Alembic migrations, API tests
frontend/              Next.js web app
scripts/               import_study.py: loads the study dataset into the database
config/                pinned model revisions and precisions, QC threshold
infra/                 Dockerfile and docker-compose for the full stack
claude/                design docs: requirements, specs, architecture, decisions
```

**Not in this repository:**

- **The dataset:** 2,560 PNGs (about 530 MB) and their manifests.
- **The research notebook** (`ColourLock_v15_local.ipynb`) that generated it.
- **Model weights.**

The dataset and the notebook will be published together on Zenodo. The notebook is
the reference for how every metric is defined; the `colourlock` package is a port of
its measurement code, checked against the dataset by the parity tests.

## Running it locally

For a complete step-by-step guide, including configuration, API keys and
troubleshooting, see [`docs/local-setup.md`](docs/local-setup.md). The short version:

Requirements: Python 3.11+ and Node.js 20.9+. Docker is not needed for local
development; the API falls back to SQLite and local file storage under `data/`.

### 1. Install and test the package and API

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e "packages/colourlock[dev]" -e "backend/api[dev]"

cd packages/colourlock && python -m pytest tests/unit -q && cd ../..
cd backend/api && python -m pytest -q && cd ../..
```

Tests that need the study dataset are skipped automatically when it isn't present.

### 2. Load the study dataset (optional)

Put the extracted dataset in `data/study/colourlock_full_study/` (it must contain
`all_images.csv`, `reliable_results.csv` and the PNGs), then:

```bash
cd backend/api && python -m alembic upgrade head && cd ../..    # creates data/dev/colourlock_dev.db
python scripts/import_study.py --files link
```

The import computes every metric with the package and checks it against the notebook's
own results before writing anything; it refuses to load on any mismatch. `--files link`
hardlinks the PNGs into local storage, so it uses no extra disk space.

To confirm the package reproduces the notebook on every study image (takes about
7 minutes):

```bash
cd packages/colourlock && python -m pytest tests/parity -m slow -q
```

### 3. Run the API and the web app

```bash
cd backend/api
python -m alembic upgrade head                  # safe to repeat; creates the database if needed
python -m uvicorn app.main:app --reload         # http://localhost:8000/api/v1/docs
```

```bash
cd frontend && npm install && npm run dev                      # http://localhost:3000
```

Without the dataset, the study pages are empty but scoring an image still works.

### Docker

`infra/docker-compose.yml` runs the API with Postgres and MinIO (S3-compatible storage):

```bash
docker compose -f infra/docker-compose.yml up --build
docker compose -f infra/docker-compose.yml --profile import run --rm import
```

This setup hasn't been verified end to end yet.

Configuration is through environment variables; the names are listed in
[`.env.example`](.env.example). Real values go in `.env`, which is gitignored.

## API

The API is served under `/api/v1`; interactive docs are at `/api/v1/docs`.

| Endpoint | Purpose |
|---|---|
| `POST /score` | Score an uploaded PNG or JPEG against a study target or any `#RRGGBB` |
| `GET /study/summary` | Results per model × colour × prompt style, with low-sample cells flagged |
| `GET /study/hypotheses` | H1–H3 results |
| `GET /study/images`, `GET /study/images/{id}` | Browse study images with their metrics and provenance |
| `GET /study/disclosures` | The methodological disclosures |
| `GET /provenance` | Model revisions, precisions, QC threshold, package version |
| `GET /targets`, `GET /prompt-styles` | The 8 targets and 5 prompt styles |

Errors are returned as RFC 9457 `application/problem+json`. Uploaded images are not
stored; only their scores are.

## Status

- **Done:** the measurement package, verified against the notebook. The API and web app
  run locally against the full dataset.
- **Next:** deployment on CPU hosting; then live generation with the two models on a GPU
  worker; then the Zenodo release.

The ordered task list is in [`claude/roadmap.md`](claude/roadmap.md).

## Models and licences

- FLUX.1-schnell (`black-forest-labs/FLUX.1-schnell`): Apache-2.0. The Hugging Face
  repository is gated, so you need to accept its terms and use an access token.
- SDXL base 1.0 (`stabilityai/stable-diffusion-xl-base-1.0`): CreativeML
  OpenRAIL++-M, which includes use restrictions.

This repository doesn't have a licence yet.
