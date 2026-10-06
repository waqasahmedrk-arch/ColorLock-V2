import pytest
from httpx import ASGITransport, AsyncClient

from .test_auth import PASSWORD, sent  # noqa: F401  (fixture)

pytestmark = pytest.mark.anyio

ADMIN = "boss@example.com"
USER = "user@example.com"


@pytest.fixture
def admin_env(env, monkeypatch):
    from app.settings import get_settings

    monkeypatch.setenv("ADMIN_EMAILS", f" {ADMIN.upper()} , other@example.com")
    get_settings.cache_clear()
    return env


async def _new_client():
    from app.main import create_app

    return AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test/api/v1")


async def _sign_up(c, sent, email, name):  # noqa: F811
    r = await c.post("/auth/signup", json={"name": name, "email": email, "password": PASSWORD})
    assert r.status_code == 202, r.text
    r = await c.post("/auth/verify-email", json={"email": email, "code": sent[(email, "signup")]})
    assert r.status_code == 200, r.text
    return r.json()


def _selfie_jpeg(size=(480, 360)):
    import io

    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", size, (190, 150, 120)).save(out, format="JPEG")
    return out.getvalue()


async def _send_selfie(c, email, token, data=None):
    return await c.post("/admin/auth/selfie", data={"email": email, "token": token},
                        files={"image": ("selfie.jpg", data or _selfie_jpeg(), "image/jpeg")})


async def _admin_login(c, sent, email, password=PASSWORD):  # noqa: F811
    """Every admin sign-in step: the password, the emailed code and, for an admin with no
    selfie on file, the selfie. Returns the last response."""
    r = await c.post("/admin/auth/login", json={"email": email, "password": password})
    if r.status_code != 202:
        return r
    r = await c.post("/admin/auth/verify",
                     json={"email": email, "code": sent[(email.lower(), "admin")]})
    if r.status_code != 202:
        return r
    return await _send_selfie(c, email, r.json()["token"])


@pytest.fixture
async def pair(admin_env, sent):  # noqa: F811
    """A client signed in to the admin panel and a client signed in to the user site."""
    admin, user = await _new_client(), await _new_client()
    await _sign_up(admin, sent, ADMIN, "Boss")
    u = await _sign_up(user, sent, USER, "Uma")
    # Signing up on the user site doesn't open the admin panel; the admin sign-in does
    # (ADMIN_EMAILS makes the account an admin there).
    assert (await admin.get("/admin/stats")).status_code == 401
    r = await _admin_login(admin, sent, ADMIN)
    assert r.status_code == 200 and r.json()["is_admin"] is True and "cl_admin" in r.cookies
    yield admin, user, u["id"]
    await admin.aclose()
    await user.aclose()


async def test_admin_routes_need_an_admin_session(pair, sent):  # noqa: F811
    _, user, _ = pair
    # A user-site session never opens admin routes, whoever it belongs to.
    for path in ("/admin/stats", "/admin/users", "/admin/chats", "/admin/chats/unread"):
        assert (await user.get(path)).status_code == 401
    r = await _admin_login(user, sent, USER)
    assert r.status_code == 403 and r.json()["type"] == "/problems/not-admin"
    assert (USER, "admin") not in sent  # non-admins never get a code
    assert (await _admin_login(user, sent, USER, "wrong-pass-1")).status_code == 401


async def test_admin_sign_in_needs_the_emailed_code(admin_env, sent):  # noqa: F811
    async with await _new_client() as c:
        await _sign_up(c, sent, ADMIN, "Boss")
        r = await c.post("/admin/auth/login", json={"email": ADMIN, "password": PASSWORD})
        # The password alone opens nothing: a code is emailed and no session exists yet.
        assert r.status_code == 202 and r.json()["email"] == ADMIN and "cl_admin" not in r.cookies
        assert (await c.get("/admin/stats")).status_code == 401
        code = sent[(ADMIN, "admin")]
        wrong = "000000" if code != "000000" else "111111"
        r = await c.post("/admin/auth/verify", json={"email": ADMIN, "code": wrong})
        assert r.status_code == 400
        # Entering the password again within the cooldown keeps the same code.
        r = await c.post("/admin/auth/login", json={"email": ADMIN, "password": PASSWORD})
        assert r.status_code == 202 and sent[(ADMIN, "admin")] == code
        assert (await c.post("/admin/auth/resend", json={"email": ADMIN})).status_code == 429
        r = await c.post("/admin/auth/verify", json={"email": ADMIN, "code": code})
        # First sign-in: the selfie step comes before the session.
        assert r.status_code == 202 and "cl_admin" not in r.cookies
        r = await _send_selfie(c, ADMIN, r.json()["token"])
        assert r.status_code == 200 and "cl_admin" in r.cookies
        assert (await c.get("/admin/stats")).status_code == 200
        # The code is single-use, and resending needs a sign-in in progress.
        assert (await c.post("/admin/auth/verify", json={"email": ADMIN, "code": code})).status_code == 400
        assert (await c.post("/admin/auth/resend", json={"email": ADMIN})).status_code == 400
        reasons = [e["reason"] for e in (await c.get("/admin/login-events")).json()
                   if e["scope"] == "admin"]
        # Newest first: the reused code, the sign-in, the wrong code.
        assert reasons == ["bad_code", "ok", "bad_code"]


async def test_first_admin_sign_in_needs_a_selfie(admin_env, sent):  # noqa: F811
    async with await _new_client() as c:
        await _sign_up(c, sent, ADMIN, "Boss")
        await c.post("/admin/auth/login", json={"email": ADMIN, "password": PASSWORD})
        r = await c.post("/admin/auth/verify", json={"email": ADMIN, "code": sent[(ADMIN, "admin")]})
        assert r.status_code == 202 and r.json()["selfie_required"] is True
        token = r.json()["token"]
        # The code alone opens nothing.
        assert (await c.get("/admin/stats")).status_code == 401
        assert (await _send_selfie(c, ADMIN, "not-the-token")).status_code == 400
        assert (await _send_selfie(c, "other@example.com", token)).status_code == 400
        # A rejected photo keeps the token, so the admin can retake it.
        assert (await _send_selfie(c, ADMIN, token, b"not an image")).status_code == 422
        assert (await _send_selfie(c, ADMIN, token, _selfie_jpeg((120, 90)))).status_code == 422
        assert (await c.get("/admin/stats")).status_code == 401
        r = await _send_selfie(c, ADMIN, token, _selfie_jpeg((1920, 1080)))
        assert r.status_code == 200 and "cl_admin" in r.cookies
        # The token is single-use.
        assert (await _send_selfie(c, ADMIN, token)).status_code == 400
        me = (await c.get("/admin/auth/me")).json()
        detail = (await c.get(f"/admin/users/{me['id']}")).json()
        assert detail["selfie_at"] is not None
        # Stored privately, re-encoded and capped in size.
        from PIL import Image

        files = list((admin_env / "storage" / "selfies" / me["id"]).iterdir())
        assert len(files) == 1
        with Image.open(files[0]) as im:
            assert im.format == "JPEG" and max(im.size) <= 640
        # Later sign-ins skip the selfie.
        await c.post("/admin/auth/logout")
        await c.post("/admin/auth/login", json={"email": ADMIN, "password": PASSWORD})
        r = await c.post("/admin/auth/verify", json={"email": ADMIN, "code": sent[(ADMIN, "admin")]})
        assert r.status_code == 200 and "cl_admin" in r.cookies


async def test_selfie_step_rechecks_the_account(pair, sent, admin_env):  # noqa: F811
    admin, _, _ = pair
    body = {"name": "Second Admin", "email": "two@example.com", "password": "second-pass-1"}
    two_id = (await admin.post("/admin/admins", json=body)).json()["id"]
    async with await _new_client() as two:
        await two.post("/admin/auth/login", json={"email": body["email"], "password": body["password"]})
        r = await two.post("/admin/auth/verify",
                           json={"email": body["email"], "code": sent[(body["email"], "admin")]})
        assert r.status_code == 202
        # Admin access removed while the selfie step was open: the selfie opens nothing.
        await admin.patch(f"/admin/users/{two_id}/role", json={"is_admin": False})
        assert (await _send_selfie(two, body["email"], r.json()["token"])).status_code == 403
        assert (await two.get("/admin/stats")).status_code == 401
    # Deleting the account removes the selfie too.
    await admin.patch(f"/admin/users/{two_id}/role", json={"is_admin": True})
    async with await _new_client() as two:
        assert (await _admin_login(two, sent, body["email"], body["password"])).status_code == 200
    folder = admin_env / "storage" / "selfies" / two_id
    assert len(list(folder.iterdir())) == 1
    await admin.patch(f"/admin/users/{two_id}/role", json={"is_admin": False})
    assert (await admin.delete(f"/admin/users/{two_id}")).status_code == 204
    assert not folder.exists() or not any(folder.iterdir())


async def test_user_and_admin_sessions_are_separate(pair):
    admin, _, _ = pair
    me_site = (await admin.get("/auth/me")).json()
    me_panel = (await admin.get("/admin/auth/me")).json()
    assert me_site["email"] == me_panel["email"] == ADMIN
    # The admin panel's token doesn't work as a user-site session, and vice versa.
    swapped = {"cl_session": admin.cookies["cl_admin"], "cl_admin": admin.cookies["cl_session"]}
    async with await _new_client() as other:
        other.cookies.update(swapped)
        assert (await other.get("/auth/me")).status_code == 401
        assert (await other.get("/admin/auth/me")).status_code == 401
    # Signing out of the user site leaves the admin panel signed in.
    assert (await admin.post("/auth/logout")).status_code == 204
    admin.cookies.delete("cl_session")
    assert (await admin.get("/auth/me")).status_code == 401
    assert (await admin.get("/admin/stats")).status_code == 200
    # Settings › devices on the user site doesn't list admin-panel sessions.
    await admin.post("/auth/login", json={"email": ADMIN, "password": PASSWORD})
    assert len((await admin.get("/auth/sessions")).json()) == 1
    assert (await admin.post("/admin/auth/logout")).status_code == 204
    admin.cookies.delete("cl_admin")
    assert (await admin.get("/admin/stats")).status_code == 401
    assert (await admin.get("/auth/me")).status_code == 200


async def test_admin_edits_own_profile_with_the_admin_session(pair, sent):  # noqa: F811
    import io

    from PIL import Image

    admin, user, _ = pair
    admin.cookies.delete("cl_session")  # only the admin panel's session from here on
    assert (await admin.patch("/auth/me", json={"name": "X"})).status_code == 401
    r = await admin.patch("/admin/auth/me", json={"name": "Big Boss", "job_title": "Lead",
                                                  "phone": "+44 20 7946 0000"})
    assert r.status_code == 200, r.text
    assert (r.json()["name"], r.json()["job_title"]) == ("Big Boss", "Lead")
    png = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 10, 10)).save(png, format="PNG")
    r = await admin.post("/admin/auth/me/avatar", files={"image": ("a.png", png.getvalue(), "image/png")})
    assert r.status_code == 200 and r.json()["avatar_url"]
    r = await admin.delete("/admin/auth/me/avatar")
    assert r.status_code == 200 and r.json()["avatar_url"] is None
    # The password change keeps this admin session and signs out the user-site ones.
    r = await admin.post("/admin/auth/change-password",
                         json={"current_password": PASSWORD, "new_password": "fresh-pass-2"})
    assert r.status_code == 204, r.text
    assert (await admin.get("/admin/auth/me")).json()["name"] == "Big Boss"
    # A user-site session can't use the admin copies.
    assert (await user.patch("/admin/auth/me", json={"name": "Nope"})).status_code == 401


async def test_admin_creates_admins(pair, sent):  # noqa: F811
    admin, _, _ = pair
    body = {"name": "Second Admin", "email": "Two@Example.com", "password": "second-pass-1"}
    r = await admin.post("/admin/admins", json=body)
    # Created unverified: the new admin verifies the address with their first sign-in code.
    assert r.status_code == 201 and r.json()["is_admin"] and not r.json()["is_verified"]
    assert (await admin.post("/admin/admins", json=body)).status_code == 409
    assert (await admin.post("/admin/admins", json={**body, "email": "x@example.com",
                                                    "password": "short"})).status_code == 422
    async with await _new_client() as two:
        assert (await _admin_login(two, sent, "two@example.com", "second-pass-1")).status_code == 200
        assert (await two.get("/admin/stats")).status_code == 200
        assert (await admin.get(f"/admin/users/{r.json()['id']}")).json()["is_verified"] is True
        # Removing the role ends their admin-panel session straight away.
        await admin.patch(f"/admin/users/{r.json()['id']}/role", json={"is_admin": False})
        assert (await two.get("/admin/stats")).status_code == 401
    assert (await admin.get("/admin/audit")).json()[-1]["action"] == "create_admin"


async def test_users_list_detail_and_login_history(pair):
    admin, user, uid = pair
    await user.post("/auth/login", json={"email": USER, "password": "wrong-pass-1"},
                    headers={"user-agent": "Attacker"})
    page = (await admin.get("/admin/users?q=uma")).json()
    assert page["total"] == 1 and page["items"][0]["email"] == USER
    assert page["items"][0]["sessions"] == 1
    assert (await admin.get("/admin/users?status=admins")).json()["total"] == 1

    d = (await admin.get(f"/admin/users/{uid}")).json()
    assert d["failed_logins_24h"] == 1 and len(d["session_list"]) == 1
    assert [e["reason"] for e in d["login_events"]] == ["bad_password", "ok"]
    assert "password_hash" not in d

    s = (await admin.get("/admin/stats")).json()
    assert s["users"] == 2 and s["admins"] == 1 and s["failed_24h"] == 1
    assert len(s["series"]) == 14 and s["series"][-1]["signups"] == 2


async def test_block_kills_sessions_and_login_then_unblock(pair):
    admin, user, uid = pair
    r = await admin.post(f"/admin/users/{uid}/block", json={"reason": " Spam  links "})
    assert r.status_code == 200 and r.json()["is_blocked"] and r.json()["blocked_reason"] == "Spam links"
    assert (await user.get("/auth/me")).status_code == 401
    r = await user.post("/auth/login", json={"email": USER, "password": PASSWORD})
    assert r.status_code == 403 and r.json()["type"] == "/problems/account-blocked"
    # A wrong password still just says "invalid credentials".
    r = await user.post("/auth/login", json={"email": USER, "password": "wrong-pass-1"})
    assert r.status_code == 401

    assert (await admin.post(f"/admin/users/{uid}/unblock")).json()["is_blocked"] is False
    r = await user.post("/auth/login", json={"email": USER, "password": PASSWORD})
    assert r.status_code == 200
    kinds = [n["kind"] for n in (await user.get("/notifications")).json()["items"]]
    assert kinds[0] == "account_restored"
    actions = [a["action"] for a in (await admin.get("/admin/audit")).json()]
    assert actions == ["unblock", "block"]


async def test_guards_on_self_and_admins(pair):
    admin, _, uid = pair
    me = (await admin.get("/auth/me")).json()["id"]
    assert (await admin.post(f"/admin/users/{me}/block", json={})).status_code == 400
    assert (await admin.patch(f"/admin/users/{me}/role", json={"is_admin": False})).status_code == 400
    assert (await admin.delete(f"/admin/users/{me}")).status_code == 400
    assert (await admin.patch(f"/admin/users/{uid}/role", json={"is_admin": True})).json()["is_admin"]
    assert (await admin.post(f"/admin/users/{uid}/block", json={})).status_code == 400
    assert (await admin.delete(f"/admin/users/{uid}")).status_code == 400
    assert (await admin.get("/admin/users/missing")).status_code == 404


async def test_sign_out_everywhere_and_delete(pair):
    admin, user, uid = pair
    d = (await admin.delete(f"/admin/users/{uid}/sessions")).json()
    assert d["session_list"] == []
    assert (await user.get("/auth/me")).status_code == 401
    assert (await admin.delete(f"/admin/users/{uid}")).status_code == 204
    assert (await admin.get(f"/admin/users/{uid}")).status_code == 404
    assert (await admin.get("/admin/audit")).json()[0]["target_email"] == USER


async def test_chat_round_trip(pair):
    admin, user, uid = pair
    assert (await user.get("/chat")).json() == {"messages": [], "unread": 0, "has_more": False}
    assert (await user.post("/chat", json={"body": "   "})).status_code == 422
    first = (await user.post("/chat", json={"body": " Hello, I need help "})).json()
    assert first["body"] == "Hello, I need help" and first["sender"] == "user"

    assert (await admin.get("/admin/chats/unread")).json() == {"unread": 1, "conversations": 1}
    inbox = (await admin.get("/admin/chats")).json()["items"]
    assert inbox[0]["user"]["id"] == uid and inbox[0]["unread"] == 1

    r = await admin.post(f"/admin/chats/{uid}", json={"body": "Hi Uma, how can I help?"})
    assert r.status_code == 201 and r.json()["admin_name"] == "Boss"
    # Replying marks the user's message read.
    assert (await admin.get("/admin/chats/unread")).json()["unread"] == 0

    assert (await user.get("/chat/unread")).json() == {"unread": 1}
    # A reply is announced by the chat's unread count and sound only, never a notification.
    notes = (await user.get("/notifications")).json()["items"]
    assert all(n["kind"] != "admin_message" for n in notes)
    new =(await user.get(f"/chat?after={first['id']}")).json()["messages"]
    assert [m["sender"] for m in new] == ["admin"]
    assert (await user.post("/chat/read")).json() == {"unread": 0}
    thread = (await admin.get(f"/admin/chats/{uid}")).json()
    assert [m["read"] for m in thread["messages"]] == [True, True]


async def test_each_user_has_their_own_thread(pair, sent):  # noqa: F811
    admin, uma, uma_id = pair
    async with await _new_client() as vic:
        vic_id = (await _sign_up(vic, sent, "vic@example.com", "Vic"))["id"]
        await uma.post("/chat", json={"body": "from uma"})
        await vic.post("/chat", json={"body": "from vic"})
        await admin.post(f"/admin/chats/{uma_id}", json={"body": "reply to uma"})
        await admin.post(f"/admin/chats/{vic_id}", json={"body": "reply to vic"})
        assert [m["body"] for m in (await uma.get("/chat")).json()["messages"]] == ["from uma", "reply to uma"]
        assert [m["body"] for m in (await vic.get("/chat")).json()["messages"]] == ["from vic", "reply to vic"]
        assert (await vic.get("/chat/unread")).json() == {"unread": 1}
        inbox = (await admin.get("/admin/chats")).json()["items"]
        assert {c["user"]["id"]: c["last_body"] for c in inbox} == {uma_id: "reply to uma",
                                                                    vic_id: "reply to vic"}


def _photo(fmt="JPEG", size=(2400, 1200), mode="RGB") -> bytes:
    import io

    from PIL import Image

    out = io.BytesIO()
    Image.new(mode, size, (30, 90, 200) if mode == "RGB" else (30, 90, 200, 120)).save(out, format=fmt)
    return out.getvalue()


async def test_chat_photos_both_ways(pair):
    from PIL import Image

    from app.deps import get_storage

    admin, user, uid = pair
    r = await user.post("/chat/image", files={"image": ("big.jpg", _photo(), "image/jpeg")},
                        data={"body": "  my result  "})
    assert r.status_code == 201, r.text
    sent_msg = r.json()
    # Stored scaled down to the longest-side cap, with its size reported for layout.
    assert sent_msg["body"] == "my result" and sent_msg["image_url"]
    assert (sent_msg["image_width"], sent_msg["image_height"]) == (1600, 800)

    inbox = (await admin.get("/admin/chats")).json()["items"]
    assert inbox[0]["last_image"] is True and inbox[0]["unread"] == 1
    thread = (await admin.get(f"/admin/chats/{uid}")).json()
    assert thread["messages"][0]["image_url"]

    # An admin's photo with no caption; transparency is kept as PNG.
    r = await admin.post(f"/admin/chats/{uid}/image",
                         files={"image": ("a.png", _photo("PNG", (300, 200), "RGBA"), "image/png")})
    assert r.status_code == 201, r.text
    assert r.json()["body"] == "" and r.json()["sender"] == "admin"
    notes = (await user.get("/notifications")).json()["items"]
    assert all(n["kind"] != "admin_message" for n in notes)
    assert (await user.get("/chat/unread")).json() == {"unread": 1}
    msgs = (await user.get("/chat")).json()["messages"]
    assert [bool(m["image_url"]) for m in msgs] == [True, True]

    # Not an image / too large.
    r = await user.post("/chat/image", files={"image": ("x.txt", b"hello", "text/plain")})
    assert r.status_code == 422
    r = await user.post("/chat/image", files={"image": ("x.bmp", _photo("BMP", (10, 10)), "image/bmp")})
    assert r.status_code == 415

    # Deleting the user removes the photos from storage.
    storage = get_storage()
    keys = [m["image_url"].split("/files/")[1].split("?")[0] for m in msgs]
    paths = [storage.path_for(k) for k in keys]
    assert all(p.exists() for p in paths)
    with Image.open(paths[0]) as im:
        assert im.format == "JPEG"
    assert (await admin.delete(f"/admin/users/{uid}")).status_code == 204
    assert not any(p.exists() for p in paths)


async def test_chat_replies_quote_a_message_or_photo(pair, sent):  # noqa: F811
    admin, user, uid = pair
    photo = (await user.post("/chat/image", files={"image": ("p.jpg", _photo(size=(40, 40)), "image/jpeg")})).json()
    long_text = "x" * 300
    question = (await user.post("/chat", json={"body": long_text})).json()

    # The admin quotes the user's photo, and the user quotes the admin's answer.
    r = await admin.post(f"/admin/chats/{uid}", json={"body": "Nice colour!", "reply_to": photo["id"]})
    assert r.status_code == 201, r.text
    answer = r.json()
    assert answer["reply_to"]["id"] == photo["id"] and answer["reply_to"]["image_url"]
    assert answer["reply_to"]["sender"] == "user" and answer["reply_to"]["body"] == ""
    r = await user.post("/chat", json={"body": "Thanks", "reply_to": answer["id"]})
    assert r.json()["reply_to"]["admin_name"] == "Boss"

    # A photo can be a reply too; long quoted text is shortened.
    r = await admin.post(f"/admin/chats/{uid}/image", data={"reply_to": str(question["id"])},
                         files={"image": ("a.png", _photo("PNG", (20, 20), "RGBA"), "image/png")})
    assert r.status_code == 201, r.text
    quote = r.json()["reply_to"]["body"]
    assert len(quote) == 160 and quote.endswith("…")

    # Quotes come back with the thread, even when the original is on an older page.
    msgs = (await user.get("/chat")).json()["messages"]
    assert [m["reply_to"] and m["reply_to"]["id"] for m in msgs] == [
        None, None, photo["id"], answer["id"], question["id"]]
    assert (await user.get(f"/chat?after={answer['id']}")).json()["messages"][0]["reply_to"]["id"] == answer["id"]

    # Only messages from the same conversation can be quoted.
    async with await _new_client() as vic:
        await _sign_up(vic, sent, "vic@example.com", "Vic")
        assert (await vic.post("/chat", json={"body": "hi", "reply_to": photo["id"]})).status_code == 422
        r = await vic.post("/chat/image", data={"reply_to": str(photo["id"])},
                           files={"image": ("p.jpg", _photo(size=(20, 20)), "image/jpeg")})
        assert r.status_code == 422
    assert (await user.post("/chat", json={"body": "hi", "reply_to": 999999})).status_code == 422


async def test_chat_rate_limit_and_sound_pref(pair, monkeypatch):
    from app.settings import get_settings

    _, user, _ = pair
    monkeypatch.setenv("CHAT_PER_MINUTE", "2")
    get_settings.cache_clear()
    for _ in range(2):
        assert (await user.post("/chat", json={"body": "x"})).status_code == 201
    assert (await user.post("/chat", json={"body": "x"})).status_code == 429

    r = await user.patch("/notifications/preferences", json={"sound": False})
    assert r.json() == {"activity": True, "sound": False}
