"""Serves objects for the local-filesystem storage backend only, behind
HMAC-signed, expiring URLs. With the S3 backend, clients get presigned S3
URLs and this route always 404s."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse

from ..deps import get_storage
from ..errors import ProblemError
from ..services.storage import LocalStorage, S3Storage

router = APIRouter(tags=["files"], include_in_schema=False)


@router.get("/files/{key:path}")
def get_file(
    key: str,
    expires: int = Query(...),
    sig: str = Query(...),
    storage: LocalStorage | S3Storage = Depends(get_storage),
) -> FileResponse:
    if not isinstance(storage, LocalStorage):
        raise ProblemError(404, "Not found")
    if not storage.verify(key, expires, sig):
        raise ProblemError(403, "Invalid or expired link")
    try:
        path = storage.path_for(key)
    except ValueError as exc:
        raise ProblemError(404, "Not found") from exc
    if not path.is_file():
        raise ProblemError(404, "Not found")
    return FileResponse(path, media_type="image/png",
                        headers={"Cache-Control": "private, max-age=3600"})
