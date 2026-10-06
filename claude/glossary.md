# Glossary

| Term | Meaning |
|---|---|
| ΔE00 / dE00 | CIEDE2000 colour difference. Around 1 is barely perceptible; above about 5 is clearly different. |
| CIELAB / Lab | Perceptual colour space: L* lightness, a* green–red, b* blue–yellow. |
| C* (chroma) | sqrt(a*² + b*²): colourfulness. Lower chroma means more desaturated. |
| Accuracy | ΔE00 from sample to target. |
| Consistency | ΔE00 from sample to its group centroid (group = model × colour × style). |
| Flatness / `flat_p95_de` | p95 ΔE00 of crop pixels from the crop's median colour. The QC metric. |
| `FLAT_P95_DE_MAX` | QC threshold on flatness. Calibrated in Step 7a. |
| `kept_pct` | Legacy QC metric kept for ablation. |
| Slot | Index i (0–31) of an image within a group. |
| `seed_used` | The seed that produced the committed file (`slot + attempt*1000`). |
| Prompt styles A–E | Hex-only, named + hex, reference-anchor, explicit CIELAB, name-only. |
| CLIP budget | 77-token limit of the CLIP text encoders; overflow is silently truncated. |
| fp8_layerwise | fp8 weight storage with bf16 compute (`enable_layerwise_casting`). |
| Off-study | A generation whose parameters differ from the study; it is flagged and not comparable. |
| Step 4c / 7a / 7b | Notebook steps: GPU probe and determinism check / threshold calibration / borderline-image visual review. |
| Gated repo | HF repo that needs accepted terms and an authenticated token (FLUX.1-schnell). |
