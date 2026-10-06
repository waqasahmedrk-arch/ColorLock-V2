import itertools

import pytest

from .conftest import png_bytes
from .test_auth import PASSWORD, sent  # noqa: F401  (fixture)

pytestmark = pytest.mark.anyio


async def _sign_in(client, sent, email):  # noqa: F811
    await client.post("/auth/signup", json={"name": "U", "email": email, "password": PASSWORD})
    code = sent[(email, "signup")]
    assert (await client.post("/auth/verify-email",
                              json={"email": email, "code": code})).status_code == 200


_names = itertools.count(1)


async def _score(client, name="swatch.png", score_name=None, rgb=(0, 128, 128)):
    """Scores a swatch; signed-in scores need a unique name, so one is made up if not given."""
    files = {"image": (name, png_bytes(rgb), "image/png")}
    data = {"target_id": "teal", "name": score_name or f"Score {next(_names)}"}
    r = await client.post("/score", files=files, data=data)
    assert r.status_code == 200, r.text
    return r.json()


async def test_requires_login(client):
    assert (await client.get("/history")).status_code == 401
    assert (await client.delete("/history")).status_code == 401


async def test_anonymous_score_is_not_recorded(client, sent):  # noqa: F811
    await _score(client)
    await _sign_in(client, sent, "a@example.com")
    assert (await client.get("/history")).json()["total"] == 0


async def test_scores_are_recorded_newest_first_with_stats(client, sent):  # noqa: F811
    await _sign_in(client, sent, "a@example.com")
    first = await _score(client, r"C:\photos\first.png")
    second = await _score(client, "second.png")
    body = (await client.get("/history")).json()
    assert body["total"] == 2 and body["stats"]["count"] == 2
    assert [i["score_id"] for i in body["items"]] == [second["score_id"], first["score_id"]]
    item = body["items"][1]
    assert item["filename"] == "first.png"
    assert item["result"]["target"]["id"] == "teal" and item["result"]["qc"]["pass"] is True
    assert item["created_at"].endswith(("Z", "+00:00"))
    assert body["stats"]["qc_pass_count"] == 2
    assert body["stats"]["best_delta_e00"] == pytest.approx(min(first["delta_e00"],
                                                               second["delta_e00"]))
    page = (await client.get("/history?offset=1&limit=1")).json()
    assert [i["score_id"] for i in page["items"]] == [first["score_id"]]


async def test_users_only_see_and_delete_their_own(client, sent):  # noqa: F811
    await _sign_in(client, sent, "a@example.com")
    await _score(client)
    mine = (await client.get("/history")).json()["items"][0]["id"]

    client.cookies.clear()
    await _sign_in(client, sent, "b@example.com")
    assert (await client.get("/history")).json()["total"] == 0
    assert (await client.delete(f"/history/{mine}")).status_code == 404

    await _score(client)
    theirs = (await client.get("/history")).json()["items"][0]["id"]
    assert (await client.delete(f"/history/{theirs}")).status_code == 204
    assert (await client.get("/history")).json()["total"] == 0


async def test_clear_all(client, sent):  # noqa: F811
    await _sign_in(client, sent, "a@example.com")
    await _score(client)
    await _score(client)
    assert (await client.delete("/history")).status_code == 204
    assert (await client.get("/history")).json()["stats"] == {
        "count": 0, "qc_pass_count": 0, "best_delta_e00": None, "mean_delta_e00": None}


async def test_signed_in_scores_need_a_unique_name(client, sent):  # noqa: F811
    await _sign_in(client, sent, "a@example.com")
    files = {"image": ("s.png", png_bytes((0, 128, 128)), "image/png")}
    r = await client.post("/score", files=files, data={"target_id": "teal"})
    assert r.status_code == 422 and r.json()["title"] == "Name required"
    r = await client.post("/score", files=files, data={"target_id": "teal", "name": "x" * 101})
    assert r.status_code == 422 and r.json()["title"] == "Name too long"

    saved = await _score(client, score_name="  Sky   blue ")
    assert saved["name"] == "Sky blue"
    # Same name in another case is taken; nothing extra is saved.
    r = await client.post("/score", files=files, data={"target_id": "teal", "name": "SKY BLUE"})
    assert r.status_code == 409 and r.json()["title"] == "Name already used"
    assert (await client.get("/history")).json()["total"] == 1
    assert (await client.get("/history/name-available?name=sky%20blue")).json() == \
        {"name": "sky blue", "available": False}
    assert (await client.get("/history/name-available?name=Sea")).json()["available"] is True
    assert (await client.get("/history")).json()["items"][0]["name"] == "Sky blue"


async def test_names_are_per_user(client, sent):  # noqa: F811
    await _sign_in(client, sent, "a@example.com")
    await _score(client, score_name="Mine")
    await client.post("/auth/logout")
    await _sign_in(client, sent, "b@example.com")
    await _score(client, score_name="Mine")


async def test_anonymous_scores_need_no_name(client):
    files = {"image": ("s.png", png_bytes((0, 128, 128)), "image/png")}
    r = await client.post("/score", files=files, data={"target_id": "teal"})
    assert r.status_code == 200 and r.json()["name"] is None


async def test_search_by_name(client, sent):  # noqa: F811
    await _sign_in(client, sent, "a@example.com")
    for n in ("Ocean teal", "Teal 50%", "Brick red", "under_score"):
        await _score(client, score_name=n)
    def names(body):
        return sorted(i["name"] for i in body["items"])

    body = (await client.get("/history?q=TEAL")).json()
    assert names(body) == ["Ocean teal", "Teal 50%"] and body["total"] == 2
    assert body["stats"]["count"] == 4  # stats cover the whole history, not just matches
    # % and _ are matched literally, not as wildcards.
    assert names((await client.get("/history?q=50%25")).json()) == ["Teal 50%"]
    assert names((await client.get("/history?q=_")).json()) == ["under_score"]
    assert (await client.get("/history?q=nothing")).json()["total"] == 0
    assert (await client.get("/history?q=%20%20")).json()["total"] == 4


async def test_get_one_record(client, sent):  # noqa: F811
    await _sign_in(client, sent, "a@example.com")
    await _score(client, score_name="Report me")
    rid = (await client.get("/history")).json()["items"][0]["id"]
    r = await client.get(f"/history/{rid}")
    assert r.status_code == 200 and r.json()["name"] == "Report me"
    assert (await client.get("/history/export")).status_code == 200  # not taken as an id
    assert (await client.get("/history/missing")).status_code == 404
    await client.post("/auth/logout")
    await _sign_in(client, sent, "b@example.com")
    assert (await client.get(f"/history/{rid}")).status_code == 404


async def test_filter_by_date_range(client, sent):  # noqa: F811
    from datetime import UTC, datetime

    from app.db.auth import ScoreRecord, get_auth_sessionmaker

    def at(*parts):  # stored datetimes are naive UTC
        return datetime(*parts, tzinfo=UTC).replace(tzinfo=None)

    await _sign_in(client, sent, "a@example.com")
    for n in ("Sep 30", "Oct 1 morning", "Oct 1 night", "Oct 2"):
        await _score(client, score_name=n)
    stamps = {"Sep 30": at(2026, 9, 30, 12), "Oct 1 morning": at(2026, 10, 1, 0, 30),
              "Oct 1 night": at(2026, 10, 1, 23, 30), "Oct 2": at(2026, 10, 2, 9)}
    with get_auth_sessionmaker()() as db:
        for row in db.query(ScoreRecord).all():
            row.created_at = stamps[row.name]
        db.commit()

    def names(body):
        return sorted(i["name"] for i in body["items"])

    # One UTC day: since inclusive, until exclusive.
    body = (await client.get("/history?since=2026-10-01T00:00:00Z&until=2026-10-02T00:00:00Z")).json()
    assert names(body) == ["Oct 1 morning", "Oct 1 night"] and body["total"] == 2
    assert body["stats"]["count"] == 4
    # The same calendar day for someone at UTC+05:00 runs 19:00-19:00 UTC, so the 23:30 UTC
    # score already belongs to their 2 October.
    body = (await client.get(
        "/history?since=2026-10-01T00:00:00%2B05:00&until=2026-10-02T00:00:00%2B05:00")).json()
    assert names(body) == ["Oct 1 morning"]
    body = (await client.get(
        "/history?since=2026-10-02T00:00:00%2B05:00&until=2026-10-03T00:00:00%2B05:00")).json()
    assert names(body) == ["Oct 1 night", "Oct 2"]
    # Open-ended, and combined with a name search.
    assert names((await client.get("/history?since=2026-10-01T12:00:00Z")).json()) == \
        ["Oct 1 night", "Oct 2"]
    assert names((await client.get("/history?until=2026-10-01T00:00:00Z")).json()) == ["Sep 30"]
    assert names((await client.get("/history?q=oct%201&since=2026-10-01T12:00:00Z")).json()) == \
        ["Oct 1 night"]
    assert (await client.get("/history?since=yesterday")).status_code == 422
