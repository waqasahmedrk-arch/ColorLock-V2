import pytest

pytestmark = pytest.mark.anyio


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


async def test_provenance_reads_config(client):
    body = (await client.get("/provenance")).json()
    assert body["qc"]["flat_p95_de_max"] == 3.0
    assert body["models"]["flux"]["precision"] == "fp8_layerwise"
    assert len(body["models"]["sdxl"]["revision"]) == 40


async def test_targets(client):
    body = (await client.get("/targets")).json()
    assert len(body) == 8
    royal = next(t for t in body if t["id"] == "royal_blue")
    assert royal["hex"] == "#4169E1"


async def test_prompt_styles_use_package_templates(client):
    from colourlock.prompts import build_prompt
    from colourlock.targets import TARGETS

    body = (await client.get("/prompt-styles")).json()
    assert [s["code"] for s in body] == ["A", "B", "C", "D", "E"]
    b = next(s for s in body if s["code"] == "B")
    assert b["example_prompt"] == build_prompt(TARGETS["royal_blue"], "B_named_hex")


async def test_prompt_validate(client):
    body = (await client.post("/prompts/validate", json={"text": "colour teal"})).json()
    assert body["fits"] is True and body["limit"] == 77


async def test_validation_errors_are_problem_json(client):
    r = await client.post("/prompts/validate", json={"text": ""})
    assert r.status_code == 422
    assert r.headers["content-type"].startswith("application/problem+json")
    assert r.json()["title"] == "Request validation failed"


async def test_deep_health_checks_databases_and_config(client):
    body = (await client.get("/health?deep=true")).json()
    assert body == {"status": "ok",
                    "checks": {"database": "ok", "auth_database": "ok", "config": "ok"}}
