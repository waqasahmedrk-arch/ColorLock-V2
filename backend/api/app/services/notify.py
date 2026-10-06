"""In-app notifications: what creates them and how many are kept.

Callers add a notification inside their own transaction and commit it with the change that
caused it, so a failed action never leaves a notification behind.
"""

from __future__ import annotations

import hashlib
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db.auth import KnownDevice, Notification, User, utcnow

# kind -> category. Security and account notifications can't be switched off; activity can.
KINDS: dict[str, str] = {
    "welcome": "account",
    "new_sign_in": "security",
    "password_changed": "security",
    "password_reset": "security",
    "sessions_revoked": "security",
    "history_cleared": "account",
    "personal_best": "activity",
    "milestone": "activity",
    "admin_message": "account",  # no longer raised (chat replies only chime); kept for old rows
    "account_restored": "account",
}
MILESTONES = (10, 25, 50, 100, 250, 500, 1000)
# Oldest notifications beyond this are dropped, so the table can't grow without bound.
KEEP_PER_USER = 200


def notify(db: Session, user: User, kind: str, data: dict[str, Any] | None = None,
           link: str | None = None) -> Notification | None:
    category = KINDS[kind]
    if category == "activity" and not user.notify_activity:
        return None
    row = Notification(user_id=user.id, kind=kind, category=category, data=data or {},
                       link=link, created_at=utcnow())
    db.add(row)
    db.flush()
    old = db.scalars(select(Notification.id).where(Notification.user_id == user.id)
                     .order_by(Notification.created_at.desc(), Notification.id)
                     .offset(KEEP_PER_USER)).all()
    if old:
        db.execute(delete(Notification).where(Notification.id.in_(old)))
    return row


def _fingerprint(user_agent: str | None) -> str:
    return hashlib.sha256((user_agent or "").encode()).hexdigest()


def remember_device(db: Session, user: User, user_agent: str | None) -> bool:
    """Records the browser; returns True if this user had not signed in from it before."""
    fp = _fingerprint(user_agent)
    row = db.scalar(select(KnownDevice).where(KnownDevice.user_id == user.id,
                                              KnownDevice.fingerprint == fp))
    if row is not None:
        row.last_seen_at = utcnow()
        return False
    db.add(KnownDevice(user_id=user.id, fingerprint=fp))
    return True
