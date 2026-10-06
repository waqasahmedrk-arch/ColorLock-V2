"""Admin panel: system overview, user accounts (details, sign-in history, devices), blocking,
roles, deletion, and the support inbox. Every route needs an admin session, and every
change to an account is written to the audit log.

Passwords are stored as scrypt hashes and are never shown, not even to admins.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import case, delete, func, or_, select
from sqlalchemy.orm import Session

from ..db.auth import (
    AdminAudit,
    ChatMessage,
    KnownDevice,
    LoginEvent,
    LoginSession,
    Notification,
    ScoreRecord,
    User,
    get_auth_db,
    utcnow,
)
from ..deps import get_storage
from ..errors import ProblemError
from ..schemas.auth import SignupIn
from ..services.accounts import purge_user
from ..services.chat import (
    MessageIn,
    MessageOut,
    ThreadOut,
    check_length,
    mark_read,
    message_out,
    reply_target,
    store_image,
    thread,
)
from ..services.notify import notify
from ..services.security import hash_password
from ..services.storage import LocalStorage, S3Storage
from ..settings import Settings, get_settings
from .account import SESSION_ID_LEN
from .admin_auth import admin_user

router = APIRouter(prefix="/admin", tags=["admin"])
log = logging.getLogger("colourlock.admin")

# Sessions refresh last_seen_at at most every 5 minutes, so "online" needs a wider window.
ONLINE_WINDOW = timedelta(minutes=10)
SERIES_DAYS = 14


def _utc(dt: datetime | None) -> datetime | None:
    # Stored as naive UTC (MySQL DATETIME); say so, so browsers show local time correctly.
    return dt.replace(tzinfo=UTC) if dt else None


def _avatar(user: User) -> str | None:
    return get_storage().signed_url(user.avatar_key) if user.avatar_key else None


def _audit(db: Session, admin: User, action: str, target: User | None,
           detail: dict[str, Any] | None = None) -> None:
    db.add(AdminAudit(admin_id=admin.id, admin_email=admin.email, action=action,
                      target_id=target.id if target else None,
                      target_email=target.email if target else None, detail=detail or {}))


def _target(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise ProblemError(404, "User not found")
    return user


def _not_self(admin: User, target: User, what: str) -> None:
    if admin.id == target.id:
        raise ProblemError(400, "Not on your own account", f"You can't {what} your own account.")


# ---------------------------------------------------------------- schemas


class UserSummary(BaseModel):
    id: str
    email: str
    name: str
    avatar_url: str | None
    is_admin: bool
    is_blocked: bool
    is_verified: bool
    online: bool


class UserRow(UserSummary):
    created_at: datetime
    last_login_at: datetime | None
    sessions: int
    scores: int


class UserPage(BaseModel):
    items: list[UserRow]
    total: int
    offset: int
    limit: int


class LoginEventOut(BaseModel):
    id: int
    email: str
    user_id: str | None
    success: bool
    reason: str
    scope: str  # "user": ColorLock site sign-in; "admin": admin panel sign-in
    ip: str | None
    user_agent: str | None
    created_at: datetime


class AuditOut(BaseModel):
    id: int
    admin_email: str
    action: str
    target_id: str | None
    target_email: str | None
    detail: dict[str, Any]
    created_at: datetime


class AdminSessionOut(BaseModel):
    id: str
    created_at: datetime
    last_seen_at: datetime | None
    expires_at: datetime
    user_agent: str | None
    ip: str | None


class UserDetail(UserRow):
    language: str | None
    gender: str | None
    date_of_birth: date | None
    phone: str | None
    job_title: str | None
    verified_at: datetime | None
    blocked_at: datetime | None
    blocked_reason: str | None
    selfie_at: datetime | None  # when the admin selfie was taken; None: never (or not an admin)
    notify_activity: bool
    notify_sound: bool
    known_devices: int
    notifications: int
    messages: int
    failed_logins_24h: int
    failed_logins_total: int
    last_ip: str | None
    session_list: list[AdminSessionOut]
    login_events: list[LoginEventOut]
    audit: list[AuditOut]


class DayCount(BaseModel):
    day: date
    signups: int
    logins: int
    failed: int


class StatsOut(BaseModel):
    users: int
    verified: int
    unverified: int
    blocked: int
    admins: int
    online: int
    active_sessions: int
    signups_7d: int
    logins_24h: int
    failed_24h: int
    scores: int
    chat_unread: int
    chat_waiting: int  # conversations with unread user messages
    series: list[DayCount]
    recent_users: list[UserRow]
    recent_failed: list[LoginEventOut]
    recent_audit: list[AuditOut]


class BlockIn(BaseModel):
    reason: str | None = Field(default=None, max_length=255)


class RoleIn(BaseModel):
    is_admin: bool


class ConversationOut(BaseModel):
    user: UserSummary
    last_body: str
    last_image: bool  # the last message carries a photo
    last_sender: str
    last_at: datetime
    unread: int
    total: int


class ConversationPage(BaseModel):
    items: list[ConversationOut]
    total: int


class InboxUnreadOut(BaseModel):
    unread: int
    conversations: int


class AdminThreadOut(ThreadOut):
    user: UserSummary


# ---------------------------------------------------------------- helpers


def _online_ids(db: Session, user_ids: list[str]) -> set[str]:
    if not user_ids:
        return set()
    now = utcnow()
    return set(db.scalars(select(LoginSession.user_id).where(
        LoginSession.user_id.in_(user_ids), LoginSession.expires_at > now,
        LoginSession.last_seen_at > now - ONLINE_WINDOW)).all())


def _summary(user: User, online: set[str]) -> UserSummary:
    return UserSummary(id=user.id, email=user.email, name=user.name, avatar_url=_avatar(user),
                       is_admin=user.is_admin, is_blocked=user.is_blocked,
                       is_verified=user.is_verified, online=user.id in online)


def _rows(db: Session, users: list[User]) -> list[UserRow]:
    ids = [u.id for u in users]
    if not ids:
        return []
    now = utcnow()
    sessions = dict(db.execute(
        select(LoginSession.user_id, func.count()).where(
            LoginSession.user_id.in_(ids), LoginSession.expires_at > now)
        .group_by(LoginSession.user_id)).all())
    scores = dict(db.execute(
        select(ScoreRecord.user_id, func.count()).where(ScoreRecord.user_id.in_(ids))
        .group_by(ScoreRecord.user_id)).all())
    online = _online_ids(db, ids)
    return [UserRow(**_summary(u, online).model_dump(), created_at=_utc(u.created_at),
                    last_login_at=_utc(u.last_login_at), sessions=sessions.get(u.id, 0),
                    scores=scores.get(u.id, 0))
            for u in users]


def _event_out(e: LoginEvent) -> LoginEventOut:
    return LoginEventOut(id=e.id, email=e.email, user_id=e.user_id, success=e.success,
                         reason=e.reason, scope=e.scope or "user", ip=e.ip, user_agent=e.user_agent,
                         created_at=_utc(e.created_at))


def _audit_out(a: AdminAudit) -> AuditOut:
    return AuditOut(id=a.id, admin_email=a.admin_email, action=a.action, target_id=a.target_id,
                    target_email=a.target_email, detail=a.detail or {},
                    created_at=_utc(a.created_at))


def _count(db: Session, *where: Any, model: Any = User) -> int:
    return db.scalar(select(func.count()).select_from(model).where(*where)) or 0


# ---------------------------------------------------------------- overview


@router.get("/stats", response_model=StatsOut)
def stats(_: User = Depends(admin_user), db: Session = Depends(get_auth_db)) -> StatsOut:
    now = utcnow()
    day_ago = now - timedelta(days=1)
    start = (now - timedelta(days=SERIES_DAYS - 1)).replace(hour=0, minute=0, second=0,
                                                            microsecond=0)
    series = {(start + timedelta(days=i)).date(): [0, 0, 0] for i in range(SERIES_DAYS)}
    for (created,) in db.execute(select(User.created_at).where(User.created_at >= start)):
        series[created.date()][0] += 1
    for created, success in db.execute(select(LoginEvent.created_at, LoginEvent.success)
                                       .where(LoginEvent.created_at >= start)):
        series[created.date()][1 if success else 2] += 1

    online = db.scalar(select(func.count(func.distinct(LoginSession.user_id))).where(
        LoginSession.expires_at > now, LoginSession.last_seen_at > now - ONLINE_WINDOW)) or 0
    chat_unread, chat_waiting = db.execute(select(
        func.count(ChatMessage.id), func.count(func.distinct(ChatMessage.user_id))).where(
        ChatMessage.sender == "user", ChatMessage.read_at.is_(None))).one()
    recent = list(db.scalars(select(User).order_by(User.created_at.desc()).limit(6)))
    failed = db.scalars(select(LoginEvent).where(LoginEvent.success.is_(False))
                        .order_by(LoginEvent.id.desc()).limit(8))
    audit = db.scalars(select(AdminAudit).order_by(AdminAudit.id.desc()).limit(8))
    return StatsOut(
        users=_count(db), verified=_count(db, User.is_verified.is_(True)),
        unverified=_count(db, User.is_verified.is_(False)),
        blocked=_count(db, User.is_blocked.is_(True)), admins=_count(db, User.is_admin.is_(True)),
        online=online, active_sessions=_count(db, LoginSession.expires_at > now, model=LoginSession),
        signups_7d=_count(db, User.created_at >= now - timedelta(days=7)),
        logins_24h=_count(db, LoginEvent.success.is_(True), LoginEvent.created_at >= day_ago,
                          model=LoginEvent),
        failed_24h=_count(db, LoginEvent.success.is_(False), LoginEvent.created_at >= day_ago,
                          model=LoginEvent),
        scores=_count(db, model=ScoreRecord), chat_unread=chat_unread or 0,
        chat_waiting=chat_waiting or 0,
        series=[DayCount(day=d, signups=v[0], logins=v[1], failed=v[2]) for d, v in series.items()],
        recent_users=_rows(db, recent), recent_failed=[_event_out(e) for e in failed],
        recent_audit=[_audit_out(a) for a in audit])


@router.get("/login-events", response_model=list[LoginEventOut])
def login_events(failed_only: bool = False, limit: int = Query(50, ge=1, le=200),
                 _: User = Depends(admin_user),
                 db: Session = Depends(get_auth_db)) -> list[LoginEventOut]:
    q = select(LoginEvent)
    if failed_only:
        q = q.where(LoginEvent.success.is_(False))
    return [_event_out(e) for e in db.scalars(q.order_by(LoginEvent.id.desc()).limit(limit))]


@router.get("/audit", response_model=list[AuditOut])
def audit_log(limit: int = Query(50, ge=1, le=200), _: User = Depends(admin_user),
              db: Session = Depends(get_auth_db)) -> list[AuditOut]:
    return [_audit_out(a) for a in db.scalars(select(AdminAudit)
                                              .order_by(AdminAudit.id.desc()).limit(limit))]


# ---------------------------------------------------------------- users

Status = Literal["all", "active", "blocked", "admins", "unverified", "online"]
Sort = Literal["newest", "oldest", "last_login", "name"]


@router.get("/users", response_model=UserPage)
def list_users(q: str = "", status: Status = "all", sort: Sort = "newest",
               offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100),
               _: User = Depends(admin_user), db: Session = Depends(get_auth_db)) -> UserPage:
    where: list[Any] = []
    if q.strip():
        like = f"%{q.strip().lower()}%"
        where.append(or_(func.lower(User.email).like(like), func.lower(User.name).like(like)))
    if status == "active":
        where += [User.is_blocked.is_(False), User.is_verified.is_(True)]
    elif status == "blocked":
        where.append(User.is_blocked.is_(True))
    elif status == "admins":
        where.append(User.is_admin.is_(True))
    elif status == "unverified":
        where.append(User.is_verified.is_(False))
    elif status == "online":
        now = utcnow()
        where.append(User.id.in_(select(LoginSession.user_id).where(
            LoginSession.expires_at > now, LoginSession.last_seen_at > now - ONLINE_WINDOW)))
    order = {
        "newest": [User.created_at.desc()],
        "oldest": [User.created_at.asc()],
        # Never-signed-in accounts last, on every database.
        "last_login": [case((User.last_login_at.is_(None), 1), else_=0),
                       User.last_login_at.desc()],
        "name": [func.lower(User.name).asc()],
    }[sort]
    users = list(db.scalars(select(User).where(*where).order_by(*order, User.id)
                            .offset(offset).limit(limit)))
    return UserPage(items=_rows(db, users), total=_count(db, *where), offset=offset, limit=limit)


@router.get("/users/{user_id}", response_model=UserDetail)
def user_detail(user_id: str, _: User = Depends(admin_user),
                db: Session = Depends(get_auth_db)) -> UserDetail:
    user = _target(db, user_id)
    now = utcnow()
    sessions = db.scalars(select(LoginSession).where(
        LoginSession.user_id == user.id, LoginSession.expires_at > now)
        .order_by(LoginSession.last_seen_at.desc())).all()
    events = db.scalars(select(LoginEvent).where(
        or_(LoginEvent.user_id == user.id, LoginEvent.email == user.email))
        .order_by(LoginEvent.id.desc()).limit(40)).all()
    last_ok = next((e for e in events if e.success), None)
    failed = (LoginEvent.success.is_(False),
              or_(LoginEvent.user_id == user.id, LoginEvent.email == user.email))
    audit = db.scalars(select(AdminAudit).where(AdminAudit.target_id == user.id)
                       .order_by(AdminAudit.id.desc()).limit(20)).all()
    return UserDetail(
        **_rows(db, [user])[0].model_dump(), language=user.language, gender=user.gender,
        date_of_birth=user.date_of_birth, phone=user.phone, job_title=user.job_title,
        verified_at=_utc(user.verified_at), blocked_at=_utc(user.blocked_at),
        blocked_reason=user.blocked_reason, selfie_at=_utc(user.selfie_at),
        notify_activity=user.notify_activity,
        notify_sound=user.notify_sound,
        known_devices=_count(db, KnownDevice.user_id == user.id, model=KnownDevice),
        notifications=_count(db, Notification.user_id == user.id, model=Notification),
        messages=_count(db, ChatMessage.user_id == user.id, model=ChatMessage),
        failed_logins_24h=_count(db, *failed, LoginEvent.created_at >= now - timedelta(days=1),
                                 model=LoginEvent),
        failed_logins_total=_count(db, *failed, model=LoginEvent),
        last_ip=last_ok.ip if last_ok else None,
        session_list=[AdminSessionOut(id=s.token_hash[:SESSION_ID_LEN],
                                      created_at=_utc(s.created_at),
                                      last_seen_at=_utc(s.last_seen_at),
                                      expires_at=_utc(s.expires_at), user_agent=s.user_agent,
                                      ip=s.ip) for s in sessions],
        login_events=[_event_out(e) for e in events], audit=[_audit_out(a) for a in audit])


@router.post("/users/{user_id}/block", response_model=UserDetail)
def block_user(user_id: str, body: BlockIn, admin: User = Depends(admin_user),
               db: Session = Depends(get_auth_db)) -> UserDetail:
    user = _target(db, user_id)
    _not_self(admin, user, "block")
    if user.is_admin:
        raise ProblemError(400, "Can't block an admin", "Remove their admin access first.")
    reason = " ".join((body.reason or "").split()) or None
    if not user.is_blocked:
        user.is_blocked, user.blocked_at, user.blocked_reason = True, utcnow(), reason
        signed_out = db.execute(delete(LoginSession).where(LoginSession.user_id == user.id)).rowcount
        _audit(db, admin, "block", user, {"reason": reason, "signed_out": signed_out or 0})
        db.commit()
        log.info("user blocked")
    return user_detail(user_id, admin, db)


@router.post("/users/{user_id}/unblock", response_model=UserDetail)
def unblock_user(user_id: str, admin: User = Depends(admin_user),
                 db: Session = Depends(get_auth_db)) -> UserDetail:
    user = _target(db, user_id)
    if user.is_blocked:
        user.is_blocked, user.blocked_at, user.blocked_reason = False, None, None
        notify(db, user, "account_restored", link="/")
        _audit(db, admin, "unblock", user)
        db.commit()
        log.info("user unblocked")
    return user_detail(user_id, admin, db)


@router.delete("/users/{user_id}/sessions", response_model=UserDetail)
def sign_out_everywhere(user_id: str, admin: User = Depends(admin_user),
                        db: Session = Depends(get_auth_db)) -> UserDetail:
    user = _target(db, user_id)
    _not_self(admin, user, "sign out every session of")
    count = db.execute(delete(LoginSession).where(LoginSession.user_id == user.id)).rowcount
    if count:
        notify(db, user, "sessions_revoked", {"count": count, "by_admin": True}, link="/settings")
        _audit(db, admin, "sign_out_all", user, {"count": count})
    db.commit()
    return user_detail(user_id, admin, db)


@router.delete("/users/{user_id}/sessions/{session_id}", response_model=UserDetail)
def sign_out_one(user_id: str, session_id: str, admin: User = Depends(admin_user),
                 db: Session = Depends(get_auth_db)) -> UserDetail:
    user = _target(db, user_id)
    rows = [r for r in db.scalars(select(LoginSession).where(LoginSession.user_id == user.id))
            if len(session_id) == SESSION_ID_LEN and r.token_hash.startswith(session_id)]
    if len(rows) != 1:
        raise ProblemError(404, "Session not found")
    db.delete(rows[0])
    notify(db, user, "sessions_revoked", {"count": 1, "by_admin": True}, link="/settings")
    _audit(db, admin, "sign_out_session", user, {"user_agent": rows[0].user_agent})
    db.commit()
    return user_detail(user_id, admin, db)


@router.patch("/users/{user_id}/role", response_model=UserDetail)
def set_role(user_id: str, body: RoleIn, admin: User = Depends(admin_user),
             db: Session = Depends(get_auth_db)) -> UserDetail:
    user = _target(db, user_id)
    _not_self(admin, user, "change the role of")
    if body.is_admin and (user.is_blocked or not user.is_verified):
        raise ProblemError(400, "Can't make this account an admin",
                           "Only verified, unblocked accounts can be admins.")
    if user.is_admin != body.is_admin:
        user.is_admin = body.is_admin
        if not body.is_admin:
            # Out of the admin panel now, not when their session expires.
            db.execute(delete(LoginSession).where(LoginSession.user_id == user.id,
                                                  LoginSession.scope == "admin"))
        _audit(db, admin, "grant_admin" if body.is_admin else "revoke_admin", user)
        db.commit()
    return user_detail(user_id, admin, db)


@router.post("/admins", response_model=UserRow, status_code=201)
def create_admin(body: SignupIn, admin: User = Depends(admin_user),
                 db: Session = Depends(get_auth_db)) -> UserRow:
    """A new admin account. It starts unverified: the first sign-in to the admin panel emails
    a code to this address, and entering it verifies the account (routers/admin_auth.py)."""
    if db.scalar(select(User.id).where(User.email == body.email)) is not None:
        raise ProblemError(409, "Account exists",
                           "An account with this email already exists. Open it from Users and "
                           "choose Make admin instead.")
    now = utcnow()
    user = User(email=body.email, name=body.name, password_hash=hash_password(body.password),
                is_verified=False, is_admin=True, created_at=now)
    db.add(user)
    db.flush()
    _audit(db, admin, "create_admin", user, {"name": user.name})
    db.commit()
    log.info("admin account created")
    return _rows(db, [user])[0]


@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: str, admin: User = Depends(admin_user),
                db: Session = Depends(get_auth_db),
                storage: LocalStorage | S3Storage = Depends(get_storage)) -> None:
    user = _target(db, user_id)
    _not_self(admin, user, "delete")
    if user.is_admin:
        raise ProblemError(400, "Can't delete an admin", "Remove their admin access first.")
    _audit(db, admin, "delete", user, {"name": user.name})
    purge_user(db, user, storage)
    log.info("user deleted by admin")


# ---------------------------------------------------------------- support inbox


@router.get("/chats", response_model=ConversationPage)
def conversations(q: str = "", unread_only: bool = False, _: User = Depends(admin_user),
                  db: Session = Depends(get_auth_db)) -> ConversationPage:
    unread = func.sum(case(((ChatMessage.sender == "user") & ChatMessage.read_at.is_(None), 1),
                           else_=0))
    stats_q = (select(ChatMessage.user_id, func.max(ChatMessage.id).label("last_id"),
                      func.count(ChatMessage.id).label("total"), unread.label("unread"))
               .group_by(ChatMessage.user_id).subquery())
    query = (select(User, ChatMessage, stats_q.c.total, stats_q.c.unread)
             .join(stats_q, stats_q.c.user_id == User.id)
             .join(ChatMessage, ChatMessage.id == stats_q.c.last_id))
    if q.strip():
        like = f"%{q.strip().lower()}%"
        query = query.where(or_(func.lower(User.email).like(like), func.lower(User.name).like(like)))
    if unread_only:
        query = query.where(stats_q.c.unread > 0)
    rows = db.execute(query.order_by(stats_q.c.last_id.desc()).limit(200)).all()
    online = _online_ids(db, [r[0].id for r in rows])
    items = [ConversationOut(user=_summary(u, online), last_body=m.body[:200],
                             last_image=m.image_key is not None,
                             last_sender=m.sender, last_at=_utc(m.created_at),
                             unread=int(n_unread or 0), total=int(total))
             for u, m, total, n_unread in rows]
    return ConversationPage(items=items, total=len(items))


# Polled by the admin sidebar, so it stays one query.
@router.get("/chats/unread", response_model=InboxUnreadOut)
def inbox_unread(_: User = Depends(admin_user),
                 db: Session = Depends(get_auth_db)) -> InboxUnreadOut:
    n, convs = db.execute(select(func.count(ChatMessage.id),
                                 func.count(func.distinct(ChatMessage.user_id))).where(
        ChatMessage.sender == "user", ChatMessage.read_at.is_(None))).one()
    return InboxUnreadOut(unread=n or 0, conversations=convs or 0)


@router.get("/chats/{user_id}", response_model=AdminThreadOut)
def conversation(user_id: str, after: int | None = Query(None, ge=0),
                 before: int | None = Query(None, ge=1), _: User = Depends(admin_user),
                 db: Session = Depends(get_auth_db)) -> AdminThreadOut:
    user = _target(db, user_id)
    t = thread(db, user.id, "admin", after, before)
    return AdminThreadOut(**t.model_dump(), user=_summary(user, _online_ids(db, [user.id])))


@router.post("/chats/{user_id}", response_model=MessageOut, status_code=201)
def reply(user_id: str, body: MessageIn, admin: User = Depends(admin_user),
          db: Session = Depends(get_auth_db),
          settings: Settings = Depends(get_settings)) -> MessageOut:
    user = _target(db, user_id)
    check_length(settings, body.body)
    ref = reply_target(db, user.id, body.reply_to)
    row = ChatMessage(user_id=user.id, sender="admin", admin_id=admin.id, admin_name=admin.name,
                      body=body.body, reply_to_id=ref.id if ref else None)
    db.add(row)
    # Replying means the admin has read what the user wrote. No notification: the user's chat
    # widget picks the message up by polling and plays the message sound.
    mark_read(db, user.id, "admin")
    db.commit()
    return message_out(row, ref)


@router.post("/chats/{user_id}/image", response_model=MessageOut, status_code=201)
def reply_image(user_id: str, image: UploadFile = File(...), body: str = Form(""),
                reply_to: int | None = Form(None, ge=1),
                admin: User = Depends(admin_user), db: Session = Depends(get_auth_db),
                settings: Settings = Depends(get_settings),
                storage: LocalStorage | S3Storage = Depends(get_storage)) -> MessageOut:
    """A photo for the user, with an optional caption in `body` and an optional message it
    replies to."""
    user = _target(db, user_id)
    text = body.strip()
    check_length(settings, text)
    ref = reply_target(db, user.id, reply_to)
    key, w, h = store_image(settings, storage, user.id, image)
    row = ChatMessage(user_id=user.id, sender="admin", admin_id=admin.id, admin_name=admin.name,
                      body=text, image_key=key, image_w=w, image_h=h,
                      reply_to_id=ref.id if ref else None)
    db.add(row)
    mark_read(db, user.id, "admin")
    db.commit()
    return message_out(row, ref)


@router.post("/chats/{user_id}/read", response_model=InboxUnreadOut)
def read_conversation(user_id: str, admin: User = Depends(admin_user),
                      db: Session = Depends(get_auth_db)) -> InboxUnreadOut:
    mark_read(db, _target(db, user_id).id, "admin")
    db.commit()
    return inbox_unread(admin, db)
