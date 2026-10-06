"""Support chat: one thread per user with the admin team. Shared by the user's /chat routes
and the admin inbox, so both sides page and mark messages read the same way."""

from __future__ import annotations

import io
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..db.auth import ChatMessage, utcnow
from ..deps import get_storage
from ..errors import ProblemError
from ..services.storage import LocalStorage, S3Storage
from ..settings import Settings

PAGE = 50
IMAGE_FORMATS = {"PNG", "JPEG", "WEBP", "GIF"}


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    reply_to: int | None = Field(None, ge=1)  # id of a message in the same thread

    @field_validator("body")
    @classmethod
    def _v_body(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Write a message first.")
        return v


class ReplyRef(BaseModel):
    """The message a reply quotes: enough to draw the quote and jump to the original."""

    id: int
    sender: str
    admin_name: str | None
    body: str  # shortened to QUOTE_CHARS
    image_url: str | None = None


QUOTE_CHARS = 160


class MessageOut(BaseModel):
    id: int
    sender: str  # "user" | "admin"
    body: str
    admin_name: str | None
    # A signed URL for an attached photo (expires; every fetch of the thread signs it again).
    image_url: str | None = None
    image_width: int | None = None
    image_height: int | None = None
    reply_to: ReplyRef | None = None
    created_at: datetime
    read: bool  # read by the other side


class ThreadOut(BaseModel):
    messages: list[MessageOut]
    unread: int  # messages from the other side this reader hasn't read
    has_more: bool  # older messages exist before the first one returned


def _image_url(m: ChatMessage) -> str | None:
    return get_storage().signed_url(m.image_key) if m.image_key else None


def reply_ref(m: ChatMessage) -> ReplyRef:
    body = m.body if len(m.body) <= QUOTE_CHARS else m.body[:QUOTE_CHARS - 1].rstrip() + "…"
    return ReplyRef(id=m.id, sender=m.sender, admin_name=m.admin_name, body=body,
                    image_url=_image_url(m))


def message_out(m: ChatMessage, ref: ChatMessage | None = None) -> MessageOut:
    """`ref` is the message `m` replies to, when it has one (and it still exists)."""
    # Stored as naive UTC (MySQL DATETIME); say so, so browsers show local time correctly.
    return MessageOut(id=m.id, sender=m.sender, body=m.body, admin_name=m.admin_name,
                      image_url=_image_url(m), image_width=m.image_w, image_height=m.image_h,
                      reply_to=reply_ref(ref) if ref is not None else None,
                      created_at=m.created_at.replace(tzinfo=UTC), read=m.read_at is not None)


def reply_target(db: Session, user_id: str, reply_to: int | None) -> ChatMessage | None:
    """The message being replied to; it must be in this user's thread."""
    if reply_to is None:
        return None
    ref = db.get(ChatMessage, reply_to)
    if ref is None or ref.user_id != user_id:
        raise ProblemError(422, "Can't reply to that message",
                           "The message you're replying to isn't in this conversation.")
    return ref


def store_image(settings: Settings, storage: LocalStorage | S3Storage, user_id: str,
                image: UploadFile) -> tuple[str, int, int]:
    """Checks an uploaded photo, re-encodes it and stores it under the conversation.

    Re-encoding drops EXIF (including GPS) and anything else riding along in the file, and
    caps the longest side. Returns (storage key, width, height).
    """
    data = image.file.read(settings.chat_image_max_bytes + 1)
    if len(data) > settings.chat_image_max_bytes:
        mb = settings.chat_image_max_bytes // (1024 * 1024)
        raise ProblemError(413, "Image too large", f"Photos can be up to {mb} MB.")
    if not data:
        raise ProblemError(422, "Empty upload", "The image file is empty.")
    try:
        with Image.open(io.BytesIO(data)) as src:
            if src.format not in IMAGE_FORMATS:
                raise ProblemError(415, "Unsupported image",
                                   "Use a PNG, JPEG, WebP or GIF image.")
            src.seek(0)  # first frame of an animated GIF / WebP
            alpha = "A" in src.getbands() or "transparency" in src.info
            im = ImageOps.exif_transpose(src).convert("RGBA" if alpha else "RGB")
            side = settings.chat_image_max_side
            im.thumbnail((side, side), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            # Transparency needs PNG; photos are much smaller as JPEG.
            if alpha:
                im.save(out, format="PNG", optimize=True)
            else:
                im.save(out, format="JPEG", quality=85, optimize=True, progressive=True)
            w, h = im.size
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise ProblemError(422, "Unreadable image", "That file isn't a readable image.") from exc
    ext, mime = ("png", "image/png") if alpha else ("jpg", "image/jpeg")
    key = f"chat/{user_id}/{secrets.token_hex(12)}.{ext}"
    storage.put(key, out.getvalue(), mime)
    return key, w, h


def unread_from(db: Session, user_id: str, sender: str) -> int:
    return db.scalar(select(func.count(ChatMessage.id)).where(
        ChatMessage.user_id == user_id, ChatMessage.sender == sender,
        ChatMessage.read_at.is_(None))) or 0


def thread(db: Session, user_id: str, reader: str, after: int | None,
           before: int | None) -> ThreadOut:
    """`after`: only newer messages (polling). `before`: the page before it (scrolling back).
    Neither: the newest page. Messages come oldest first."""
    q = select(ChatMessage).where(ChatMessage.user_id == user_id)
    if after is not None:
        rows = list(db.scalars(q.where(ChatMessage.id > after).order_by(ChatMessage.id)
                               .limit(PAGE * 4)))
        has_more = False
    else:
        if before is not None:
            q = q.where(ChatMessage.id < before)
        rows = list(db.scalars(q.order_by(ChatMessage.id.desc()).limit(PAGE + 1)))
        has_more = len(rows) > PAGE
        rows = rows[:PAGE][::-1]
    other = "admin" if reader == "user" else "user"
    # Quoted messages in one query (they may be older than this page).
    ids = {m.reply_to_id for m in rows if m.reply_to_id}
    refs = {r.id: r for r in db.scalars(select(ChatMessage).where(
        ChatMessage.id.in_(ids), ChatMessage.user_id == user_id))} if ids else {}
    return ThreadOut(messages=[message_out(m, refs.get(m.reply_to_id or 0)) for m in rows],
                     unread=unread_from(db, user_id, other), has_more=has_more)


def mark_read(db: Session, user_id: str, reader: str) -> None:
    """Marks the other side's messages read; the caller commits."""
    other = "admin" if reader == "user" else "user"
    db.execute(update(ChatMessage).where(ChatMessage.user_id == user_id,
                                         ChatMessage.sender == other,
                                         ChatMessage.read_at.is_(None))
               .values(read_at=utcnow()))


def check_length(settings: Settings, body: str) -> None:
    if len(body) > settings.chat_max_chars:
        raise ProblemError(422, "Message too long",
                           f"Messages can be up to {settings.chat_max_chars} characters.")


def check_rate(db: Session, settings: Settings, user_id: str) -> None:
    sent = db.scalar(select(func.count(ChatMessage.id)).where(
        ChatMessage.user_id == user_id, ChatMessage.sender == "user",
        ChatMessage.created_at > utcnow() - timedelta(minutes=1))) or 0
    if sent >= settings.chat_per_minute:
        raise ProblemError(429, "Slow down",
                           "You're sending messages too quickly. Wait a moment and try again.")
