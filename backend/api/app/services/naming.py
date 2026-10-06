"""Mapping between the notebook's identifiers and the API's."""

from __future__ import annotations

from colourlock.prompts import STYLES

# Notebook manifest `model` column -> API model key.
MODEL_KEYS: dict[str, str] = {"FLUX_local": "flux", "SDXL": "sdxl"}
MODEL_LABELS: dict[str, str] = {"flux": "FLUX.1-schnell", "sdxl": "SDXL base 1.0"}

STYLE_CODES: dict[str, str] = {s: s[0] for s in STYLES}  # "A_hex_only" -> "A"
STYLE_DESCRIPTIONS: dict[str, str] = {
    "A_hex_only": "Hex code only",
    "B_named_hex": "Color name plus hex code",
    "C_reference_anchor": "Reference object that has the color, plus its name",
    "D_explicit_cielab": "Explicit CIELAB coordinates plus the name",
    "E_name_only": "Color name only",
}

# Below this many QC-passed images a group's statistics are unstable
# (notebook Step 9 guard rail; requirements FR-1.1; decisions D-16).
LOW_N_THRESHOLD = 10


def resolve_style(value: str) -> str | None:
    """Accept a full style id ("B_named_hex") or its letter ("B")."""
    if value in STYLE_CODES:
        return value
    for style, code in STYLE_CODES.items():
        if value.upper() == code:
            return style
    return None
