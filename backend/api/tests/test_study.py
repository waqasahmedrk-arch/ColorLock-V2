import pytest

pytestmark = pytest.mark.anyio


async def test_summary_flags_low_n(client, seeded):
    body = (await client.get("/study/summary")).json()
    by_model = {g["model"]: g for g in body}
    assert by_model["flux"]["low_n"] is False and by_model["flux"]["n_qc_pass"] == 20
    assert by_model["sdxl"]["low_n"] is True and by_model["sdxl"]["accuracy_mean"] is None
    assert by_model["sdxl"]["qc_pass_rate"] == 0.0


async def test_summary_rejects_unknown_model(client, seeded):
    r = await client.get("/study/summary", params={"model": "dalle"})
    assert r.status_code == 422


async def test_hypotheses(client, seeded):
    body = (await client.get("/study/hypotheses")).json()
    assert body[0]["id"] == "H2" and body[0]["direction"] == "not_significant"


async def test_disclosures_include_sdxl_qc_gap(client):
    body = (await client.get("/study/disclosures")).json()
    assert len(body) == 7
    assert any("9 of 1,280 SDXL" in d["text"] for d in body)


@pytest.mark.parametrize("params,expected", [
    ({}, 2),
    ({"model": "flux"}, 1),
    ({"qc_pass": "false"}, 1),
    ({"style": "B"}, 2),
    ({"style": "B_named_hex", "model": "sdxl"}, 1),
    ({"target_id": "crimson"}, 0),
])
async def test_image_filters(client, seeded, params, expected):
    body = (await client.get("/study/images", params=params)).json()
    assert body["total"] == expected and len(body["items"]) == expected


async def test_image_filter_rejects_bad_style(client, seeded):
    r = await client.get("/study/images", params={"style": "Z"})
    assert r.status_code == 422


async def test_image_detail_and_signed_url(client, seeded):
    r = await client.get("/study/images/SDXL_teal_B_named_hex_01")
    body = r.json()
    assert body["negative_prompt"].startswith("gradient, vignette")
    assert body["generation"]["precision"] == "fp16"
    assert "HEX #008080" in body["prompt"]

    path = body["image_url"].split("/api/v1", 1)[1]
    f = await client.get(path)
    assert f.status_code == 200 and f.headers["content-type"] == "image/png"

    tampered = path.rsplit("sig=", 1)[0] + "sig=deadbeef"
    assert (await client.get(tampered)).status_code == 403


async def test_image_detail_404(client, seeded):
    r = await client.get("/study/images/nope")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/problem+json")


async def test_file_route_blocks_path_traversal(client, seeded):
    from app.deps import get_storage

    storage = get_storage()
    with pytest.raises(ValueError):
        storage.path_for("../../secret.txt")
    # Encoded so the HTTP client doesn't normalise the dots away before the route sees them.
    url = storage.signed_url("study/%2E%2E/%2E%2E/%2E%2E/secret.txt")
    path = url.split("/api/v1", 1)[1]
    assert (await client.get(path)).status_code in (403, 404)
