import os
from pathlib import Path

import pandas as pd
import pytest

STUDY_DIR = Path(__file__).resolve().parents[4] / "data" / "study" / "colourlock_full_study"


def _require_study_dir() -> Path:
    if not STUDY_DIR.exists():
        pytest.skip(f"study dataset not found at {STUDY_DIR}; see claude/roadmap.md Phase 0")
    return STUDY_DIR


@pytest.fixture(scope="session")
def study_dir() -> Path:
    return _require_study_dir()


@pytest.fixture(scope="session")
def all_images_df(study_dir: Path) -> pd.DataFrame:
    return pd.read_csv(study_dir / "all_images.csv")


@pytest.fixture(scope="session")
def reliable_df(study_dir: Path) -> pd.DataFrame:
    return pd.read_csv(study_dir / "reliable_results.csv")


def image_path(study_dir: Path, manifest_path: str) -> Path:
    return study_dir / os.path.basename(manifest_path)
