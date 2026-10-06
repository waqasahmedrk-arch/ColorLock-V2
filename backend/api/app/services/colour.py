"""Display-only Lab -> sRGB hex, so the frontend never converts colour itself.
Out-of-gamut Lab values are clipped; this is for swatches, never for metrics."""

from __future__ import annotations

import numpy as np
from skimage.color import lab2rgb


def lab_to_hex(lab: tuple[float, float, float]) -> str:
    rgb = lab2rgb(np.asarray(lab, dtype=np.float64).reshape(1, 1, 3)).reshape(3)
    r, g, b = np.clip(np.round(rgb * 255), 0, 255).astype(int)
    return f"#{r:02X}{g:02X}{b:02X}"
