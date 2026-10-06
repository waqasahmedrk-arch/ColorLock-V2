"""Synthetic-swatch tests (conventions.md): a flat image of target hex X gives
ΔE00 ≈ 0 and qc_pass True; a noisy/gradient image gives a high flat_p95_de."""

import io

import numpy as np
import pytest
from PIL import Image

from colourlock.metrics import score_image
from colourlock.qc import QCConfig
from colourlock.targets import TARGETS


def _png_bytes(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr.astype(np.uint8), mode="RGB").save(buf, format="PNG")
    return buf.getvalue()


def _flat_swatch(hex_code: str, size: int = 512) -> bytes:
    rgb = np.array([int(hex_code[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.uint8)
    arr = np.tile(rgb, (size, size, 1))
    return _png_bytes(arr)


def _gradient_swatch(size: int = 512) -> bytes:
    ramp = np.linspace(0, 255, size, dtype=np.uint8)
    arr = np.zeros((size, size, 3), dtype=np.uint8)
    arr[:, :, 0] = ramp[np.newaxis, :]
    arr[:, :, 1] = ramp[:, np.newaxis]
    arr[:, :, 2] = 128
    return _png_bytes(arr)


@pytest.fixture
def cfg() -> QCConfig:
    return QCConfig(flat_p95_de_max=3.0)


@pytest.mark.parametrize("colour_id", list(TARGETS))
def test_flat_swatch_scores_near_zero(colour_id, cfg):
    target = TARGETS[colour_id]
    result = score_image(_flat_swatch(target.hex), target, cfg)
    assert result.delta_e00 < 0.5
    assert result.flat_p95_de < 0.5
    assert result.qc.passed is True


def test_gradient_swatch_fails_flatness(cfg):
    target = TARGETS["royal_blue"]
    result = score_image(_gradient_swatch(), target, cfg)
    assert result.flat_p95_de > cfg.flat_p95_de_max
    assert result.qc.passed is False


def test_mismatched_flat_swatch_has_high_delta_e00(cfg):
    # A flat crimson swatch scored against the royal_blue target should be far off.
    result = score_image(_flat_swatch(TARGETS["crimson"].hex), TARGETS["royal_blue"], cfg)
    assert result.delta_e00 > 20
    # Still flat, so QC still passes -- accuracy and QC are independent axes.
    assert result.qc.passed is True


def test_chroma_delta_sign_desaturation(cfg):
    # A grey swatch has near-zero chroma; a saturated target has high chroma,
    # so chroma.delta (sample - reference) should be strongly negative.
    target = TARGETS["crimson"]
    grey = _png_bytes(np.full((512, 512, 3), 128, dtype=np.uint8))
    result = score_image(grey, target, cfg)
    assert result.chroma.delta < -20
