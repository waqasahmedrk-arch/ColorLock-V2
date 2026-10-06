import io

import numpy as np
import pytest
from PIL import Image

from .conftest import png_bytes
from .test_auth import EMAIL, PASSWORD, _signup, sent  # noqa: F401  (fixture)

pytestmark = pytest.mark.anyio


async def _signed_in(client, sent):  # noqa: F811
    code = await _signup(client, sent)
    r = await client.post("/auth/verify-email", json={"email": EMAIL, "code": code})
    assert r.status_code == 200
    return r.json()


async def test_requires_login(client):
    assert (await client.patch("/auth/me", json={"name": "X"})).status_code == 401
    files = {"image": ("a.png", png_bytes((1, 2, 3)), "image/png")}
    assert (await client.post("/auth/me/avatar", files=files)).status_code == 401


async def test_update_name(client, sent):  # noqa: F811
    me = await _signed_in(client, sent)
    assert me["avatar_url"] is None and me["created_at"]
    r = await client.patch("/auth/me", json={"name": "  Ada   Lovelace "})
    assert r.status_code == 200 and r.json()["name"] == "Ada Lovelace"
    assert (await client.get("/auth/me")).json()["name"] == "Ada Lovelace"
    assert (await client.patch("/auth/me", json={"name": "   "})).status_code == 422


async def test_avatar_upload_crops_replaces_and_deletes(client, sent, env):  # noqa: F811
    await _signed_in(client, sent)
    wide = io.BytesIO()
    Image.fromarray(np.zeros((300, 600, 3), dtype=np.uint8)).save(wide, format="JPEG")
    r = await client.post("/auth/me/avatar", files={"image": ("w.jpg", wide.getvalue(), "image/jpeg")})
    assert r.status_code == 200, r.text
    first = r.json()["avatar_url"]
    assert first and "/files/avatars/" in first

    avatars = list((env / "storage" / "avatars").rglob("*.png"))
    assert len(avatars) == 1
    with Image.open(avatars[0]) as im:
        assert im.size == (256, 256) and im.format == "PNG"

    r = await client.post("/auth/me/avatar",
                          files={"image": ("b.png", png_bytes((9, 9, 9)), "image/png")})
    assert r.json()["avatar_url"] != first
    assert len(list((env / "storage" / "avatars").rglob("*.png"))) == 1  # old one removed

    r = await client.delete("/auth/me/avatar")
    assert r.json()["avatar_url"] is None
    assert not list((env / "storage" / "avatars").rglob("*.png"))


async def test_avatar_rejects_non_images(client, sent):  # noqa: F811
    await _signed_in(client, sent)
    r = await client.post("/auth/me/avatar",
                          files={"image": ("x.png", b"not an image", "image/png")})
    assert r.status_code == 422


async def test_personal_details(client, sent):  # noqa: F811
    await _signed_in(client, sent)
    r = await client.patch("/auth/me", json={
        "name": "Ada", "gender": "female", "date_of_birth": "1990-05-17",
        "phone": "  +44 20  7946 0958 ", "job_title": "  Colour   scientist "})
    assert r.status_code == 200, r.text
    me = (await client.get("/auth/me")).json()
    assert (me["gender"], me["date_of_birth"], me["phone"], me["job_title"]) == \
        ("female", "1990-05-17", "+44 20 7946 0958", "Colour scientist")

    # Sending only the name leaves the details alone; empty values clear them.
    assert (await client.patch("/auth/me", json={"name": "Ada L"})).json()["phone"] == "+44 20 7946 0958"
    r = await client.patch("/auth/me", json={"name": "Ada", "gender": "", "date_of_birth": "",
                                             "phone": "", "job_title": ""})
    body = r.json()
    assert (body["gender"], body["date_of_birth"], body["phone"], body["job_title"]) == \
        (None, None, None, None)


@pytest.mark.parametrize("field,value", [
    ("gender", "unicorn"),
    ("date_of_birth", "2999-01-01"),
    ("date_of_birth", "1800-01-01"),
    ("date_of_birth", "not-a-date"),
    ("phone", "12345"),
    ("phone", "call me maybe"),
    ("phone", "+1 234 567 890 123 456"),
    ("job_title", "x" * 101),
])
async def test_personal_details_validation(client, sent, field, value):  # noqa: F811
    await _signed_in(client, sent)
    r = await client.patch("/auth/me", json={"name": "Ada", field: value})
    assert r.status_code == 422
    assert r.json()["errors"][0]["loc"][-1] == field
