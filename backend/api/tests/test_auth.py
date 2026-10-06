import pytest

pytestmark = pytest.mark.anyio

EMAIL = "Ada@Example.com"
PASSWORD = "colour-lock-1"


@pytest.fixture
def sent(monkeypatch):
    """Captures one-time codes instead of mailing them."""
    from app.services import mailer

    codes: dict[tuple[str, str], str] = {}
    monkeypatch.setattr(mailer, "send_otp",
                        lambda _s, to, purpose, code, lang="en": codes.__setitem__((to, purpose), code))
    return codes


async def _signup(client, sent) -> str:
    r = await client.post("/auth/signup",
                          json={"name": "Ada", "email": EMAIL, "password": PASSWORD})
    assert r.status_code == 202, r.text
    return sent[("ada@example.com", "signup")]


async def test_signup_verify_login_logout(client, sent):
    code = await _signup(client, sent)

    r = await client.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 403 and r.json()["type"] == "/problems/email-unverified"

    wrong = "000000" if code != "000000" else "111111"
    assert (await client.post("/auth/verify-email",
                              json={"email": EMAIL, "code": wrong})).status_code == 400
    r = await client.post("/auth/verify-email", json={"email": EMAIL, "code": code})
    assert r.status_code == 200 and r.json()["email"] == "ada@example.com"
    assert (await client.get("/auth/me")).json()["name"] == "Ada"

    assert (await client.post("/auth/logout")).status_code == 204
    client.cookies.clear()
    assert (await client.get("/auth/me")).status_code == 401

    r = await client.post("/auth/login", json={"email": EMAIL, "password": "nope-nope-1"})
    assert r.status_code == 401
    r = await client.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200 and "cl_session" in r.cookies


async def test_code_is_single_use_and_attempts_are_capped(client, sent):
    code = await _signup(client, sent)
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        await client.post("/auth/verify-email", json={"email": EMAIL, "code": wrong})
    r = await client.post("/auth/verify-email", json={"email": EMAIL, "code": code})
    assert r.status_code == 429


async def test_resend_cooldown_and_duplicate_signup(client, sent):
    code = await _signup(client, sent)
    r = await client.post("/auth/resend-code", json={"email": EMAIL, "purpose": "signup"})
    assert r.status_code == 429
    await client.post("/auth/verify-email", json={"email": EMAIL, "code": code})
    r = await client.post("/auth/signup",
                          json={"name": "Ada", "email": EMAIL, "password": PASSWORD})
    assert r.status_code == 409


async def test_weak_password_rejected(client, sent):
    r = await client.post("/auth/signup",
                          json={"name": "Ada", "email": EMAIL, "password": "short"})
    assert r.status_code == 422 and not sent


async def test_password_reset_revokes_sessions(client, sent):
    code = await _signup(client, sent)
    await client.post("/auth/verify-email", json={"email": EMAIL, "code": code})
    old_cookie = client.cookies.get("cl_session")

    r = await client.post("/auth/forgot-password", json={"email": "nobody@example.com"})
    assert r.status_code == 202 and ("nobody@example.com", "reset") not in sent
    assert (await client.post("/auth/forgot-password", json={"email": EMAIL})).status_code == 202
    reset = sent[("ada@example.com", "reset")]

    r = await client.post("/auth/reset-password",
                          json={"email": EMAIL, "code": reset, "password": "new-pass-22"})
    assert r.status_code == 204
    client.cookies.set("cl_session", old_cookie)
    assert (await client.get("/auth/me")).status_code == 401
    r = await client.post("/auth/login", json={"email": EMAIL, "password": "new-pass-22"})
    assert r.status_code == 200


async def test_email_language_follows_lang_cookie(client, monkeypatch):
    from app.services import mailer

    langs: list[str] = []
    monkeypatch.setattr(mailer, "send_otp",
                        lambda _s, _to, _p, _c, lang="en": langs.append(lang))
    client.cookies.set("lang", "zh")
    r = await client.post("/auth/signup",
                          json={"name": "Ada", "email": EMAIL, "password": PASSWORD})
    assert r.status_code == 202 and langs == ["zh"]


def test_mail_text_in_chinese():
    from app.services.mailer import _TEXT, _otp_html

    html = _otp_html(_TEXT["zh"], "zh", "signup", "123456", 10)
    assert "驗證" in html and "10 分鐘" in html and "1" in html


async def test_change_password(client, sent):
    code = await _signup(client, sent)
    await client.post("/auth/verify-email", json={"email": EMAIL, "code": code})
    other = client.cookies.get("cl_session")
    r = await client.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200
    mine = client.cookies.get("cl_session")
    assert mine != other

    r = await client.post("/auth/change-password",
                          json={"current_password": "wrong-pass-1", "new_password": "new-pass-22"})
    assert r.status_code == 400 and r.json()["title"] == "Incorrect password"
    r = await client.post("/auth/change-password",
                          json={"current_password": PASSWORD, "new_password": PASSWORD})
    assert r.status_code == 400 and r.json()["title"] == "Same password"
    r = await client.post("/auth/change-password",
                          json={"current_password": PASSWORD, "new_password": "short"})
    assert r.status_code == 422

    r = await client.post("/auth/change-password",
                          json={"current_password": PASSWORD, "new_password": "new-pass-22"})
    assert r.status_code == 204
    # This session stays signed in; the other one is signed out.
    assert (await client.get("/auth/me")).status_code == 200
    client.cookies.set("cl_session", other)
    assert (await client.get("/auth/me")).status_code == 401

    client.cookies.clear()
    r = await client.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 401
    r = await client.post("/auth/login", json={"email": EMAIL, "password": "new-pass-22"})
    assert r.status_code == 200


async def test_change_password_needs_sign_in(client):
    r = await client.post("/auth/change-password",
                          json={"current_password": PASSWORD, "new_password": "new-pass-22"})
    assert r.status_code == 401
