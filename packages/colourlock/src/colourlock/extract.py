"""Colour extraction: sRGB decode, central crop, dominant-cluster sample colour.

Two independent "central colour" computations exist here and must stay
separate (see claude/specs.md §2):

- `dominant_lab` is the colour reported as a sample's Lab value and compared
  to the target (accuracy). It is a KMeans dominant-cluster centroid, not a
  median, ported verbatim from notebook `extract_pca_dominant_rgb` +
  `_rgb_cols_to_lab`.
- `flat_median_lab` is used only by `colourlock.qc.flat_p95_de` for the
  flatness QC gate. It is a stride-subsampled per-channel median.
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageCms
from skimage.color import lab2rgb, rgb2lab
from sklearn.cluster import KMeans

MAX_IMAGE_PIXELS = 2048 * 2048 * 4  # decompression-bomb guard, matches the 2048px upload limit


def load_srgb(image_bytes: bytes) -> tuple[np.ndarray, list[str]]:
    """Decode an uploaded image to (H, W, 3) uint8 sRGB, with warnings.

    Not part of the notebook (uploads are a new, app-only code path) --
    FR-2.1/FR-2.4 in requirements.md.
    """
    warnings: list[str] = []
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    img: Image.Image = Image.open(io.BytesIO(image_bytes))

    if getattr(img, "format", None) == "JPEG":
        warnings.append("jpeg_input")

    icc_bytes = img.info.get("icc_profile")
    if icc_bytes:
        try:
            src_profile = ImageCms.ImageCmsProfile(io.BytesIO(icc_bytes))
            srgb_profile = ImageCms.createProfile("sRGB")
            if src_profile.profile.profile_description not in ("sRGB", "sRGB IEC61966-2.1"):
                warnings.append("icc_profile_non_srgb")
            converted = ImageCms.profileToProfile(img, src_profile, srgb_profile,
                                                  outputMode="RGB")
            if converted is not None:  # only None when converting in place
                img = converted
        except (OSError, ValueError, ImageCms.PyCMSError):
            warnings.append("icc_profile_unreadable")

    if img.mode in ("RGBA", "LA", "P"):
        rgba = img.convert("RGBA")
        if rgba.getchannel("A").getextrema() != (255, 255):
            warnings.append("alpha_flattened")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        img = background
    else:
        img = img.convert("RGB")

    return np.array(img, dtype=np.uint8), warnings


def central_crop(rgb: np.ndarray, fraction: float = 0.5) -> np.ndarray:
    """Central `fraction` crop by area-fraction of each side (0.5 = middle 50%)."""
    h, w = rgb.shape[:2]
    mh, mw = int(h * (1 - fraction) / 2), int(w * (1 - fraction) / 2)
    return rgb[mh : h - mh, mw : w - mw]


def to_lab(rgb: np.ndarray) -> np.ndarray:
    """uint8/float RGB (..., 3) in [0, 255] -> Lab, same shape."""
    return np.asarray(rgb2lab(np.asarray(rgb, dtype=np.float64) / 255.0), dtype=np.float64)


def dominant_lab(
    rgb_crop: np.ndarray,
    n_clusters: int = 4,
    max_px: int = 20_000,
    seed: int = 0,
) -> np.ndarray:
    """The sample colour: largest KMeans cluster in Lab, round-tripped through RGB.

    Ported verbatim from notebook `extract_pca_dominant_rgb` (CLUSTER_SELECTION
    = "largest", the v8 default -- chroma-weighted selection was rejected as an
    H2 confound) followed by `_rgb_cols_to_lab`'s RGB->Lab conversion of the
    stored dominant-colour columns. The intermediate RGB round-trip (Lab
    centroid -> lab2rgb -> clip -> rgb2lab) is not a no-op and must be kept
    exactly for parity.
    """
    pixels = rgb_crop.reshape(-1, 3).astype(np.float64)
    if len(pixels) < n_clusters * 5:
        dominant_rgb = pixels.mean(axis=0)
    else:
        if len(pixels) > max_px:
            idx = np.random.default_rng(seed).choice(len(pixels), max_px, replace=False)
            pixels = pixels[idx]
        lab_pixels = rgb2lab((pixels / 255.0).reshape(-1, 1, 3)).reshape(-1, 3)
        k = min(n_clusters, len(pixels))
        km = KMeans(n_clusters=k, n_init=4, random_state=seed)
        labels = km.fit_predict(lab_pixels)
        centroids = km.cluster_centers_
        sizes = np.bincount(labels, minlength=len(centroids))
        best_cluster = int(np.argmax(sizes))
        dominant_rgb01 = lab2rgb(centroids[best_cluster].reshape(1, 1, 3)).reshape(3)
        dominant_rgb = np.clip(dominant_rgb01 * 255.0, 0, 255)
    lab = rgb2lab((dominant_rgb / 255.0).reshape(1, 1, 3)).reshape(3)
    return np.asarray(lab, dtype=np.float64)


def flat_median_lab(rgb_crop: np.ndarray, stride: int = 2) -> np.ndarray:
    """QC-only median Lab colour of the stride-subsampled crop. NOT sample_lab."""
    core = rgb_crop[::stride, ::stride]
    lab = rgb2lab(core / 255.0).reshape(-1, 3)
    return np.asarray(np.median(lab, axis=0), dtype=np.float64)
