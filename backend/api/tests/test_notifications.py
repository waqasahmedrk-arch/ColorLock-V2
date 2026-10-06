import itertools

import pytest

from .conftest import png_bytes
from .test_auth import PASSWORD, sent  # noqa: F401  (fixture)

pytestmark = pytest.mark.anyio

EMAIL = "n@example.com"


async def _sign_up(client, sent):  # noqa: F811
    await client.post("/auth/signup", json={"name": "N", "email": EMAIL, "password": PASSWORD})
    r = await client.post("/auth/verify-email", json={"email": EMAIL, "code": sent[(EMAIL, "signup")]},
                          headers={"user-agent": "First browser"})
    assert r.status_code == 200, r.text


async def _login(client, agent: str):
    r = await client.post("/auth/login", json={"email": EMAIL, "password": PASSWORD},
                          headers={"user-agent": agent})
    assert r.status_code == 200, r.text


async def _kinds(client) -> list[str]:
    return [n["kind"] for n in (await client.get("/notifications")).json()["items"]]


_names = itertools.count(1)


async def _score(client, rgb):
    files = {"image": ("s.png", png_bytes(rgb), "image/png")}
    data = {"target_id": "teal", "name": f"Score {next(_names)}"}
    assert (await client.post("/score", files=files, data=data)).status_code == 200


async def test_requires_login(client):
    assert (await client.get("/notifications")).status_code == 401
    assert (await client.get("/notifications/unread-count")).status_code == 401


async def test_welcome_then_new_device_alert_only_for_unseen_browser(client, sent):  # noqa: F811
    await _sign_up(client, sent)
    assert await _kinds(client) == ["welcome"]
    # The browser that signed up is known; signing in from it again raises nothing.
    await _login(client, "First browser")
    assert await _kinds(client) == ["welcome"]
    await _login(client, "Mozilla/5.0 (Windows NT 10.0) Chrome/130")
    page = (await client.get("/notifications")).json()
    assert [n["kind"] for n in page["items"]] == ["new_sign_in", "welcome"]
    assert page["items"][0]["data"]["user_agent"].startswith("Mozilla")
    assert page["items"][0]["category"] == "security" and page["unread"] == 2
    await _login(client, "Mozilla/5.0 (Windows NT 10.0) Chrome/130")
    assert len(await _kinds(client)) == 2


async def test_read_delete_and_clear(client, sent):  # noqa: F811
    await _sign_up(client, sent)
    await _login(client, "Other browser")
    items = (await client.get("/notifications")).json()["items"]
    r = await client.post(f"/notifications/{items[0]['id']}/read")
    assert r.json() == {"unread": 1}
    assert (await client.get("/notifications?unread_only=true")).json()["total"] == 1
    assert (await client.post("/notifications/read-all")).json() == {"unread": 0}
    assert (await client.get("/notifications/unread-count")).json() == {"unread": 0}
    assert (await client.delete(f"/notifications/{items[1]['id']}")).status_code == 200
    assert (await client.delete("/notifications/missing")).status_code == 404
    assert (await client.delete("/notifications")).status_code == 204
    assert (await client.get("/notifications")).json()["total"] == 0


async def test_security_events(client, sent):  # noqa: F811
    await _sign_up(client, sent)
    r = await client.post("/auth/change-password",
                          json={"current_password": PASSWORD, "new_password": "new-pass-123"})
    assert r.status_code == 204, r.text
    assert (await _kinds(client))[0] == "password_changed"


async def test_personal_best_milestone_and_opt_out(client, sent):  # noqa: F811
    await _sign_up(client, sent)
    await _score(client, (200, 20, 20))       # far from teal: first score, nothing to beat
    await _score(client, (0, 128, 128))       # teal itself: a new best
    assert (await _kinds(client))[0] == "personal_best"
    best = (await client.get("/notifications")).json()["items"][0]["data"]
    assert best["delta_e00"] < best["previous"] and best["name"].startswith("Score ")

    assert (await client.patch("/notifications/preferences", json={"activity": False})).json() \
        == {"activity": False, "sound": True}
    await client.delete("/notifications")
    for _ in range(8):                         # scores 3..10 would hit the 10-score milestone
        await _score(client, (0, 128, 128))
    assert await _kinds(client) == []

    await client.patch("/notifications/preferences", json={"activity": True})
    assert (await client.delete("/history")).status_code == 204
    assert await _kinds(client) == ["history_cleared"]
    for _ in range(10):
        await _score(client, (0, 128, 128))
    assert "milestone" in await _kinds(client)
