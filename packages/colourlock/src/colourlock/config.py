"""Loads config/qc.toml into a QCConfig. Never hard-code FLAT_P95_DE_MAX (rule 10)."""

from __future__ import annotations

import os
import tomllib
from pathlib import Path

from .qc import QCConfig

CONFIG_DIR_ENV = "COLOURLOCK_CONFIG_DIR"


def config_dir() -> Path:
    env = os.environ.get(CONFIG_DIR_ENV)
    if env:
        return Path(env)
    # Local dev: repo_root/config, four levels up from this file
    # (src/colourlock/config.py -> colourlock -> src -> packages/colourlock -> repo root).
    repo = Path(__file__).resolve().parents[4] / "config"
    if repo.is_dir():
        return repo
    # Installed from a wheel (e.g. on Vercel): the copy setup.py bundled at build time.
    bundled = Path(__file__).resolve().parent / "_config"
    return bundled if bundled.is_dir() else repo


def load_qc_config(config_dir_override: Path | None = None) -> QCConfig:
    path = (config_dir_override or config_dir()) / "qc.toml"
    with open(path, "rb") as f:
        data = tomllib.load(f)
    qc = data["qc"]
    return QCConfig(
        flat_p95_de_max=qc["flat_p95_de_max"],
        crop_fraction=qc.get("crop_fraction", 0.5),
        percentile=qc.get("percentile", 95),
    )
