# Research context

## 1. People

- **Dr. Saira Moin U Din**: HoD Computer Science, University of Lahore (Sargodha campus); PhD student at University of Sargodha. Project lead.
- **Prof. Lu**: supervisor. Signs off on methodological decisions.
- The study is written up as a TEEP proposal targeting a Q1 journal.

## 2. Study design

| Variable | Value |
|---|---|
| Models | FLUX.1-schnell (local) and SDXL base 1.0 (local) |
| Targets | 8 CSS3/X11 colours spanning the hue wheel |
| Prompt styles | A hex-only · B named + hex · C reference-anchor · D explicit CIELAB · E name-only |
| N per cell | 32 |
| Total | 2 × 8 × 5 × 32 = 2,560 images |
| Reference | CSS3/X11 hex → Lab (not Pantone: licensed and not reproducible; proposal §4.4) |

## 3. Hypotheses

- **H1:** accuracy (ΔE00 to target) and consistency (ΔE00 to group centroid) decouple.
- **H2:** drift is biased toward desaturation. One-sided Wilcoxon signed-rank on `sample_chroma − reference_chroma`. (The v7 version tested deviation from the group's own centroid, which sums to zero by construction; it was fixed in v8.)
- **H3:** one prompt style is more consistent than the others. Levene + Kruskal–Wallis.

## 4. QC

Flatness: `flat_p95_de` = p95 ΔE00 of central-crop pixels from the crop's
median colour. Threshold `FLAT_P95_DE_MAX` started at 3.0 (an uncalibrated
estimate that rejected ~97% of SDXL images) and must be calibrated in Step 7a
and justified visually in Step 7b. `kept_pct` is kept for ablation.
`MAX_RETRIES = 0`: generate once, filter transparently. Retrying to pass QC is
selection on a quality metric and biases the sample.

## 5. Hardware used for the study

RunPod L4, about 22 GiB usable VRAM, 12 vCPU, 94 GB RAM, $0.49/h. SDXL fits
fully resident. FLUX bf16 does not fit on 24 GB (the transformer alone is
~23.8 GB), so on the L4 the options were fp8_layerwise (~12 GB) or bf16 on a
≥40 GB pod.

## 6. Disclosures (must appear in the paper and in the app)

1. The QC threshold (`FLAT_P95_DE_MAX = 3.0`) was fixed before reading ΔE00 results, chosen from the Step 7a rejection-rate distribution plus informal Step 7b visual review at run time (see `decisions.md` D-QC). No separate written per-image visual log survives.
2. FLUX ran at `fp8_layerwise`, not `bf16` (auto-planned for the 22 GiB L4 pod) — a precision change in a colour study, and it creates an asymmetry with SDXL's fp16 (D-15).
3. SDXL receives a negative prompt (`SDXL_USE_NEGATIVE_PROMPT = True`) and FLUX cannot (guidance-distilled, no CFG), so model comparison is partly an instruction comparison (D-13).
4. The reference is CSS3/X11 digital values, not physical Pantone.
5. Both models were trained at 1024 px and run at 512 px. Switching to 1024 is a new condition.
6. Prompt text changed in v13 (the CLIP budget fix), so results are not comparable with v5–v12.
7. **SDXL passes the flatness QC gate on only 0.7% of images (9/1,280) vs FLUX's 59.6% (763/1,280)** at `FLAT_P95_DE_MAX = 3.0`. SDXL's surviving images are one-per-cell across just 9 of 40 (colour × style) cells; no SDXL cell reaches n≥10, and `C_reference_anchor` has zero surviving SDXL images. Any model comparison (H1–H3, the explorer, the paper) must state this rather than imply a like-for-like sample (D-16).

## 7. Notebook history (condensed)

| Ver | Change | Lesson |
|---|---|---|
| v7 | Colab original | hard-coded paths; leaked API keys (treat as burned) |
| v8 | RunPod port, flatness QC, H1/H2 fixes | SDXL died from a lazy import 4.5 h in; Pollinations 429s ate QC retries |
| v9 | pinned `huggingface_hub`, import smoke test, rate limiter | Pollinations key hit 402 |
| v10 | both models local | FLUX repo is gated (401) |
| v11 | HF token handling | `model_info()` can't detect gating; bad token shadowed fixes |
| v12 | `auth_check`, overwrite-style secrets, sequential offload on 24 GB | recursive OOM batch-split made things worse |
| v13 | CLIP 77-token prompt fitting, same clause set for all styles | the old prompt overflowed by different amounts per style (H3 confound) |
| v14 | FLUX embedding cache, `FLUX_PRECISION` plan, Step 4c probes at real batch | sequential offload was 144 s/img |
| v15 | `MAX_RETRIES=0`, `seed_used` provenance fix | 3.0 threshold rejected ~97%; best-of-N biases the sample |

## 8. Lessons that carry over to production

- Fail at startup, not at the first job (import smoke test, `auth_check`, revision check).
- Separate transport retries from quality retries, and never retry on 401/402.
- Record the seed that actually produced the saved file.
- Never quietly truncate prompts; check the CLIP budget explicitly.
- Don't split batches on OOM.
- Keep secrets out of notebooks, images and logs.
