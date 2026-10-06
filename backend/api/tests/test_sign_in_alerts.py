from datetime import UTC, datetime

import pytest

from .test_admin import ADMIN, _admin_login, _new_client, _sign_up, admin_env  # noqa: F401
from .test_auth import EMAIL, PASSWORD, _signup, sent  # noqa: F401  (fixtures)

pytestmark = pytest.mark.anyio

CHROME_WIN = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/129.0 Safari/537.36")


@pytest.fixture
def alerts(monkeypatch):
    """Captures sign-in alerts instead of mailing them."""
    from app.services import mailer

    got: list[dict] = []
    monkeypatch.setattr(mailer, "send_sign_in_alert",
                        lambda _s, to, **kw: got.append({"to": to, **kw}))
    return got


async def test_user_sign_in_sends_an_alert(client, sent, alerts):  # noqa: F811
    code = await _signup(client, sent)
    await client.post("/auth/verify-email", json={"email": EMAIL, "code": code})
    assert alerts == []  # finishing sign-up is not a "new sign-in"

    assert (await client.post("/auth/login", json={"email": EMAIL, "password": "wrong-pass-1"})).status_code == 401
    assert alerts == []  # failed attempts don't email the owner

    r = await client.post("/auth/login", json={"email": EMAIL, "password": PASSWORD},
                          headers={"user-agent": CHROME_WIN})
    assert r.status_code == 200
    assert len(alerts) == 1
    alert = alerts[0]
    assert alert["to"] == "ada@example.com" and alert["scope"] == "user" and alert["name"] == "Ada"
    assert alert["user_agent"] == CHROME_WIN


async def test_admin_sign_in_sends_an_alert(admin_env, sent, alerts):  # noqa: F811
    async with await _new_client() as c:
        await _sign_up(c, sent, ADMIN, "Boss")
        r = await c.post("/admin/auth/login", json={"email": ADMIN, "password": PASSWORD})
        assert r.status_code == 202 and alerts == []  # the password alone signs nobody in
        r = await _admin_login(c, sent, ADMIN)
        assert r.status_code == 200
        assert [(a["to"], a["scope"]) for a in alerts] == [(ADMIN, "admin")]


def _render(lang, **kw):
    from app.services import mailer
    from app.settings import Settings

    args = {"name": "Ada", "scope": "user", "at": datetime(2026, 10, 5, 14, 3, tzinfo=UTC),
            "user_agent": CHROME_WIN, "ip": "203.0.113.7", "lang": lang} | kw
    return mailer.sign_in_alert(Settings(site_url="https://colorlock.example",
                                         admin_url="https://admin.colorlock.example"), **args)


def test_alert_content_in_both_languages():
    subject, plain, html = _render("en")
    assert subject == "New sign-in to your ColorLock account"
    for part in ("Hi Ada,", "5 October 2026, 14:03 UTC", "Chrome on Windows", "203.0.113.7",
                 "https://colorlock.example/forgot-password"):
        assert part in plain and part in html
    subject, plain, html = _render("zh", scope="admin")
    assert subject == "ColorLock 管理後台有新的登入"
    assert "2026年10月5日 14:03（UTC）" in plain and "Windows 上的 Chrome" in html
    assert "https://admin.colorlock.example/forgot-password" in html


def test_alert_escapes_user_supplied_text_and_handles_unknowns():
    _, plain, html = _render("xx", name="<b>Eve</b>", user_agent=None, ip=None)
    assert "<b>Eve</b>" not in html and "&lt;b&gt;Eve&lt;/b&gt;" in html
    assert "Unknown device" in plain and "IP address: Unknown" in plain  # "xx" falls back to English


def test_alert_never_raises(monkeypatch):
    from app.services import mailer
    from app.settings import Settings

    def boom(*_a, **_k):
        raise OSError("smtp down")

    monkeypatch.setattr(mailer, "_deliver", boom)
    mailer.send_sign_in_alert(Settings(email_backend="smtp", smtp_user="u", smtp_password="p"),
                              "ada@example.com", name="Ada", scope="user",
                              at=datetime.now(UTC), user_agent=None, ip=None, lang="en")
