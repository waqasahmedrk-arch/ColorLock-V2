from __future__ import annotations

import tomllib
from functools import lru_cache

import colourlock
from colourlock.config import config_dir, load_qc_config
from colourlock.qc import QCConfig

from ..settings import get_settings


@lru_cache
def qc_config() -> QCConfig:
    return load_qc_config()


@lru_cache
def model_config() -> dict:
    with open(config_dir() / "models.toml", "rb") as f:
        return tomllib.load(f)


def provenance() -> dict:
    models = model_config()
    qc = qc_config()
    return {
        "package_version": colourlock.__version__,
        "git_commit": get_settings().git_commit,
        "qc": {
            "flat_p95_de_max": qc.flat_p95_de_max,
            "crop_fraction": qc.crop_fraction,
            "percentile": qc.percentile,
            "stride": qc.stride,
        },
        "models": {
            key: {
                "repo_id": cfg["repo_id"],
                "revision": cfg["revision"],
                "precision": cfg["precision"],
                "steps": cfg["steps"],
                "guidance": cfg["guidance"],
                "resolution": cfg["resolution"],
            }
            for key, cfg in models.items()
        },
        "study_run": "20260913T083658Z",
    }
