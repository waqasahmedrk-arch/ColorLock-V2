"""The 8 CSS3/X11 study targets. Verbatim from notebook Step 2 (`ALL_COLOURS`).

Source of truth: notebooks/ColourLock_v15_local.ipynb, cell defining
`ALL_COLOURS`. Do not add, remove or reorder without updating claude/specs.md.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from skimage.color import rgb2lab


@dataclass(frozen=True)
class Target:
    id: str
    name: str
    hex: str
    anchor_object: str
    lab: np.ndarray  # (3,) float64: L, a, b

    def __post_init__(self) -> None:
        object.__setattr__(self, "lab", np.asarray(self.lab, dtype=np.float64))


def hex_to_rgb255(hex_code: str) -> np.ndarray:
    hex_code = hex_code.lstrip("#")
    return np.array([int(hex_code[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def rgb255_to_lab(rgb_0_255: np.ndarray) -> np.ndarray:
    rgb01 = np.asarray(rgb_0_255, dtype=np.float64).reshape(1, 1, 3) / 255.0
    return np.asarray(rgb2lab(rgb01), dtype=np.float64).reshape(3)


_ALL_COLOURS: list[dict[str, str]] = [
    {"id": "royal_blue", "hex": "4169E1", "colour_name": "royal blue",
     "anchor_object": "a classic cobalt-blue glass medicine bottle"},
    {"id": "firebrick_red", "hex": "B22222", "colour_name": "firebrick red",
     "anchor_object": "a weathered terracotta brick facade"},
    {"id": "forest_green", "hex": "228B22", "colour_name": "forest green",
     "anchor_object": "a dense pine forest canopy"},
    {"id": "goldenrod", "hex": "DAA520", "colour_name": "goldenrod",
     "anchor_object": "a ripe field of wheat at harvest"},
    {"id": "dark_orchid", "hex": "9932CC", "colour_name": "dark orchid purple",
     "anchor_object": "a fresh purple orchid blossom"},
    {"id": "sienna_brown", "hex": "A0522D", "colour_name": "sienna brown",
     "anchor_object": "a piece of tanned saddle leather"},
    {"id": "teal", "hex": "008080", "colour_name": "teal",
     "anchor_object": "a shallow tropical lagoon"},
    {"id": "crimson", "hex": "DC143C", "colour_name": "crimson",
     "anchor_object": "a ripe pomegranate seed cluster"},
]


def _build_targets() -> dict[str, Target]:
    targets = {}
    for c in _ALL_COLOURS:
        lab = rgb255_to_lab(hex_to_rgb255(c["hex"]))
        targets[c["id"]] = Target(
            id=c["id"], name=c["colour_name"], hex=c["hex"],
            anchor_object=c["anchor_object"], lab=lab,
        )
    return targets


TARGETS: dict[str, Target] = _build_targets()


def target_from_hex(hex_code: str) -> Target:
    """Build an ad-hoc Target from an arbitrary #RRGGBB hex (for user uploads)."""
    hex_code = hex_code.lstrip("#").upper()
    if len(hex_code) != 6:
        raise ValueError(f"expected a 6-digit hex colour, got {hex_code!r}")
    lab = rgb255_to_lab(hex_to_rgb255(hex_code))
    return Target(id=f"hex_{hex_code}", name=f"#{hex_code}", hex=hex_code,
                  anchor_object="", lab=lab)
