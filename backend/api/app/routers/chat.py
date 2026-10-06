"""The signed-in user's support conversation with the admin team. The browser polls
`GET /chat?after=<last id>` while the chat is open and `/chat/unread` while it is closed."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db.auth import ChatMessage, User, get_auth_db
from ..deps import get_storage
from ..services.chat import (
    MessageIn,
    MessageOut,
    ThreadOut,
    check_length,
    check_rate,
    mark_read,
    message_out,
    reply_target,
    store_image,
    thread,
    unread_from,
)
from ..services.storage import LocalStorage, S3Storage
from ..settings import Settings, get_settings
from .auth import current_user

router = APIRouter(prefix="/chat", tags=["chat"])


class UnreadOut(BaseModel):
    unread: int


@router.get("", response_model=ThreadOut)
def get_thread(after: int | None = Query(None, ge=0), before: int | None = Query(None, ge=1),
               user: User = Depends(current_user),
               db: Session = Depends(get_auth_db)) -> ThreadOut:
    return thread(db, user.id, "user", after, before)


@router.post("", response_model=MessageOut, status_code=201)
def send(body: MessageIn, user: User = Depends(current_user),
         db: Session = Depends(get_auth_db),
         settings: Settings = Depends(get_settings)) -> MessageOut:
    check_length(settings, body.body)
    check_rate(db, settings, user.id)
    ref = reply_target(db, user.id, body.reply_to)
    row = ChatMessage(user_id=user.id, sender="user", body=body.body,
                      reply_to_id=ref.id if ref else None)
    db.add(row)
    db.commit()
    return message_out(row, ref)


@router.post("/image", response_model=MessageOut, status_code=201)
def send_image(image: UploadFile = File(...), body: str = Form(""),
               reply_to: int | None = Form(None, ge=1),
               user: User = Depends(current_user), db: Session = Depends(get_auth_db),
               settings: Settings = Depends(get_settings),
               storage: LocalStorage | S3Storage = Depends(get_storage)) -> MessageOut:
    """A photo, with an optional caption in `body` and an optional message it replies to."""
    text = body.strip()
    check_length(settings, text)
    check_rate(db, settings, user.id)
    ref = reply_target(db, user.id, reply_to)
    key, w, h = store_image(settings, storage, user.id, image)
    row = ChatMessage(user_id=user.id, sender="user", body=text, image_key=key, image_w=w,
                      image_h=h, reply_to_id=ref.id if ref else None)
    db.add(row)
    db.commit()
    return message_out(row, ref)


# Polled while the chat is closed, so it stays a single count query.
@router.get("/unread", response_model=UnreadOut)
def unread(user: User = Depends(current_user), db: Session = Depends(get_auth_db)) -> UnreadOut:
    return UnreadOut(unread=unread_from(db, user.id, "admin"))


@router.post("/read", response_model=UnreadOut)
def read(user: User = Depends(current_user), db: Session = Depends(get_auth_db)) -> UnreadOut:
    mark_read(db, user.id, "user")
    db.commit()
    return UnreadOut(unread=0)
