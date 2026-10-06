"""The signed-in user's own profile: name, personal details and profile photo.

The same three routes exist twice: under /auth/me for the ColorLock site's session
(cl_session) and under /admin/auth/me for the admin panel's own session (cl_admin), so an
admin edits their profile from the panel without signing in on the other site.
"""

from __future__ import annotations

import io
import logging
import secrets

from fastapi import APIRouter, Depends, File, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session

from ..db.auth import User, get_auth_db
from ..deps import get_storage
from ..errors import ProblemError
from ..schemas.auth import ProfileIn, UserOut
from ..services.storage import LocalStorage, S3Storage
from .admin_auth import admin_user
from .auth import current_user, user_out

router = APIRouter(prefix="/auth/me", tags=["auth"])
admin_router = APIRouter(prefix="/admin/auth/me", tags=["admin"])
log = logging.getLogger("colourlock.auth")

MAX_AVATAR_BYTES = 5 * 1024 * 1024
AVATAR_SIZE = 256
AVATAR_FORMATS = {"PNG", "JPEG", "WEBP", "GIF"}


def _avatar_png(data: bytes) -> bytes:
    """Centre-crop to a square and re-encode as a small PNG.

    Re-encoding drops EXIF (including GPS) and anything else riding along in the upload.
    """
    try:
        with Image.open(io.BytesIO(data)) as im:
            if im.format not in AVATAR_FORMATS:
                raise ProblemError(415, "Unsupported image",
                                   "Use a PNG, JPEG, WebP or GIF image.")
            im.seek(0)  # first frame of an animated GIF / WebP
            im = ImageOps.exif_transpose(im)
            im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
            im = ImageOps.fit(im, (AVATAR_SIZE, AVATAR_SIZE), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            im.save(out, format="PNG", optimize=True)
            return out.getvalue()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise ProblemError(422, "Unreadable image", "That file isn't a readable image.") from exc


def _update_profile(body: ProfileIn, user: User, db: Session) -> UserOut:
    # Only what the client sent: an older client sending just the name keeps the rest.
    for field in body.model_fields_set:
        setattr(user, field, getattr(body, field))
    db.commit()
    return user_out(user)


def _upload_avatar(image: UploadFile, user: User, db: Session,
                   storage: LocalStorage | S3Storage) -> UserOut:
    data = image.file.read(MAX_AVATAR_BYTES + 1)
    if len(data) > MAX_AVATAR_BYTES:
        raise ProblemError(413, "Image too large", "Profile photos can be up to 5 MB.")
    if not data:
        raise ProblemError(422, "Empty upload", "The image file is empty.")
    png = _avatar_png(data)
    # A fresh key per upload, so browsers never show a cached old photo.
    key = f"avatars/{user.id}/{secrets.token_hex(8)}.png"
    storage.put(key, png, "image/png")
    old, user.avatar_key = user.avatar_key, key
    db.commit()
    if old:
        storage.delete(old)
    log.info("avatar updated")
    return user_out(user)


def _delete_avatar(user: User, db: Session, storage: LocalStorage | S3Storage) -> UserOut:
    old, user.avatar_key = user.avatar_key, None
    db.commit()
    if old:
        storage.delete(old)
    return user_out(user)


@router.patch("", response_model=UserOut)
def update_profile(body: ProfileIn, user: User = Depends(current_user),
                   db: Session = Depends(get_auth_db)) -> UserOut:
    return _update_profile(body, user, db)


@router.post("/avatar", response_model=UserOut)
def upload_avatar(image: UploadFile = File(...), user: User = Depends(current_user),
                  db: Session = Depends(get_auth_db),
                  storage: LocalStorage | S3Storage = Depends(get_storage)) -> UserOut:
    return _upload_avatar(image, user, db, storage)


@router.delete("/avatar", response_model=UserOut)
def delete_avatar(user: User = Depends(current_user), db: Session = Depends(get_auth_db),
                  storage: LocalStorage | S3Storage = Depends(get_storage)) -> UserOut:
    return _delete_avatar(user, db, storage)


@admin_router.patch("", response_model=UserOut)
def admin_update_profile(body: ProfileIn, user: User = Depends(admin_user),
                         db: Session = Depends(get_auth_db)) -> UserOut:
    return _update_profile(body, user, db)


@admin_router.post("/avatar", response_model=UserOut)
def admin_upload_avatar(image: UploadFile = File(...), user: User = Depends(admin_user),
                        db: Session = Depends(get_auth_db),
                        storage: LocalStorage | S3Storage = Depends(get_storage)) -> UserOut:
    return _upload_avatar(image, user, db, storage)


@admin_router.delete("/avatar", response_model=UserOut)
def admin_delete_avatar(user: User = Depends(admin_user), db: Session = Depends(get_auth_db),
                        storage: LocalStorage | S3Storage = Depends(get_storage)) -> UserOut:
    return _delete_avatar(user, db, storage)
