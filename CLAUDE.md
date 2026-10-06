# ColourLock — Claude Code entry point

Read this file first. It is short on purpose; details live in `claude/`.

## What this project is

ColourLock is a **measurement study**, not a trained model. It measures how
accurately and consistently two off-the-shelf text-to-image models
(FLUX.1-schnell and SDXL base 1.0) reproduce a specified colour. The research
notebook (`notebooks/ColourLock_v15_local.ipynb`) produced a 2,560-image
dataset and the results for three pre-registered hypotheses.

We are now turning it into a live web application:

1. **Study explorer**: browse the frozen published results (no GPU).
2. **Score an image**: upload an image, give a target hex, get ΔE00, flatness QC and chroma drift (CPU only).
3. **Generate + score**: generate with FLUX or SDXL, then score (GPU worker).

## The one idea that governs everything

**The models are not ours. The measurement is.** Models load from Hugging Face
with `diffusers` at pinned revisions. Nothing is trained, fine-tuned, exported
or converted. The code we own is the `colourlock` package (targets, QC,
extraction, metrics, stats), and it must reproduce the notebook's numbers
exactly.

## Where to look

| Need | File |
|---|---|
| What we are building and acceptance criteria | `claude/requirements.md` |
| Exact metric formulas, API contracts, DB schema | `claude/specs.md` |
| Backend components, data flow, repo layout, deployment | `claude/architecture.md` |
| The research: hypotheses, metrics, disclosures, notebook history | `claude/research-context.md` |
| Closed decisions (do not re-litigate) | `claude/decisions.md` |
| Code style, testing, secrets, git | `claude/conventions.md` |
| Ordered task list and current status | `claude/roadmap.md` |
| Terms and abbreviations | `claude/glossary.md` |

Read `architecture.md` and `specs.md` before writing backend code. Read
`research-context.md` before touching anything in `packages/colourlock/`.

## Hard rules

1. **The notebook is the source of truth for metric behaviour.** If a doc and
   the notebook disagree, the notebook wins. Flag the discrepancy; do not
   silently pick one.
2. **Parity before features.** Any change to `packages/colourlock/` must keep
   `tests/parity/` green (package output on the saved study images matches the
   notebook manifest).
3. **Pin model revisions.** Never call `from_pretrained` without `revision=<sha>`.
   The shas live in `config/models.toml`.
4. **Precision must match the study** unless the result row records otherwise.
   Every generation result stores `model_id`, `revision`, `precision`, `seed`.
5. **No secrets in code, images, logs or commits.** `HF_TOKEN` comes from the
   environment only.
6. **No weights in Docker images.** Weights live on a mounted volume.
7. **One diffusion model resident per GPU process.** Never load FLUX and SDXL together.
8. **Validate prompts against the 77-token CLIP budget** before generation.
9. **Study-level statistics (consistency, H1–H3) are never computed per request.**
   They belong to the frozen study dataset only.
10. `FLAT_P95_DE_MAX` is read from config, never hard-coded, and is recorded
    with every score.

## Common commands

```bash
make dev          # docker compose: api, postgres, redis, minio (mock generator)
make test         # unit tests
make parity       # package vs notebook manifest on the study images
make lint         # ruff + mypy
make worker-gpu   # run the GPU worker locally (needs CUDA + HF_TOKEN)
```

(If these targets do not exist yet, creating them is part of roadmap phase 1.)
