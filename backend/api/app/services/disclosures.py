"""Methodological disclosures shown on every results page (FR-1.4).
Source: claude/research-context.md §6. Keep the two in sync."""

DISCLOSURES: list[dict[str, object]] = [
    {
        "id": 1,
        "title": "QC threshold fixed before results were read",
        "text": (
            "The flatness threshold (flat_p95_de ≤ 3.0 ΔE00) was fixed before any ΔE00 "
            "result was read. It was chosen from the rejection-rate distribution plus an "
            "informal visual review of borderline images at run time. No written per-image "
            "log of that review survives."
        ),
    },
    {
        "id": 2,
        "title": "FLUX ran at fp8, not bf16",
        "text": (
            "FLUX.1-schnell ran at fp8_layerwise precision because bf16 does not fit on "
            "the 22 GiB L4 GPU used. This is a precision change in a color study, and SDXL "
            "ran at fp16, so the two models also differ in precision."
        ),
    },
    {
        "id": 3,
        "title": "Only SDXL receives a negative prompt",
        "text": (
            "SDXL is given a negative prompt; FLUX.1-schnell is guidance-distilled and "
            "cannot use one. Comparing the models is therefore partly comparing the "
            "instructions they received."
        ),
    },
    {
        "id": 4,
        "title": "Digital reference colors, not Pantone",
        "text": (
            "Targets are CSS3/X11 digital color values converted to CIELAB, not "
            "physical Pantone references."
        ),
    },
    {
        "id": 5,
        "title": "Run at 512 px",
        "text": (
            "Both models were trained at 1024 px and run at 512 px here. Results at 1024 px "
            "would be a new experimental condition."
        ),
    },
    {
        "id": 6,
        "title": "Prompt text changed in v13",
        "text": (
            "Prompts were rewritten in notebook v13 to fit CLIP's 77-token limit with the "
            "same instruction clauses for every style. Results are not comparable with "
            "earlier notebook versions (v5–v12)."
        ),
    },
    {
        "id": 7,
        "title": "Almost no SDXL images pass QC",
        "text": (
            "Only 9 of 1,280 SDXL images (0.7%) pass the flatness QC gate, against 763 of "
            "1,280 FLUX images (59.6%). The 9 are one per cell across 9 of SDXL's 40 "
            "color × style cells; no SDXL cell reaches 10 images, and the reference-anchor "
            "style has none. Pooled results and model comparisons rest almost entirely on "
            "FLUX."
        ),
    },
]
