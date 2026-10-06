"""Flatness QC gate and the legacy kept_pct metric.

Ported verbatim from notebook `flatness_metrics` and `legacy_bg_mask`.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage
from skimage.color import deltaE_ciede2000, rgb2lab


@dataclass(frozen=True)
class QCConfig:
    flat_p95_de_max: float
    crop_fraction: float = 0.5
    percentile: float = 95
    stride: int = 2


def flat_p95_de(rgb_crop: np.ndarray, median_lab: np.ndarray,
                 stride: int = 2, percentile: float = 95) -> float:
    """95th-percentile ΔE00 of the stride-subsampled crop's pixels from `median_lab`."""
    core = rgb_crop[::stride, ::stride]
    lab = rgb2lab(core / 255.0).reshape(-1, 3)
    de = deltaE_ciede2000(lab, np.tile(median_lab, (len(lab), 1)))
    return float(np.percentile(de, percentile))


def qc_pass(value: float, threshold: float) -> bool:
    return value <= threshold


def kept_pct(rgb_full: np.ndarray, patch: int = 15, distance_threshold: float = 28.0) -> float:
    """Legacy QC metric: % of full-image pixels classified as non-background.

    Ported verbatim from notebook `legacy_bg_mask` / `sample_background_colour`.
    Kept for ablation logging only; not used to gate QC in this study
    (QC_METRIC = "flatness").
    """
    arr = rgb_full.astype(np.float64)
    corners = [
        arr[:patch, :patch], arr[:patch, -patch:],
        arr[-patch:, :patch], arr[-patch:, -patch:],
    ]
    bg_colour = np.concatenate([c.reshape(-1, 3) for c in corners], axis=0).mean(axis=0)
    dist = np.linalg.norm(arr - bg_colour, axis=-1)
    is_background = dist < distance_threshold
    structure = np.ones((5, 5), dtype=bool)  # scipy treats any structure as boolean
    is_background = ndimage.binary_closing(is_background, structure=structure)
    is_background = ndimage.binary_opening(is_background, structure=structure)
    mask = ~is_background
    pct = mask.sum() / mask.size * 100
    # Notebook computes kept_pct from `mask` BEFORE falling back to an
    # all-True mask when empty; the fallback affects only the (unreturned)
    # downstream extraction mask, not this percentage. Keep that order.
    return float(pct)
