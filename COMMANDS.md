# ColourLock — command reference

Every command needed to set up and run the project, in order. Run everything from the
**repository root** unless a step says otherwise. Explanations, expected output and
troubleshooting are in [`docs/local-setup.md`](docs/local-setup.md).

Windows (PowerShell) is shown first; macOS / Linux equivalents follow where they differ.

---

## 0. Prerequisites (check once)

```powershell
python --version     # 3.11 or newer
node --version       # 20.9 or newer
npm --version
git --version
docker --version     # only for the optional Docker stack (section 8)
```

---

## 1. First-time setup

### 1.1 Configuration (optional; defaults work)

```powershell
Copy-Item .env.example .env
```
```bash
cp .env.example .env
```

Generate a real `URL_SIGNING_SECRET` if anyone other than you can reach the API:

```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

### 1.2 Python virtual environment

```powershell
python -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass   # only if activation is blocked
.venv\Scripts\Activate.ps1
```
```bash
python3 -m venv .venv
source .venv/bin/activate
```

> Activate the environment in **every new terminal** before running Python commands.

### 1.3 Install the measurement package and the API

```powershell
python -m pip install --upgrade pip
pip install -e "packages/colourlock[dev]" -e "backend/api[dev]"
```

Optional extras:

```powershell
pip install -e "packages/colourlock[prompts]"   # real CLIP tokenizer (PROMPT_TOKENIZER=clip)
pip install -e "backend/api[postgres]"          # Postgres instead of SQLite
```

### 1.4 Install the frontend

```powershell
cd frontend
npm install
cd ..
```

### 1.5 Create the database

```powershell
cd backend/api
python -m alembic upgrade head      # creates data/dev/colourlock_dev.db; safe to repeat
cd ../..
```

---

## 2. Load the study dataset (optional)

Unzip the `colourlock_full_study` dataset to `data/study/colourlock_full_study/`
(it must contain `all_images.csv`, `reliable_results.csv` and the PNGs), then:

```powershell
python scripts/import_study.py --files link            # hardlinks PNGs into data/storage/
python scripts/import_study.py --files link --replace  # re-import over existing data
```

Other file modes: `--files upload` (S3/R2/MinIO), `--files none` (rows only).

---

## 3. Run the app (two terminals)

**Terminal 1 — API** → http://localhost:8000/api/v1/docs

```powershell
.venv\Scripts\Activate.ps1          # macOS / Linux: source .venv/bin/activate
cd backend/api
python -m alembic upgrade head
python -m uvicorn app.main:app --reload
```

**Terminal 2 — Frontend** → http://localhost:3000

```powershell
cd frontend
npm run dev
```

Health check: http://localhost:8000/api/v1/health → `{"status":"ok"}`

### Frontend production mode

```powershell
cd frontend
npm run build
npm start
```

### Different ports

```powershell
python -m uvicorn app.main:app --reload --port 8001   # also set PUBLIC_BASE_URL in .env
npm run dev -- -p 3001                                 # also set FRONTEND_ORIGINS in .env
```

---

## 3a. User accounts (MySQL + Gmail OTP)

Accounts live in their own MySQL database, apart from the study data. Locally that is
XAMPP's MariaDB: start MySQL from the XAMPP Control Panel, then create the database once:

```powershell
C:\xampp\mysql\bin\mysql.exe -u root -e "CREATE DATABASE IF NOT EXISTS colourlock_auth CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
pip install -e "backend/api[mysql]"
```

In `.env`:

```
AUTH_DATABASE_URL=mysql+pymysql://root:@127.0.0.1:3306/colourlock_auth
AUTH_SECRET=<python -c "import secrets; print(secrets.token_hex(32))">
EMAIL_BACKEND=smtp            # "console" prints codes to the API log instead
SMTP_USER=you@gmail.com
SMTP_PASSWORD=<16-char Gmail App Password>
```

Gmail needs 2-Step Verification on, then an App Password from
https://myaccount.google.com/apppasswords (your normal password will not work).
The API creates the tables on first use. Pages: `/login`, `/signup`, `/forgot-password`.


## 4. Tests and checks

Activate the virtual environment first.

```powershell
# Package unit tests
cd packages/colourlock
python -m pytest tests/unit -q
cd ../..

# API tests
cd backend/api
python -m pytest -q
cd ../..

# Parity with the notebook on all 2,560 study images (~7-10 min; needs the dataset)
cd packages/colourlock
python -m pytest tests/parity -m slow -q        # expect: 7 passed
cd ../..

# Lint + type check
python -m ruff check packages/colourlock/src backend/api scripts
cd packages/colourlock
python -m mypy src
cd ../..

# Frontend type check and build
cd frontend
npm run typecheck
npm run build
cd ..
```

---

## 5. Make shortcuts (macOS / Linux, or Windows with `make` installed)

```bash
make api        # alembic upgrade + uvicorn --reload (SQLite + local files)
make frontend   # npm run dev
make test       # package unit tests + API tests (not slow)
make parity     # package vs notebook manifest (~7 min)
make lint       # ruff + mypy
make dev        # docker compose stack
make import     # load data/study into the docker stack
```

---

## 6. Reset the local database

Stop the API first.

```powershell
Remove-Item data\dev\colourlock_dev.db
cd backend/api
python -m alembic upgrade head
cd ../..
python scripts/import_study.py --files link
```
```bash
rm data/dev/colourlock_dev.db
cd backend/api && python -m alembic upgrade head && cd ../..
python scripts/import_study.py --files link
```

---

## 7. Housekeeping

```powershell
pip cache purge                # free disk space
npm cache clean --force
deactivate                     # leave the virtual environment
```

---

## 8. Docker stack (optional; not yet verified end to end)

Runs API + Postgres + MinIO + Redis. Needs Docker Desktop.

```powershell
docker compose -f infra/docker-compose.yml up --build                          # start
docker compose -f infra/docker-compose.yml --profile import run --rm import    # load dataset
docker compose -f infra/docker-compose.yml logs -f api                         # follow API logs
docker compose -f infra/docker-compose.yml down                                # stop
docker compose -f infra/docker-compose.yml down -v                             # stop + wipe volumes
```

- API: http://localhost:8000 · MinIO console: http://localhost:9001
- Run the frontend separately as in section 3.

---

## 9. GPU generation worker (roadmap Phase 3 — not built yet)

When it exists it will need CUDA and a Hugging Face token (FLUX.1-schnell is gated;
accept its licence on huggingface.co first). Put the token **only** in `.env`:

```
HF_TOKEN=<your read token>
```

Planned command: `make worker-gpu`.
