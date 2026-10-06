import io

import numpy as np
import pytest
from PIL import Image

from .conftest import png_bytes

pytestmark = pytest.mark.anyio

TEAL = (0x00, 0x80, 0x80)


async def test_flat_swatch_scores_near_zero(client):
    r = await client.post("/score", files={"image": ("s.png", png_bytes(TEAL), "image/png")},
                          data={"target_id": "teal"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["delta_e00"] < 0.5
    assert body["qc"] == {"pass": True, "threshold": 3.0}
    assert body["target"]["hex"] == "#008080"
    assert body["warnings"] == []
    assert body["score_id"]


async def test_score_is_deterministic(client):
    noisy = np.clip(np.random.default_rng(1).normal(128, 30, (96, 96, 3)), 0, 255)
    buf = io.BytesIO()
    Image.fromarray(noisy.astype(np.uint8)).save(buf, format="PNG")
    results = []
    for _ in range(2):
        r = await client.post("/score", files={"image": ("n.png", buf.getvalue(), "image/png")},
                              data={"target_hex": "#808080"})
        body = r.json()
        body.pop("score_id")
        results.append(body)
    assert results[0] == results[1]


async def test_score_persists_row(client):
    from app.db.models import Score
    from app.db.session import get_sessionmaker

    r = await client.post("/score", files={"image": ("s.png", png_bytes(TEAL), "image/png")},
                          data={"target_id": "teal"})
    with get_sessionmaker()() as db:
        row = db.get(Score, r.json()["score_id"])
    assert row.source == "upload" and row.qc_threshold == 3.0
    assert row.result["qc"]["pass"] is True


async def test_jpeg_warns(client):
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), TEAL).save(buf, format="JPEG")
    r = await client.post("/score", files={"image": ("s.jpg", buf.getvalue(), "image/jpeg")},
                          data={"target_id": "teal"})
    assert "jpeg_input" in r.json()["warnings"]


@pytest.mark.parametrize("data,status", [
    ({}, 422),
    ({"target_id": "teal", "target_hex": "#008080"}, 422),
    ({"target_id": "not_a_colour"}, 422),
    ({"target_hex": "teal"}, 422),
])
async def test_target_validation(client, data, status):
    r = await client.post("/score", files={"image": ("s.png", png_bytes(TEAL), "image/png")},
                          data=data)
    assert r.status_code == status
    assert r.headers["content-type"].startswith("application/problem+json")


async def test_rejects_non_image(client):
    r = await client.post("/score", files={"image": ("x.png", b"not an image", "image/png")},
                          data={"target_id": "teal"})
    assert r.status_code == 415


async def test_rejects_gif(client):
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), TEAL).save(buf, format="GIF")
    r = await client.post("/score", files={"image": ("x.gif", buf.getvalue(), "image/gif")},
                          data={"target_id": "teal"})
    assert r.status_code == 415


async def test_rejects_oversized_dimensions(client):
    buf = io.BytesIO()
    Image.new("RGB", (2049, 10), TEAL).save(buf, format="PNG")
    r = await client.post("/score", files={"image": ("big.png", buf.getvalue(), "image/png")},
                          data={"target_id": "teal"})
    assert r.status_code == 413


async def test_rejects_oversized_bytes(client, monkeypatch):
    from app.settings import get_settings

    monkeypatch.setattr(get_settings(), "max_upload_bytes", 100)
    r = await client.post("/score", files={"image": ("s.png", png_bytes(TEAL), "image/png")},
                          data={"target_id": "teal"})
    assert r.status_code == 413
