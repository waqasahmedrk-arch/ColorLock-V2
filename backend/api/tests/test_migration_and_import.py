"""The Alembic migration builds the same schema as the ORM models, and the
real import over data/study/ reproduces the notebook's printed results."""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect

REPO = Path(__file__).resolve().parents[3]
API_DIR = REPO / "backend" / "api"
STUDY_DIR = REPO / "data" / "study" / "colourlock_full_study"


def _migrate(db_url: str) -> None:
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=API_DIR,
                   env={**os.environ, "DATABASE_URL": db_url}, check=True, capture_output=True)


def test_migration_matches_models(tmp_path):
    from app.db.models import Base

    url = f"sqlite:///{(tmp_path / 'm.db').as_posix()}"
    _migrate(url)
    insp = inspect(create_engine(url))
    for table in Base.metadata.sorted_tables:
        migrated = {c["name"] for c in insp.get_columns(table.name)}
        assert migrated == {c.name for c in table.columns}, table.name


@pytest.mark.slow
@pytest.mark.skipif(not STUDY_DIR.exists(), reason="study dataset not present")
def test_real_import_reproduces_notebook(tmp_path):
    from sqlalchemy.orm import Session

    from app.db.models import StudyGroup, StudyHypothesis, StudyImage

    url = f"sqlite:///{(tmp_path / 'i.db').as_posix()}"
    _migrate(url)
    subprocess.run([sys.executable, str(REPO / "scripts" / "import_study.py"),
                    "--database-url", url, "--files", "none"], check=True, capture_output=True)
    with Session(create_engine(url)) as db:
        assert db.query(StudyImage).count() == 2560
        assert db.query(StudyImage).filter(StudyImage.qc_pass.is_(True)).count() == 772
        assert db.query(StudyGroup).count() == 80
        sdxl_pass = db.query(StudyImage).filter_by(model="sdxl", qc_pass=True).count()
        assert sdxl_pass == 9
        h = {r.id: r for r in db.query(StudyHypothesis)}
    # Printed in the notebook's Step 10 output cell.
    assert h["H1"].statistic == pytest.approx(0.279, abs=5e-4)
    assert h["H2"].statistic == pytest.approx(159371.0)
    assert h["H3"].statistic == pytest.approx(415.80, abs=5e-2)
    assert h["H1"].extra["per_model"]["sdxl"]["n_groups_ge_10"] == 0
