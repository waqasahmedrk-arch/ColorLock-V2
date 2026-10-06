import time

from app.services.storage import LocalStorage, S3Storage, study_key


def test_study_key_layout():
    assert study_key("sdxl", "teal", "B_named_hex", "x") == "study/sdxl/teal/B_named_hex/x.png"


def test_local_signature_expires(tmp_path):
    s = LocalStorage(tmp_path, "secret", "http://h", ttl_s=60)
    future = int(time.time()) + 60
    from app.services.storage import _sign

    assert s.verify("k", future, _sign("secret", "k", future))
    assert not s.verify("k", future, _sign("other", "k", future))
    past = int(time.time()) - 1
    assert not s.verify("k", past, _sign("secret", "k", past))


def test_s3_presigns_with_public_endpoint(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    s = S3Storage("colourlock", "http://minio:9000", "us-east-1", 60,
                  public_endpoint_url="http://localhost:9000")
    url = s.signed_url("study/flux/teal/B_named_hex/x.png")
    assert url.startswith("http://localhost:9000/colourlock/study/flux/")
    assert "X-Amz-Signature=" in url


def test_lab_to_hex_roundtrips_targets():
    from colourlock.targets import TARGETS

    from app.services.colour import lab_to_hex

    for t in TARGETS.values():
        assert lab_to_hex(tuple(t.lab)) == f"#{t.hex}"


def test_empty_env_values_keep_defaults(monkeypatch):
    """A verbatim copy of .env.example (all values empty) must not break the defaults."""
    from app.settings import Settings

    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("STORAGE_BACKEND", "")
    s = Settings()
    assert s.database_url.startswith("sqlite:///") and s.storage_backend == "local"
