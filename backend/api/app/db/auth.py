"""User accounts, one-time codes and login sessions.

These tables live in their own database (settings.auth_db_url, MySQL in dev), on a
metadata separate from the study schema, so accounts never touch the frozen study data.
Datetimes are naive UTC: MySQL DATETIME carries no zone.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime
from functools import lru_cache

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Engine,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    inspect,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from ..settings import get_settings
from .session import make_engine


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class AuthBase(DeclarativeBase):
    pass


class User(AuthBase):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True,
                                    default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(255))
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Storage key of the profile photo (a 256px PNG), if any.
    avatar_key: Mapped[str | None] = mapped_column(String(256))
    # UI language saved to the account ("en" | "zh"); restored as the lang cookie at login.
    language: Mapped[str | None] = mapped_column(String(8))
    # Opt-out for "activity" notifications (personal bests, milestones). Security and
    # account notifications are always on.
    notify_activity: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    # Optional personal details, edited on the Profile page; shown only to the user themself.
    gender: Mapped[str | None] = mapped_column(String(24))  # schemas.auth.GENDERS
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    phone: Mapped[str | None] = mapped_column(String(32))
    job_title: Mapped[str | None] = mapped_column(String(100))
    # Plays a sound in the browser when a notification or support reply arrives.
    notify_sound: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    # Admin panel access. Granted from the panel, or at sign-in for settings.admin_emails.
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    # A blocked account can't sign in, and its existing sessions stop working.
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    blocked_at: Mapped[datetime | None] = mapped_column(DateTime)
    blocked_reason: Mapped[str | None] = mapped_column(String(255))
    # The selfie taken at the admin's first sign-in to the admin panel (routers/admin_auth.py).
    # Private: never served; kept as a record and deleted with the account.
    selfie_key: Mapped[str | None] = mapped_column(String(256))
    selfie_at: Mapped[datetime | None] = mapped_column(DateTime)


class OtpCode(AuthBase):
    """At most one live code per (email, purpose); a resend overwrites it."""

    __tablename__ = "otp_codes"
    __table_args__ = (UniqueConstraint("email", "purpose", name="uq_otp_email_purpose"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(254))
    purpose: Mapped[str] = mapped_column(String(16))  # "signup" | "reset" | "admin" (sign-in)
    code_hash: Mapped[str] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)


class LoginSession(AuthBase):
    __tablename__ = "login_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    # Shown on the Settings page's device list; last_seen_at is refreshed at most every
    # few minutes, not on every request.
    user_agent: Mapped[str | None] = mapped_column(String(255))
    ip: Mapped[str | None] = mapped_column(String(45))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime)
    # "user": the ColorLock site (cl_session cookie). "admin": the admin panel (cl_admin cookie),
    # a separate sign-in, so each site keeps its own account.
    scope: Mapped[str] = mapped_column(String(8), default="user", server_default="user")


class ScoreRecord(AuthBase):
    """One image a signed-in user scored, kept in their personal history.

    The uploaded image itself is never stored (the Score page promises that); only the
    result and the original file name are. `result` is the full ScoreResult as returned
    by /score; the other columns are copies of the fields the history list shows.

    `name` is the user's own label for the score, unique within their history (ignoring
    case; enforced in routers/score.py, backed by the unique index). Records saved before
    names existed have none.
    """

    __tablename__ = "score_records"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_score_user_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True,
                                    default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    score_id: Mapped[str] = mapped_column(String(36))  # the row in the study DB's `scores`
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    filename: Mapped[str | None] = mapped_column(String(255))
    name: Mapped[str | None] = mapped_column(String(100))
    target_id: Mapped[str | None] = mapped_column(String(32))
    target_name: Mapped[str] = mapped_column(String(100))
    target_hex: Mapped[str] = mapped_column(String(7))
    sample_hex: Mapped[str] = mapped_column(String(7))
    delta_e00: Mapped[float] = mapped_column(Float)
    qc_pass: Mapped[bool] = mapped_column(Boolean)
    result: Mapped[dict] = mapped_column(JSON)


class Notification(AuthBase):
    """One in-app notification. The text is not stored: the frontend renders `kind` + `data`
    in the reader's language, so a notification reads correctly after a language switch."""

    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True,
                                    default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    category: Mapped[str] = mapped_column(String(16))  # "security" | "account" | "activity"
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    link: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime)


class KnownDevice(AuthBase):
    """Browsers a user has signed in from, so a sign-in from a new one can be flagged.

    Login sessions are deleted on sign-out, so they can't answer "seen before?" on their own.
    Only a hash of the user-agent is kept.
    """

    __tablename__ = "known_devices"
    __table_args__ = (UniqueConstraint("user_id", "fingerprint", name="uq_device_user_fp"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class LoginEvent(AuthBase):
    """Every sign-in attempt, for the admin panel's security view.

    Failed attempts against unknown emails are kept too (user_id is null), since bursts of
    them are what credential stuffing looks like. Pruned after LOGIN_EVENT_DAYS.
    """

    __tablename__ = "login_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), index=True)
    email: Mapped[str] = mapped_column(String(254))
    success: Mapped[bool] = mapped_column(Boolean)
    # "ok" | "bad_password" | "unknown_email" | "unverified" | "blocked" | "not_admin"
    reason: Mapped[str] = mapped_column(String(16))
    # Which sign-in form: "user" (the ColorLock site) or "admin" (the admin panel).
    scope: Mapped[str] = mapped_column(String(8), default="user", server_default="user")
    ip: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class ChatMessage(AuthBase):
    """One message in a user's support conversation. Each user has a single thread with the
    admin team; `sender` says which side wrote it. `read_at` is when the other side read it.
    The integer id doubles as the polling cursor."""

    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    sender: Mapped[str] = mapped_column(String(8))  # "user" | "admin"
    # The admin who replied (no FK: the reply outlives a deleted admin account).
    admin_id: Mapped[str | None] = mapped_column(String(36))
    admin_name: Mapped[str | None] = mapped_column(String(100))
    body: Mapped[str] = mapped_column(Text)  # "" for a photo sent without a caption
    # An attached photo: its storage key and pixel size (so the bubble keeps its shape
    # while the image loads).
    image_key: Mapped[str | None] = mapped_column(String(256))
    image_w: Mapped[int | None] = mapped_column(Integer)
    image_h: Mapped[int | None] = mapped_column(Integer)
    # The message this one replies to, in the same thread (no FK: the whole thread is only
    # ever deleted together).
    reply_to_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime)


class AdminAudit(AuthBase):
    """What admins did to accounts. Emails are copied in so the log still reads after the
    target account is deleted."""

    __tablename__ = "admin_audit"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    admin_id: Mapped[str] = mapped_column(String(36))
    admin_email: Mapped[str] = mapped_column(String(254))
    action: Mapped[str] = mapped_column(String(32))
    target_id: Mapped[str | None] = mapped_column(String(36), index=True)
    target_email: Mapped[str | None] = mapped_column(String(254))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


# Columns added after the first release. create_all never alters an existing table, so
# databases created before a column existed get it added here (nullable, no backfill).
_ADDED_COLUMNS = {
    "users": {"avatar_key": "VARCHAR(256) NULL", "language": "VARCHAR(8) NULL",
              "notify_activity": "BOOLEAN NOT NULL DEFAULT 1",
              "gender": "VARCHAR(24) NULL", "date_of_birth": "DATE NULL",
              "phone": "VARCHAR(32) NULL", "job_title": "VARCHAR(100) NULL",
              "notify_sound": "BOOLEAN NOT NULL DEFAULT 1",
              "is_admin": "BOOLEAN NOT NULL DEFAULT 0", "is_blocked": "BOOLEAN NOT NULL DEFAULT 0",
              "blocked_at": "DATETIME NULL", "blocked_reason": "VARCHAR(255) NULL",
              "selfie_key": "VARCHAR(256) NULL", "selfie_at": "DATETIME NULL"},
    "login_sessions": {"user_agent": "VARCHAR(255) NULL", "ip": "VARCHAR(45) NULL",
                       "last_seen_at": "DATETIME NULL",
                       "scope": "VARCHAR(8) NOT NULL DEFAULT 'user'"},
    "score_records": {"name": "VARCHAR(100) NULL"},
    "login_events": {"scope": "VARCHAR(8) NOT NULL DEFAULT 'user'"},
    "chat_messages": {"image_key": "VARCHAR(256) NULL", "image_w": "INTEGER NULL",
                      "image_h": "INTEGER NULL", "reply_to_id": "INTEGER NULL"},
}
# Unique indexes added after the first release, for the same reason: (table, name, columns).
_ADDED_UNIQUE = [("score_records", "uq_score_user_name", ("user_id", "name"))]


def _add_missing_columns(engine: Engine) -> None:
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, cols in _ADDED_COLUMNS.items():
            have = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols.items():
                if name not in have:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
        for table, index, columns in _ADDED_UNIQUE:
            known = {i["name"] for i in insp.get_indexes(table)} | {
                u["name"] for u in insp.get_unique_constraints(table)}
            if index not in known:
                conn.execute(text(f"CREATE UNIQUE INDEX {index} ON {table} ({', '.join(columns)})"))


@lru_cache
def get_auth_sessionmaker() -> sessionmaker[Session]:
    engine = make_engine(get_settings().auth_db_url)
    # Idempotent: creates only the auth tables that don't exist yet.
    AuthBase.metadata.create_all(engine)
    _add_missing_columns(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)


def get_auth_db() -> Iterator[Session]:
    db = get_auth_sessionmaker()()
    try:
        yield db
    finally:
        db.close()
