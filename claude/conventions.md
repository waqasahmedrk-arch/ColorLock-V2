# Conventions

## Python
- Python 3.11. Type hints everywhere; `mypy --strict` on `packages/colourlock`.
- Format and lint with `ruff` (format + lint). Line length 100.
- Pydantic v2 for all API schemas and config models.
- Use `numpy` float64 in metric code. No float32 shortcuts in the package; parity depends on it.
- The package has no web or DB dependencies: it depends only on numpy, scikit-image, Pillow, scipy, pandas (stats), scikit-learn (KMeans dominant-colour extraction — required, not optional: it's on the `sample_lab` critical path, see specs.md §2), and transformers (tokenizer only, as an optional extra `[prompts]`).
- KMeans in `extract.py` must pass `random_state=0` (the notebook's `GLOBAL_SEED`) and the same subsampling RNG (`np.random.default_rng(0)`) whenever crop pixels exceed 20,000, or parity will fail non-deterministically.
- Diffusers and torch are dependencies of the worker only, never of the API.

## Testing
- `tests/unit`: synthetic swatches. A flat image of target hex X gives ΔE00 ≈ 0 and `qc_pass` True; a noisy or gradient image gives a high `flat_p95_de`; a known Lab pair matches published CIEDE2000 test data (Sharma et al. 2005).
- `tests/parity`: run the package over `data/study/` and compare with the notebook manifest (tolerance 1e-6). Mark as slow; required in CI before merging package changes.
- API tests use `httpx.AsyncClient` with the mock generator backend.
- The worker has a GPU smoke test (`pytest -m gpu`) that is not run in CI.

## Git
- Conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).
- Never commit: `data/`, weights, `.env`, notebook outputs with images, tokens.
- Strip notebook outputs before committing (`nbstripout`).

## Secrets
- `.env.example` lists variable names only. Real values live in `.env` (gitignored) or the platform secret store.
- Never log request headers or environment dumps. Redact anything matching `hf_[A-Za-z0-9]+`.

## Changing metric code
1. Read `research-context.md` and the relevant notebook cell first.
2. Make the change and run `make parity`.
3. If numbers change intentionally, that is a methodological change: record it in `decisions.md` and bump the package minor version.

## Working style for Claude
- Prefer small, reviewable diffs.
- When a spec item is marked **VERIFY**, look at the notebook and update `specs.md` in the same change.
- Ask before changing anything in `config/qc.toml` or `config/models.toml`.
