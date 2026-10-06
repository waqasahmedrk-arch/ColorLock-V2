"""Account settings: signed-in devices, saved language, deleting the account."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Cookie, Depends, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db.auth import LoginSession, User, get_auth_db, utcnow
from ..deps import get_storage
from ..errors import ProblemError
from ..schemas.auth import DeleteAccountIn, PreferencesIn, SessionOut, UserOut
from ..services.accounts import purge_user
from ..services.notify import notify
from ..services.security import hash_token, verify_password
from ..services.storage import LocalStorage, S3Storage
from ..settings import Settings, get_settings
from .auth import SESSION_COOKIE, current_user, set_lang_cookie, user_out

router = APIRouter(prefix="/auth", tags=["auth"])
log = logging.getLogger("colourlock.auth")

SESSION_ID_LEN = 16


def _utc(dt: datetime | None) -> datetime | None:
    # Stored as naive UTC (MySQL DATETIME); say so, so browsers show local time correctly.
    return dt.replace(tzinfo=UTC) if dt else None


def _current_hash(settings: Settings, cl_session: str | None) -> str:
    return hash_token(settings.auth_secret, cl_session or "")


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(user: User = Depends(current_user), db: Session = Depends(get_auth_db),
                  settings: Settings = Depends(get_settings),
                  cl_session: str | None = Cookie(default=None)) -> list[SessionOut]:
    mine = _current_hash(settings, cl_session)
    rows = db.scalars(select(LoginSession).where(LoginSession.user_id == user.id,
                                                 LoginSession.scope == "user",
                                                 LoginSession.expires_at > utcnow())).all()
    out = [SessionOut(id=r.token_hash[:SESSION_ID_LEN], created_at=_utc(r.created_at),
                      last_seen_at=_utc(r.last_seen_at), expires_at=_utc(r.expires_at),
                      user_agent=r.user_agent, ip=r.ip, current=r.token_hash == mine)
           for r in rows]
    # This device first, then the most recently active.
    return sorted(out, key=lambda s: (not s.current,
                                      -(s.last_seen_at or s.created_at).timestamp()))


@router.delete("/sessions", status_code=204)
def sign_out_others(user: User = Depends(current_user), db: Session = Depends(get_auth_db),
                    settings: Settings = Depends(get_settings),
                    cl_session: str | None = Cookie(default=None)) -> None:
    count = db.execute(delete(LoginSession).where(
        LoginSession.user_id == user.id, LoginSession.scope == "user",
        LoginSession.token_hash != _current_hash(settings, cl_session))).rowcount
    if count:
        notify(db, user, "sessions_revoked", {"count": count}, link="/settings")
    db.commit()


@router.delete("/sessions/{session_id}", status_code=204)
def sign_out_session(session_id: str, response: Response, user: User = Depends(current_user),
                     db: Session = Depends(get_auth_db),
                     settings: Settings = Depends(get_settings),
                     cl_session: str | None = Cookie(default=None)) -> None:
    rows = [r for r in db.scalars(select(LoginSession).where(LoginSession.user_id == user.id,
                                                             LoginSession.scope == "user"))
            if len(session_id) == SESSION_ID_LEN and r.token_hash.startswith(session_id)]
    if len(rows) != 1:
        raise ProblemError(404, "Session not found")
    if rows[0].token_hash == _current_hash(settings, cl_session):
        response.delete_cookie(SESSION_COOKIE, path="/")
    else:
        notify(db, user, "sessions_revoked", {"count": 1}, link="/settings")
    db.delete(rows[0])
    db.commit()


@router.patch("/me/preferences", response_model=UserOut)
def update_preferences(body: PreferencesIn, response: Response,
                       user: User = Depends(current_user),
                       db: Session = Depends(get_auth_db)) -> UserOut:
    user.language = body.language
    db.commit()
    set_lang_cookie(response, body.language)
    return user_out(user)


@router.post("/me/delete", status_code=204)
def delete_account(body: DeleteAccountIn, response: Response,
                   user: User = Depends(current_user), db: Session = Depends(get_auth_db),
                   storage: LocalStorage | S3Storage = Depends(get_storage)) -> None:
    if not verify_password(body.password, user.password_hash):
        raise ProblemError(400, "Incorrect password", "Your current password is incorrect.")
    purge_user(db, user, storage)
    response.delete_cookie(SESSION_COOKIE, path="/")
    log.info("account deleted")
