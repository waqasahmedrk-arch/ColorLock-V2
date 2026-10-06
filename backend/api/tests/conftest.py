from __future__ import annotations

import io
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import numpy as np
import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image


def png_bytes(rgb: tuple[int, int, int], size: int = 64) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(np.full((size, size, 3), rgb, dtype=np.uint8)).save(buf, format="PNG")
    return buf.getvalue()


def _clear_caches() -> None:
    from app import deps
    from app.db import auth, session
    from app.settings import get_settings

    for fn in (get_settings, session.get_engine, session.get_sessionmaker, deps.get_storage,
               auth.get_auth_sessionmaker):
        fn.cache_clear()


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{(tmp_path / 'test.db').as_posix()}")
    monkeypatch.setenv("LOCAL_STORAGE_ROOT", str(tmp_path / "storage"))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("URL_SIGNING_SECRET", "test-secret")
    # Accounts share the per-test SQLite file; no MySQL server needed.
    monkeypatch.setenv("AUTH_DATABASE_URL", f"sqlite:///{(tmp_path / 'auth.db').as_posix()}")
    monkeypatch.setenv("EMAIL_BACKEND", "console")
    _clear_caches()
    from app.db.models import Base
    from app.db.session import get_engine

    Base.metadata.create_all(get_engine())
    yield tmp_path
    get_engine().dispose()
    _clear_caches()


@pytest.fixture
def seeded(env: Path) -> Path:
    """Two study images (one per model), their groups and one hypothesis."""
    from colourlock.targets import TARGETS

    from app.db.models import StudyGroup, StudyHypothesis, StudyImage
    from app.db.session import get_sessionmaker
    from app.deps import get_storage
    from app.services.storage import study_key

    storage = get_storage()
    lab = TARGETS["teal"].lab
    with get_sessionmaker()() as db:
        for model, image_id, qc in (("flux", "FLUX_local_teal_B_named_hex_01", True),
                                    ("sdxl", "SDXL_teal_B_named_hex_01", False)):
            key = study_key(model, "teal", "B_named_hex", image_id)
            storage.put(key, png_bytes((0, 128, 128)))
            db.add(StudyImage(
                image_id=image_id, model=model, target_id="teal", style="B_named_hex", slot=1,
                seed_used=1, prompt_hash="abc", generated_at="2026-09-13", file_key=key,
                delta_e00=1.5, flat_p95_de=1.0 if qc else 9.0, qc_pass=qc, chroma_sample=30.0,
                chroma_reference=31.0, chroma_delta=-1.0, consistency_de00=0.5 if qc else None,
                kept_pct=10.0, sample_L=float(lab[0]), sample_a=float(lab[1]),
                sample_b=float(lab[2]),
            ))
            db.add(StudyGroup(model=model, target_id="teal", style="B_named_hex", n=32,
                              n_qc_pass=20 if qc else 0,
                              accuracy_mean=1.5 if qc else None))
        db.add(StudyHypothesis(id="H2", name="desat", test="wilcoxon_signed_rank",
                               statistic=1.0, p_value=0.9, direction="not_significant",
                               notes="n", extra={}))
        db.commit()
    return env


@pytest.fixture
async def client(env: Path) -> AsyncIterator[AsyncClient]:
    from app.main import create_app

    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test/api/v1") as c:
        yield c
