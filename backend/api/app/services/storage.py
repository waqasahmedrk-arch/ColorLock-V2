"""Object storage behind one interface. Access is through signed URLs only
(specs.md §9): S3 presigned URLs in production, HMAC-signed URLs served by
the API's /files route for the local-filesystem backend used in dev."""

from __future__ import annotations

import hashlib
import hmac
import time
from pathlib import Path
from typing import Protocol
from urllib.parse import quote, urlencode

from ..settings import Settings


class Storage(Protocol):
    def put(self, key: str, data: bytes, content_type: str = "image/png") -> None: ...
    def delete(self, key: str) -> None: ...
    def signed_url(self, key: str) -> str: ...


def study_key(model: str, target_id: str, style: str, image_id: str) -> str:
    return f"study/{model}/{target_id}/{style}/{image_id}.png"


def _sign(secret: str, key: str, expires: int) -> str:
    msg = f"{key}\n{expires}".encode()
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


class LocalStorage:
    def __init__(self, root: str | Path, secret: str, base_url: str, ttl_s: int) -> None:
        self.root = Path(root).resolve()
        self.secret = secret
        self.base_url = base_url.rstrip("/")
        self.ttl_s = ttl_s

    def path_for(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise ValueError("key escapes storage root")
        return path

    def put(self, key: str, data: bytes, content_type: str = "image/png") -> None:
        path = self.path_for(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def delete(self, key: str) -> None:
        self.path_for(key).unlink(missing_ok=True)

    def signed_url(self, key: str) -> str:
        expires = int(time.time()) + self.ttl_s
        query = urlencode({"expires": expires, "sig": _sign(self.secret, key, expires)})
        return f"{self.base_url}/api/v1/files/{quote(key)}?{query}"

    def verify(self, key: str, expires: int, sig: str) -> bool:
        if expires < time.time():
            return False
        return hmac.compare_digest(_sign(self.secret, key, expires), sig)


class S3Storage:
    def __init__(self, bucket: str, endpoint_url: str | None, region: str | None,
                 ttl_s: int, public_endpoint_url: str | None = None) -> None:
        import boto3
        from botocore.config import Config

        self.bucket = bucket
        self.ttl_s = ttl_s
        cfg = Config(signature_version="s3v4", s3={"addressing_style": "path"})
        self.client = boto3.client("s3", endpoint_url=endpoint_url, region_name=region,
                                   config=cfg)
        # Presigned URLs embed the host they were signed for, so sign with the
        # browser-reachable endpoint when it differs from the internal one
        # (e.g. http://minio:9000 inside compose vs http://localhost:9000).
        self.signer = (boto3.client("s3", endpoint_url=public_endpoint_url, region_name=region,
                                    config=cfg)
                       if public_endpoint_url else self.client)

    def put(self, key: str, data: bytes, content_type: str = "image/png") -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def signed_url(self, key: str) -> str:
        return self.signer.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=self.ttl_s,
        )


def make_storage(settings: Settings) -> LocalStorage | S3Storage:
    if settings.storage_backend == "s3":
        return S3Storage(settings.s3_bucket, settings.s3_endpoint_url, settings.s3_region,
                         settings.signed_url_ttl_s, settings.s3_public_endpoint_url)
    return LocalStorage(settings.local_storage_root, settings.url_signing_secret,
                        settings.public_base_url, settings.signed_url_ttl_s)
