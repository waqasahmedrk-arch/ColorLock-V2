"""score_image: the single entry point that ties extraction + QC + chroma together.

Used by both the API's synchronous /score route and the GPU worker (scoring
the same PNG bytes it just generated) -- there is exactly one implementation.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from skimage.color import deltaE_ciede2000

from . import __version__, extract, qc
from .targets import Target


def _chroma(lab: np.ndarray) -> float:
    return float(np.sqrt(lab[1] ** 2 + lab[2] ** 2))


@dataclass(frozen=True)
class QCResult:
    passed: bool
    threshold: float


@dataclass(frozen=True)
class ChromaResult:
    sample: float
    reference: float
    delta: float


@dataclass(frozen=True)
class TargetInfo:
    id: str
    name: str
    hex: str
    lab: tuple[float, float, float]


@dataclass(frozen=True)
class ScoreResult:
    target: TargetInfo
    sample_lab: tuple[float, float, float]
    delta_e00: float
    flat_p95_de: float
    qc: QCResult
    chroma: ChromaResult
    kept_pct: float
    warnings: list[str] = field(default_factory=list)
    package_version: str = __version__


def score_image(image_bytes: bytes, target: Target, cfg: qc.QCConfig) -> ScoreResult:
    rgb, warnings = extract.load_srgb(image_bytes)
    crop = extract.central_crop(rgb, cfg.crop_fraction)

    sample_lab = extract.dominant_lab(crop)
    median_lab = extract.flat_median_lab(crop, stride=cfg.stride)

    flatness = qc.flat_p95_de(crop, median_lab, stride=cfg.stride, percentile=cfg.percentile)
    passed = qc.qc_pass(flatness, cfg.flat_p95_de_max)
    legacy_kept_pct = qc.kept_pct(rgb)

    de00 = float(deltaE_ciede2000(sample_lab.reshape(1, 3), target.lab.reshape(1, 3))[0])

    sample_chroma = _chroma(sample_lab)
    reference_chroma = _chroma(target.lab)

    return ScoreResult(
        target=TargetInfo(id=target.id, name=target.name, hex=target.hex,
                           lab=tuple(target.lab.tolist())),
        sample_lab=tuple(sample_lab.tolist()),
        delta_e00=de00,
        flat_p95_de=flatness,
        qc=QCResult(passed=passed, threshold=cfg.flat_p95_de_max),
        chroma=ChromaResult(sample=sample_chroma, reference=reference_chroma,
                             delta=sample_chroma - reference_chroma),
        kept_pct=legacy_kept_pct,
        warnings=warnings,
    )
