# Backend architecture

## 1. Principles

1. **Split by hardware need.** Everything that doesn't need a GPU (explorer,
   scoring, API) runs on cheap CPU hosting. Only generation touches a GPU.
2. **One scoring implementation.** The API and the GPU worker both import the
   same `colourlock` package. There is no second copy of any metric.
3. **Models come from Hugging Face at pinned revisions**, cached on a
   persistent volume, loaded once per worker process.
4. **Provenance travels with every result** (model, revision, precision, seed,
   package version, QC threshold).

## 2. Component diagram

```
┌─────────────────────┐
│ Frontend (Next.js)  │  explorer · score upload · generate form · job view
└─────────┬───────────┘
          │ HTTPS /api/v1
┌─────────▼───────────────────────────────────────────┐
│ API service (FastAPI, CPU, stateless)               │
│  routers: study · score · generate · jobs · meta    │
│  imports colourlock (score_image, prompts, targets) │
└───┬──────────────┬────────────────┬─────────────────┘
    │              │                │
┌───▼────┐   ┌─────▼─────┐   ┌──────▼──────────┐
│Postgres│   │  Redis    │   │ Object storage  │
│ study_*│   │ job queue │   │ study PNGs,     │
│ jobs   │   │ + rate    │   │ generated PNGs  │
│ scores │   │   limits  │   └──────▲──────────┘
└───▲────┘   └─────┬─────┘          │
    │              │ one queue per model: gen:flux, gen:sdxl
    │        ┌─────▼──────────────────────────────┐
    └────────┤ GPU worker (long-lived process)    │
             │  loads ONE pipeline at start       │
             │  (diffusers, pinned revision)      │
             │  generate → colourlock.score_image │
             │  → upload PNG → write rows         │
             │ weights: /models/hf_cache (volume) │
             └────────────────────────────────────┘
```

## 3. Request flows

**Score (synchronous, CPU):**
`POST /score` → validate upload → `colourlock.extract.load_srgb` →
`score_image` → insert `scores` row → return `ScoreResult`.

**Generate (asynchronous, GPU):**
1. `POST /generate` → validate the request, build the prompt with `colourlock.prompts`, check the CLIP budget, check the rate limit and queue depth.
2. Insert a `jobs` row (`queued`), push the job id to `gen:{model}`, return 202.
3. The worker pops the job and sets `generating` (or `loading_model` on the first job after a cold start).
4. It runs the pipeline with the study parameters from `config/models.toml` and the seeded generator.
5. It encodes the PNG losslessly **in memory**, scores those same bytes, uploads them to storage, and writes the `generations` and `scores` rows. Scoring the bytes that were saved means the stored image and the stored score cannot diverge.
6. It sets `succeeded` with timings, or `failed` with a sanitised error. On CUDA OOM it fails the job; it does not retry by splitting the batch (study lesson v12).
7. The client polls `GET /jobs/{id}` (SSE is optional later).

**Study explorer:** read-only queries on `study_*` tables, plus signed URLs.

## 4. GPU worker design

- **Long-lived, non-forking process.** The pipeline is loaded once at startup and kept in memory. Use an RQ `SimpleWorker`, or a plain `BRPOP` loop. Do not use a forking worker, which would reload about 12–34 GB of weights per job.
- **One model per process / per GPU.** `WORKER_MODEL=flux|sdxl` selects the queue and the pipeline. Two models means two workers, on two GPUs or two serverless endpoints.
- **Batch size 1 by default** for predictable latency. An optional micro-batch collects up to N jobs with identical parameters apart from the seed.
- **FLUX memory.** Live prompts are arbitrary, so the study's embedding cache (v14) **does not apply**. T5 and CLIP stay loaded. On 24 GB cards use fp8_layerwise only if that is the study precision; otherwise use a ≥40 GB GPU for bf16. Never use sequential offload in production (it was 144 s/image in the study).
- Set `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` before CUDA init.
- **Startup checks** (fail fast, the lesson from v8's lazy import failure):
  import-smoke `diffusers` pipelines, `huggingface_hub.auth_check(repo, revision)`
  for the gated FLUX repo, verify the revision sha, and run one warm-up
  generation, logging peak VRAM.
- **Offline at runtime.** Weights are pre-downloaded to the volume by
  `scripts/fetch_weights.py`. The worker runs with `HF_HUB_OFFLINE=1`.
- **Mock backend** (`GENERATOR_BACKEND=mock`) returns a synthetic swatch in the
  target colour with small noise, so the whole stack runs on a laptop without a GPU.

## 5. Repository layout

```
colourlock/
├── CLAUDE.md
├── claude/                      # context docs (this folder)
├── .claude/commands/            # Claude Code slash commands
├── packages/colourlock/         # the measurement package (pip-installable)
│   ├── src/colourlock/{targets,extract,qc,metrics,prompts,stats,config}.py
│   └── tests/{unit,parity}/
├── backend/
│   ├── api/                     # FastAPI app
│   │   ├── app/{main.py,routers/,schemas/,db/,services/,settings.py}
│   │   └── alembic/
│   └── worker/                  # GPU worker
│       └── worker/{main.py,pipelines.py,backends/{diffusers.py,mock.py}}
├── frontend/                    # Next.js + TypeScript
├── config/{models.toml,qc.toml}
├── scripts/{import_study.py,fetch_weights.py}
├── notebooks/ColourLock_v15_local.ipynb
├── infra/
│   ├── docker-compose.yml       # api, postgres, redis, minio, worker(mock)
│   ├── api.Dockerfile
│   └── worker.Dockerfile        # CUDA base, NO weights inside
├── data/                        # gitignored: study PNGs, manifests
└── Makefile
```

## 6. Deployment

| Piece | Hosting | Notes |
|---|---|---|
| Frontend | Vercel / static host | calls the API |
| API | Small container host (Railway / Fly / Render / a VPS) | CPU; 1–2 instances |
| Postgres, Redis | Managed services | small tiers suffice |
| Object storage | Cloudflare R2 or S3 | study images ≈ 2,560 PNGs |
| GPU worker | RunPod Serverless / Modal / HF Endpoints | scale to zero; persistent network volume for `/models/hf_cache`; `HF_TOKEN` in the platform secret store |

Serverless variant: the "queue" is the platform's own job queue. The worker
handler signature stays `handle(job) -> result` so the same code runs under
Redis locally and under the serverless platform in production.

Cold start = container start + loading weights from the volume. The UI must
show a "warming up" state (the `loading_model` status).

## 7. Configuration and secrets

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL`, `REDIS_URL`, `S3_*` | api, worker | infra |
| `HF_TOKEN` | worker secret store only (and `fetch_weights.py`) | gated FLUX repo |
| `HF_HOME` / cache dir | worker | `/models/hf_cache` |
| `WORKER_MODEL` | worker | `flux` or `sdxl` |
| `GENERATOR_BACKEND` | worker | `diffusers` or `mock` |
| `COLOURLOCK_CONFIG_DIR` | api, worker | points to `config/` |

## 8. Failure handling

- CUDA OOM → job fails with `gpu_oom`; alert. No automatic retry.
- Auth or revision failure at startup → the worker refuses to start (never fail 4 hours in).
- 401 or 402-type errors from any upstream → abort, do not retry.
- Transport errors (storage upload) are retried separately from generation.
- A job stuck in a non-terminal state longer than the timeout → marked `failed` by a reaper.

## 9. Why not export or convert the models

The study used off-the-shelf weights unchanged. Exporting to raw PyTorch,
ONNX or TensorRT adds numerical differences and breaks parity with the paper
without adding value at this scale. Optimisation (compile, TensorRT) is only
allowed later as an `off_study` variant with its own validation.
