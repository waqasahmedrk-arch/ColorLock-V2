"""The signed-in user's in-app notifications: list, unread count, mark read, delete, the
on/off switch for activity notifications and the notification sound."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ..db.auth import Notification, User, get_auth_db, utcnow
from ..errors import ProblemError
from .auth import current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationOut(BaseModel):
    id: str
    kind: str
    category: str
    data: dict[str, Any]
    link: str | None
    created_at: datetime
    read: bool


class NotificationPage(BaseModel):
    items: list[NotificationOut]
    total: int
    unread: int
    offset: int
    limit: int


class UnreadOut(BaseModel):
    unread: int


class NotificationPrefs(BaseModel):
    activity: bool
    sound: bool


class NotificationPrefsIn(BaseModel):
    """Only the fields sent are changed."""

    activity: bool | None = None
    sound: bool | None = None


def _out(n: Notification) -> NotificationOut:
    # Stored as naive UTC (MySQL DATETIME); say so, so browsers show local time correctly.
    return NotificationOut(id=n.id, kind=n.kind, category=n.category, data=n.data or {},
                           link=n.link, created_at=n.created_at.replace(tzinfo=UTC),
                           read=n.read_at is not None)


def _unread(db: Session, user: User) -> int:
    return db.scalar(select(func.count(Notification.id)).where(
        Notification.user_id == user.id, Notification.read_at.is_(None))) or 0


def _own(db: Session, user: User, notification_id: str) -> Notification:
    row = db.get(Notification, notification_id)
    # Someone else's notification looks exactly like a missing one.
    if row is None or row.user_id != user.id:
        raise ProblemError(404, "Notification not found")
    return row


@router.get("", response_model=NotificationPage)
def list_notifications(offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=50),
                       unread_only: bool = False, user: User = Depends(current_user),
                       db: Session = Depends(get_auth_db)) -> NotificationPage:
    where = [Notification.user_id == user.id]
    if unread_only:
        where.append(Notification.read_at.is_(None))
    rows = db.scalars(select(Notification).where(*where)
                      .order_by(Notification.created_at.desc(), Notification.id)
                      .offset(offset).limit(limit)).all()
    total = db.scalar(select(func.count(Notification.id)).where(*where)) or 0
    return NotificationPage(items=[_out(r) for r in rows], total=total,
                            unread=_unread(db, user), offset=offset, limit=limit)


# Polled by the navbar bell, so it stays a single count query.
@router.get("/unread-count", response_model=UnreadOut)
def unread_count(user: User = Depends(current_user),
                 db: Session = Depends(get_auth_db)) -> UnreadOut:
    return UnreadOut(unread=_unread(db, user))


@router.get("/preferences", response_model=NotificationPrefs)
def get_preferences(user: User = Depends(current_user)) -> NotificationPrefs:
    return NotificationPrefs(activity=user.notify_activity, sound=user.notify_sound)


@router.patch("/preferences", response_model=NotificationPrefs)
def set_preferences(body: NotificationPrefsIn, user: User = Depends(current_user),
                    db: Session = Depends(get_auth_db)) -> NotificationPrefs:
    if body.activity is not None:
        user.notify_activity = body.activity
    if body.sound is not None:
        user.notify_sound = body.sound
    db.commit()
    return get_preferences(user)


@router.post("/read-all", response_model=UnreadOut)
def mark_all_read(user: User = Depends(current_user),
                  db: Session = Depends(get_auth_db)) -> UnreadOut:
    db.execute(update(Notification).where(Notification.user_id == user.id,
                                          Notification.read_at.is_(None))
               .values(read_at=utcnow()))
    db.commit()
    return UnreadOut(unread=0)


@router.post("/{notification_id}/read", response_model=UnreadOut)
def mark_read(notification_id: str, user: User = Depends(current_user),
              db: Session = Depends(get_auth_db)) -> UnreadOut:
    row = _own(db, user, notification_id)
    if row.read_at is None:
        row.read_at = utcnow()
        db.commit()
    return UnreadOut(unread=_unread(db, user))


@router.delete("/{notification_id}", response_model=UnreadOut)
def delete_notification(notification_id: str, user: User = Depends(current_user),
                        db: Session = Depends(get_auth_db)) -> UnreadOut:
    db.delete(_own(db, user, notification_id))
    db.commit()
    return UnreadOut(unread=_unread(db, user))


@router.delete("", status_code=204)
def clear_notifications(user: User = Depends(current_user),
                        db: Session = Depends(get_auth_db)) -> None:
    db.execute(delete(Notification).where(Notification.user_id == user.id))
    db.commit()
