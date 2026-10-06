"""Display-only diagnostics that explain a score: where the flatness QC gate looks, how far
each measured pixel sits from the crop's median colour, and how the sample differs from the
target in lightness, chroma and hue.

Nothing here feeds a metric. The heat map is built from the same package functions the QC
gate uses (central_crop, flat_median_lab, the QC stride), so it shows exactly the pixels that
flat_p95_de summarises; the numbers returned by /score still come only from score_image.
"""

from __future__ import annotations

import base64
import io
import math

import numpy as np
from colourlock import extract
from colourlock.metrics import ScoreResult
from colourlock.qc import QCConfig
from PIL import Image
from pydantic import BaseModel
from skimage.color import deltaE_ciede2000, rgb2lab

# Heat-map colour stops over ΔE00 / threshold: green below the gate, amber at it, red at 2x.
_STOPS = np.array([0.0, 0.5, 1.0, 2.0])
_COLOURS = np.array([
    [34, 139, 84, 70],     # well inside the gate: faint green
    [120, 190, 60, 120],
    [240, 190, 40, 170],   # at the threshold: amber
    [215, 45, 35, 215],    # 2x the threshold and beyond: red
], dtype=np.float64)


class LabDiff(BaseModel):
    """Sample minus target. dH is the CIE ΔH* term (chroma-weighted hue difference)."""

    dL: float
    dC: float
    dH: float
    hue_shift_deg: float | None  # None when either colour is too grey to have a hue


class Explain(BaseModel):
    width: int
    height: int
    crop_box: tuple[int, int, int, int]  # x0, y0, x1, y1 in image pixels
    stride: int
    heatmap_png: str  # data: URI, one pixel per sampled crop pixel, RGBA
    scale_max: float  # ΔE00 at which the heat map saturates (2x the threshold)
    threshold: float
    share_over_threshold: float  # fraction of sampled crop pixels above the threshold
    diff: LabDiff


def _crop_box(h: int, w: int, fraction: float) -> tuple[int, int, int, int]:
    # Same arithmetic as extract.central_crop.
    mh, mw = int(h * (1 - fraction) / 2), int(w * (1 - fraction) / 2)
    return mw, mh, w - mw, h - mh


def _colourise(ratio: np.ndarray) -> np.ndarray:
    r = np.clip(ratio, 0.0, _STOPS[-1])
    out = np.empty(r.shape + (4,), dtype=np.float64)
    for c in range(4):
        out[..., c] = np.interp(r, _STOPS, _COLOURS[:, c])
    return np.round(out).astype(np.uint8)


def _hue_deg(lab: np.ndarray) -> float:
    return math.degrees(math.atan2(lab[2], lab[1])) % 360


def lab_diff(sample: np.ndarray, target: np.ndarray) -> LabDiff:
    c_s, c_t = float(np.hypot(sample[1], sample[2])), float(np.hypot(target[1], target[2]))
    da, db = sample[1] - target[1], sample[2] - target[2]
    dc = c_s - c_t
    dh_sq = max(0.0, float(da * da + db * db - dc * dc))
    shift: float | None = None
    if c_s > 1.0 and c_t > 1.0:  # below ~1 chroma unit the hue angle is noise
        shift = (_hue_deg(sample) - _hue_deg(target) + 180) % 360 - 180
    sign = 1.0 if shift is None or shift >= 0 else -1.0
    return LabDiff(dL=float(sample[0] - target[0]), dC=dc, dH=sign * math.sqrt(dh_sq),
                   hue_shift_deg=shift)


def explain(image_bytes: bytes, scored: ScoreResult, cfg: QCConfig) -> Explain:
    rgb, _ = extract.load_srgb(image_bytes)
    h, w = rgb.shape[:2]
    crop = extract.central_crop(rgb, cfg.crop_fraction)
    median_lab = extract.flat_median_lab(crop, stride=cfg.stride)

    core = crop[:: cfg.stride, :: cfg.stride]
    lab = rgb2lab(core / 255.0)
    de = deltaE_ciede2000(lab.reshape(-1, 3), np.tile(median_lab, (lab.shape[0] * lab.shape[1], 1)))
    de = de.reshape(lab.shape[:2])

    threshold = cfg.flat_p95_de_max
    buf = io.BytesIO()
    Image.fromarray(_colourise(de / threshold)).save(buf, format="PNG", optimize=True)
    uri = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

    return Explain(
        width=w, height=h, crop_box=_crop_box(h, w, cfg.crop_fraction), stride=cfg.stride,
        heatmap_png=uri, scale_max=2 * threshold, threshold=threshold,
        share_over_threshold=float(np.mean(de > threshold)),
        diff=lab_diff(np.asarray(scored.sample_lab), np.asarray(scored.target.lab)),
    )
