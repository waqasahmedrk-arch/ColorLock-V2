import base64
import io

import numpy as np
import pytest
from PIL import Image

from .conftest import png_bytes

pytestmark = pytest.mark.anyio

TEAL = (0x00, 0x80, 0x80)


def _png(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr.astype(np.uint8)).save(buf, format="PNG")
    return buf.getvalue()


async def test_batch_scores_each_image_against_one_target(client):
    files = [
        ("images", ("a.png", png_bytes(TEAL), "image/png")),
        ("images", ("b.png", png_bytes((200, 40, 40)), "image/png")),
    ]
    r = await client.post("/score/batch", files=files, data={"target_id": "teal"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["target"]["hex"] == "#008080" and body["qc_threshold"] == 3.0
    a, b = body["items"]
    assert (a["index"], a["filename"], a["error"]) == (0, "a.png", None)
    assert a["result"]["delta_e00"] < 0.5 and a["result"]["qc"]["pass"] is True
    assert b["result"]["delta_e00"] > 20


async def test_batch_matches_single_score(client):
    noisy = np.clip(np.random.default_rng(3).normal(120, 25, (80, 80, 3)), 0, 255)
    data = _png(noisy)
    single = (await client.post("/score", files={"image": ("n.png", data, "image/png")},
                                data={"target_hex": "#7A7A7A"})).json()
    batch = (await client.post("/score/batch", files=[("images", ("n.png", data, "image/png"))],
                               data={"target_hex": "#7A7A7A"})).json()
    one = batch["items"][0]["result"]
    for key in ("delta_e00", "flat_p95_de", "sample_lab", "qc", "chroma", "kept_pct"):
        assert one[key] == single[key], key


async def test_batch_reports_bad_files_per_row(client):
    files = [
        ("images", ("ok.png", png_bytes(TEAL), "image/png")),
        ("images", ("bad.png", b"not an image", "image/png")),
    ]
    body = (await client.post("/score/batch", files=files, data={"target_id": "teal"})).json()
    ok, bad = body["items"]
    assert ok["result"] is not None
    assert bad["result"] is None and bad["error"]["title"] == "Unsupported image"


async def test_batch_rejects_too_many_files(client, monkeypatch):
    monkeypatch.setattr("app.routers.score.get_settings",
                        lambda: type("S", (), {"max_batch_files": 1, "max_upload_bytes": 10**7,
                                               "max_batch_bytes": 10**8,
                                               "max_upload_long_side": 2048})())
    files = [("images", (f"{i}.png", png_bytes(TEAL), "image/png")) for i in range(2)]
    r = await client.post("/score/batch", files=files, data={"target_id": "teal"})
    assert r.status_code == 413


async def test_explain_is_opt_in_and_matches_the_gate(client):
    plain = (await client.post("/score", files={"image": ("s.png", png_bytes(TEAL), "image/png")},
                               data={"target_id": "teal"})).json()
    assert plain.get("explain") is None

    # Left half flat teal, right half noisy: the crop straddles both.
    arr = np.full((64, 64, 3), TEAL, dtype=np.float64)
    arr[:, 32:] = np.random.default_rng(0).normal(128, 60, (64, 32, 3))
    r = await client.post("/score", files={"image": ("h.png", _png(np.clip(arr, 0, 255)), "image/png")},
                          data={"target_id": "teal", "explain": "true"})
    body = r.json()
    ex = body["explain"]
    assert (ex["width"], ex["height"], ex["crop_box"]) == (64, 64, [16, 16, 48, 48])
    assert ex["threshold"] == 3.0 and ex["scale_max"] == 6.0
    assert 0 < ex["share_over_threshold"] < 1
    png = base64.b64decode(ex["heatmap_png"].split(",", 1)[1])
    with Image.open(io.BytesIO(png)) as im:
        assert im.mode == "RGBA" and im.size == (16, 16)  # 32 px crop at stride 2
    # p95 of the same pixels is what the gate used: over-threshold share above 5% means fail.
    assert (ex["share_over_threshold"] > 0.05) == (not body["qc"]["pass"])


async def test_explain_lab_diff_signs(client):
    # A darker, greyer teal than the target.
    body = (await client.post(
        "/score", files={"image": ("d.png", png_bytes((20, 80, 80)), "image/png")},
        data={"target_id": "teal", "explain": "true"})).json()
    diff = body["explain"]["diff"]
    assert diff["dL"] < 0
    assert diff["dC"] == pytest.approx(body["chroma"]["delta"])
