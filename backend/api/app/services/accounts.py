"""Deleting an account and everything that belongs to it, for both the user's own
"delete my account" and an admin's delete."""

from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db.auth import (
    ChatMessage,
    KnownDevice,
    LoginEvent,
    LoginSession,
    Notification,
    OtpCode,
    ScoreRecord,
    User,
)
from ..services.storage import LocalStorage, S3Storage


def purge_user(db: Session, user: User, storage: LocalStorage | S3Storage) -> None:
    """Deletes the user and their rows, commits, then removes their files: the avatar and
    the admin selfie and the photos sent in their support chat (by either side)."""
    photos = db.scalars(select(ChatMessage.image_key).where(ChatMessage.user_id == user.id))
    files = [k for k in (user.avatar_key, user.selfie_key, *photos) if k]
    # Explicit deletes: SQLite doesn't enforce the ON DELETE CASCADE foreign keys.
    for model in (ScoreRecord, Notification, KnownDevice, LoginSession, ChatMessage, LoginEvent):
        db.execute(delete(model).where(model.user_id == user.id))
    db.execute(delete(OtpCode).where(OtpCode.email == user.email))
    db.delete(user)
    db.commit()
    for key in files:
        storage.delete(key)
