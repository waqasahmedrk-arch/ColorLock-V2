# Running ColourLock locally

This guide takes you from an empty machine to the ColourLock web app running on your
own computer, with the full study dataset loaded. Each step has commands for
**Windows (PowerShell)** and for **macOS / Linux**. Follow the steps in order the first
time; after that, [section 9](#9-everyday-use) is all you need.

Running locally takes about 20 minutes the first time, most of it downloading packages.

**Contents**

1. [What you will be running](#1-what-you-will-be-running)
2. [Install the prerequisites](#2-install-the-prerequisites)
3. [Get the code](#3-get-the-code)
4. [API keys and configuration](#4-api-keys-and-configuration)
5. [Set up the backend](#5-set-up-the-backend)
6. [Load the study dataset](#6-load-the-study-dataset)
7. [Start the API](#7-start-the-api)
8. [Start the frontend](#8-start-the-frontend)
9. [Everyday use](#9-everyday-use)
10. [Tests and checks](#10-tests-and-checks)
11. [Docker (optional)](#11-docker-optional)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. What you will be running

Two programs, each in its own terminal window:

| Program | Address | What it does |
|---|---|---|
| **API** (FastAPI, Python) | http://localhost:8000 | Serves the study results and study images, and scores uploaded images with the `colourlock` package |
| **Frontend** (Next.js, Node) | http://localhost:3000 | The website you open in your browser. It gets all its data from the API |

Locally, the API needs no database server and no cloud storage:

- **Database:** a single SQLite file, created automatically at `data/dev/colourlock_dev.db`.
- **Images:** stored under `data/storage/`.

Both live in the repository's `data/` folder, which git ignores, so none of it is ever
committed.

## 2. Install the prerequisites

| Tool | Version | Check with | Get it from |
|---|---|---|---|
| Python | 3.11 or newer | `python --version` | https://www.python.org/downloads/ (on Windows, tick **"Add python.exe to PATH"** in the installer) |
| Node.js | 20.9 or newer | `node --version` | https://nodejs.org/ (the LTS version) |
| Git | any recent | `git --version` | https://git-scm.com/downloads |

**Disk space:** plan for about **2 GB free**:

- about 550 MB for the Python environment
- about 350 MB for the frontend's packages
- download caches, which grow as you install

The dataset adds about 530 MB for the zip file, plus the same again once extracted.
Loading it into the app normally costs nothing extra; see [section 6](#6-load-the-study-dataset).

On macOS and Linux the command may be `python3` instead of `python`. Use whichever one
reports version 3.11 or newer.

## 3. Get the code

```bash
git clone <repository-url> colourlock
cd colourlock
```

From here on, **"the repository root"** means this `colourlock` folder. Every command
below says which folder to run it from.

## 4. API keys and configuration

### Do I need any API keys?

**No, not to run the app locally.** Browsing the results, browsing the study images and
scoring an image all run on your own machine, with no external service and no key.

The project has exactly one real secret, and it isn't used yet:

| Key | Needed for | Needed now? |
|---|---|---|
| `HF_TOKEN` (Hugging Face access token) | Downloading the FLUX.1-schnell weights for the **GPU generation worker** (roadmap Phase 3, not built yet). The FLUX repository on Hugging Face is gated. | **No** |

For later, when the generation worker exists:

1. Create a free account at https://huggingface.co.
2. Open https://huggingface.co/black-forest-labs/FLUX.1-schnell and accept the licence
   terms. Without this step, a valid token is still refused.
3. Create a token with **Read** access at https://huggingface.co/settings/tokens.
4. Put it only in the worker's environment: the repository-root `.env` file on your
   machine, or your hosting platform's secret store in production. Never in the API,
   never in the frontend, and never in a committed file. `.env` is gitignored for this
   reason.

SDXL needs no token.

### The configuration file (optional)

Everything works with the built-in defaults, so you can skip this step. To change a
setting, create a `.env` file in the **repository root** from the template:

```powershell
# Windows (PowerShell), from the repository root
Copy-Item .env.example .env
```

```bash
# macOS / Linux, from the repository root
cp .env.example .env
```

Every variable in the template starts empty, and **an empty value means "use the
default"**, so the copy works unchanged. Fill in only what you need:

| Variable | Default | Set it when |
|---|---|---|
| `DATABASE_URL` | SQLite file at `data/dev/colourlock_dev.db` | You want Postgres instead, e.g. `postgresql+psycopg://user:password@localhost:5432/colourlock` (also run `pip install -e "backend/api[postgres]"`) |
| `STORAGE_BACKEND` | `local` | `s3` to keep images in S3, Cloudflare R2 or MinIO |
| `LOCAL_STORAGE_ROOT` | `data/storage` | You want the images stored somewhere else |
| `S3_BUCKET`, `S3_ENDPOINT_URL`, `S3_PUBLIC_ENDPOINT_URL`, `S3_REGION` | — | `STORAGE_BACKEND=s3` only |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | — | `STORAGE_BACKEND=s3` only. These are your storage provider's credentials: **secrets**, keep them in `.env` only |
| `URL_SIGNING_SECRET` | a fixed, insecure development value | Anyone other than you can reach the API. It signs the image links; see below |
| `PUBLIC_BASE_URL` | `http://localhost:8000` | You run the API on a different port or address (image links are built from it) |
| `FRONTEND_ORIGINS` | `http://localhost:3000` | You open the frontend at a different address, e.g. `http://127.0.0.1:3000`. Comma-separated for several |
| `PROMPT_TOKENIZER` | `fallback` | `clip` to count prompt tokens with SDXL's real tokenizer. Needs `pip install -e "packages/colourlock[prompts]"` and an internet connection on first use; no token required |
| `GIT_COMMIT` | `unknown` | You want the provenance page to show which commit is running |
| `COLOURLOCK_CONFIG_DIR` | the repository's `config/` folder | You keep `models.toml` and `qc.toml` elsewhere |
| `HF_TOKEN` | — | Not used yet (see above). The API never reads it |

To make a real `URL_SIGNING_SECRET`:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### Frontend settings (optional)

The frontend reads its own file, `frontend/.env.local`. Leave it out entirely to use
the defaults:

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000/api/v1` | Where the browser reaches the API |
| `API_INTERNAL_BASE_URL` | same as above | Where the frontend server reaches the API, if that address differs |
| `NEXT_PUBLIC_ZENODO_DOI` | — | The dataset DOI, once published. Shown in the footer |

Anything starting with `NEXT_PUBLIC_` is visible to every visitor in the browser.
**Never put a secret in a `NEXT_PUBLIC_` variable.** After changing this file, restart
`npm run dev`.

## 5. Set up the backend

Run these commands from the repository root.

**Create and activate a Python virtual environment**, a private folder of packages for
this project:

```powershell
# Windows (PowerShell)
python -m venv .venv
.venv\Scripts\Activate.ps1
```

```bash
# macOS / Linux
python -m venv .venv
source .venv/bin/activate
```

Your prompt now starts with `(.venv)`. **Activate the environment again in every new
terminal** before running any Python command in this guide.

If PowerShell says running scripts is disabled, run this line, then try activating again.
It affects only the current window:
`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

**Install the measurement package and the API**:

```bash
python -m pip install --upgrade pip
pip install -e "packages/colourlock[dev]" -e "backend/api[dev]"
```

**Check the installation** by running the tests:

```bash
cd packages/colourlock
python -m pytest tests/unit tests/parity -q
cd ../../backend/api
python -m pytest -q
cd ../..
```

Before the dataset is loaded, expect:

- `41 passed, 7 skipped` for the package
- `37 passed, 1 skipped` for the API

The skipped tests need the study dataset and run automatically once it's in place.

## 6. Load the study dataset

This step is optional. Without it, the app runs, but the results and image pages are
empty. **Scoring your own image works either way.**

**Get the dataset.** It's the `colourlock_full_study` zip file produced by the study run
(about 530 MB, 2,560 PNG images plus CSV files). It isn't in the repository. Until it's
published on Zenodo, ask the project team for a copy.

**Unzip it** so that this folder exists inside the repository:

```
data/study/colourlock_full_study/
    all_images.csv
    reliable_results.csv
    FLUX_local_royal_blue_A_hex_only_01.png
    ... 2,560 generated images in total, plus 8 placeholder_reference_*.png swatches
```

Create the database tables, then import:

```bash
cd backend/api
python -m alembic upgrade head
cd ../..
python scripts/import_study.py --files link
```

Expected output:

```
Loaded 2560 images, 772 QC-passed, from ...\data\study\colourlock_full_study
Checks passed: 2560 images, 80 groups, 3 hypotheses
  files: 500/2560
  ...
Import complete.
```

What the import does:

- **It checks before it writes.** It recomputes every image's measurements with the
  `colourlock` package and compares them with the notebook's own results. If anything
  disagrees, it stops with a list of the mismatches and writes nothing.
- **`--files link` costs no disk space.** It *hardlinks* the PNGs into `data/storage/`,
  so each image exists once on disk under two names. That works when the repository and
  the dataset are on the same drive. Otherwise it quietly copies them, which takes
  another 530 MB.
- **Importing again:** add `--replace` to reload a database that already has data.

With the dataset in place, you can confirm the package reproduces the notebook on every
study image. It takes about 7 to 10 minutes:

```bash
cd packages/colourlock
python -m pytest tests/parity -m slow -q      # expect: 7 passed
cd ../..
```

## 7. Start the API

In a terminal with the virtual environment activated:

```bash
cd backend/api
python -m alembic upgrade head
python -m uvicorn app.main:app --reload
```

- `alembic upgrade head` creates the database the first time. Afterwards it does
  nothing, so it's safe to run every time.
- `--reload` restarts the API whenever you edit its code.
- **Leave this terminal open.** The API stops when you close it or press `Ctrl+C`.

Check that it works:

- http://localhost:8000/api/v1/health should show `{"status":"ok"}`.
- http://localhost:8000/api/v1/docs shows interactive documentation for every
  endpoint. You can try requests there directly.

## 8. Start the frontend

In a **second** terminal, from the repository root:

```bash
cd frontend
npm install        # first time, and after package.json changes
npm run dev
```

Open **http://localhost:3000**. Leave this terminal open as well.

Check each page:

| Page | What you should see |
|---|---|
| **Results** (`/`) | Three hypothesis cards, then a colour × prompt-style grid. Hatched cells have fewer than 10 QC-passed images. Switch between FLUX and SDXL with the tabs |
| **Images** (`/images`) | The 2,560 study images, with filters for model, colour, style and QC result |
| **Image detail** | Click any image: its measurements, target and measured colour swatches, prompt and generation settings |
| **Score an image** (`/score`) | Upload a PNG or JPEG, pick a target colour, and get its ΔE00, flatness QC result and chroma |
| **Provenance** (`/provenance`) | Model revisions, precision, QC threshold and package version |

To test scoring end to end, upload
`data/study/colourlock_full_study/FLUX_local_teal_B_named_hex_01.png` with the target
**teal**. The result should be **ΔE00 = 13.09**, the same value the study reports for
that image.

To run the frontend in production mode instead (faster, no live reload):

```bash
cd frontend
npm run build
npm start
```

## 9. Everyday use

Once everything is set up, starting the app means two terminals.

**Terminal 1, the API**, from the repository root:

```powershell
.venv\Scripts\Activate.ps1          # macOS / Linux: source .venv/bin/activate
cd backend/api
python -m uvicorn app.main:app --reload
```

**Terminal 2, the frontend**, from the repository root:

```bash
cd frontend
npm run dev
```

Then open http://localhost:3000. Stop either one with `Ctrl+C`.

**To start over with an empty database**, stop the API, then run these from the
repository root:

```bash
# Windows: Remove-Item data\dev\colourlock_dev.db
rm data/dev/colourlock_dev.db
cd backend/api
python -m alembic upgrade head
cd ../..
python scripts/import_study.py --files link
```

## 10. Tests and checks

Run the Python checks with the virtual environment activated.

| What | Command | From |
|---|---|---|
| Package unit tests | `python -m pytest tests/unit -q` | `packages/colourlock` |
| Parity with the notebook, all 2,560 images (~10 min) | `python -m pytest tests/parity -m slow -q` | `packages/colourlock` |
| API tests | `python -m pytest -q` | `backend/api` |
| Type check (strict) | `python -m mypy src` | `packages/colourlock` |
| Lint | `python -m ruff check .` | `backend/api` or `packages/colourlock` |
| Frontend type check | `npm run typecheck` | `frontend` |
| Frontend production build | `npm run build` | `frontend` |

On macOS and Linux with `make` installed, the repository-root `Makefile` wraps these
(`make test`, `make parity`, `make lint`, `make api`, `make frontend`). Windows doesn't
include `make`, so use the commands above.

## 11. Docker (optional)

`infra/docker-compose.yml` runs the API with the production-style services:

- Postgres for the database
- MinIO for S3-compatible image storage
- Redis, which is reserved for the Phase 3 job queue

It needs Docker Desktop. **This setup hasn't been verified end to end yet**, so
prefer the steps above for now.

```bash
docker compose -f infra/docker-compose.yml up --build
docker compose -f infra/docker-compose.yml --profile import run --rm import
```

The API is then at http://localhost:8000, and the MinIO console at
http://localhost:9001. The compose file sets its own development credentials; it
doesn't need your `.env`, but reads it if present. Run the frontend as in
[section 8](#8-start-the-frontend).

## 12. Troubleshooting

| Problem | Cause and fix |
|---|---|
| `python` or `node` is "not recognized" | It isn't installed, or isn't on your PATH. Reinstall; on Windows, tick "Add python.exe to PATH". Then open a new terminal |
| `No module named ...` in Python | The virtual environment isn't active in this terminal. Activate it (section 5) |
| PowerShell won't run `Activate.ps1` | Run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in that window, then activate |
| `Address already in use` / port 8000 or 3000 busy | Another copy is still running; close it. Or use another port: `uvicorn ... --port 8001` together with `PUBLIC_BASE_URL=http://localhost:8001` in `.env` and `NEXT_PUBLIC_API_BASE_URL=http://localhost:8001/api/v1` in `frontend/.env.local`; or `npm run dev -- -p 3001` together with `FRONTEND_ORIGINS=http://localhost:3001` |
| Results page says **"No study data loaded"** | The dataset isn't imported. Do section 6 |
| Frontend error page, or **"Could not reach the scoring service"** | The API isn't running, or the frontend points at the wrong address. Check http://localhost:8000/api/v1/health, then `NEXT_PUBLIC_API_BASE_URL` |
| Scoring fails only in the browser, while the API docs page works | A CORS block: you opened the site at an address the API doesn't expect (e.g. `127.0.0.1` instead of `localhost`). Use http://localhost:3000, or add your address to `FRONTEND_ORIGINS` and restart the API |
| Study images show as broken | Image links expire after an hour; refresh the page. If they never load, `PUBLIC_BASE_URL` doesn't match where the API really runs |
| Import stops with `Refusing to import: ...` | The dataset doesn't match what the notebook produced: a wrong or partial copy, or edited CSVs. Re-extract the original zip |
| Import says `study_images already has ... rows` | The data is already loaded. Add `--replace` to reload it |
| `unable to open database file` | Check that `DATABASE_URL` in `.env` points to a folder you can write to, or leave it empty for the default |
| Upload rejected: "Upload too large" / "Image too large" | The limits are 10 MB and 2048 px on the long side |
| Upload rejected: "Unsupported image" | Only PNG and JPEG are accepted |
| Installs fail with "No space left on device" | The disk is full. Package managers keep download caches you can clear safely: `pip cache purge` and `npm cache clean --force` |
