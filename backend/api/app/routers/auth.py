"""Accounts: sign-up with an emailed one-time code, login, logout, password reset.

The session is an opaque random token in an HttpOnly cookie; only its HMAC is stored.
Handlers are sync so scrypt hashing and SMTP run in FastAPI's threadpool.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db.auth import KnownDevice, LoginEvent, LoginSession, OtpCode, User, get_auth_db, utcnow
from ..deps import get_storage
from ..errors import ProblemError
from ..schemas.auth import (
    ChangePasswordIn,
    EmailIn,
    LoginIn,
    OtpSentOut,
    ResendIn,
    ResetIn,
    SignupIn,
    UserOut,
    VerifyIn,
)
from ..services import mailer
from ..services.notify import notify, remember_device
from ..services.security import (
    DUMMY_PASSWORD_HASH,
    hash_otp,
    hash_password,
    hash_token,
    new_otp,
    new_session_token,
    verify_password,
)
from ..settings import Settings, get_settings

router = APIRouter(prefix="/auth", tags=["auth"])
log = logging.getLogger("colourlock.auth")

SESSION_COOKIE = "cl_session"  # matches the `cl_session` Cookie params below
LANG_COOKIE = "lang"  # the frontend's language cookie; the same one the mailer reads
LANGUAGES = ("en", "zh")
# How stale a session's last_seen_at may get before a request refreshes it.
LAST_SEEN_EVERY = timedelta(minutes=5)
# How long sign-in attempts are kept for the admin panel.
LOGIN_EVENT_DAYS = 90
INVALID_CODE = ProblemError(400, "Invalid code", "That code is wrong or has expired.")


def user_out(user: User) -> UserOut:
    avatar = get_storage().signed_url(user.avatar_key) if user.avatar_key else None
    return UserOut(id=user.id, email=user.email, name=user.name, avatar_url=avatar,
                   language=user.language, created_at=user.created_at, gender=user.gender,
                   date_of_birth=user.date_of_birth, phone=user.phone, job_title=user.job_title,
                   is_admin=user.is_admin)


def blocked_problem(user: User) -> ProblemError:
    return ProblemError(403, "Account blocked",
                        "This account has been blocked. Contact the ColorLock team for help.",
                        type_="/problems/account-blocked")


def _client(request: Request) -> tuple[str | None, str | None]:
    user_agent = (request.headers.get("user-agent") or "")[:255] or None
    return user_agent, request.client.host if request.client else None


def record_login(db: Session, request: Request, email: str, user: User | None,
                 reason: str, scope: str = "user") -> None:
    user_agent, ip = _client(request)
    db.add(LoginEvent(user_id=user.id if user else None, email=email, success=reason == "ok",
                      reason=reason, ip=ip, user_agent=user_agent, scope=scope))
    if reason == "ok":
        db.execute(delete(LoginEvent).where(
            LoginEvent.created_at < utcnow() - timedelta(days=LOGIN_EVENT_DAYS)))


def queue_sign_in_alert(background: BackgroundTasks, settings: Settings, request: Request,
                        user: User, scope: str) -> None:
    """Emails the account owner about this sign-in, after the response has gone out."""
    user_agent, ip = _client(request)
    background.add_task(mailer.send_sign_in_alert, settings, user.email, name=user.name,
                        scope=scope, at=utcnow(), user_agent=user_agent, ip=ip,
                        lang=user.language)


def set_lang_cookie(response: Response, lang: str) -> None:
    # Readable by the frontend (not HttpOnly): it is a UI preference, not a credential.
    response.set_cookie(LANG_COOKIE, lang, max_age=365 * 24 * 3600, samesite="lax", path="/")


def issue_otp(db: Session, settings: Settings, email: str, purpose: str,
               lang: str | None) -> OtpSentOut:
    now = utcnow()
    row = db.scalar(select(OtpCode).where(OtpCode.email == email, OtpCode.purpose == purpose))
    if row is not None:
        wait = settings.otp_resend_cooldown_s - (now - row.created_at).total_seconds()
        if wait > 0:
            raise ProblemError(429, "Please wait",
                               f"You can request a new code in {int(wait) + 1} seconds.")
    code = new_otp()
    if row is None:
        row = OtpCode(email=email, purpose=purpose)
        db.add(row)
    row.code_hash = hash_otp(settings.auth_secret, email, purpose, code)
    row.attempts = 0
    row.created_at = now
    row.expires_at = now + timedelta(minutes=settings.otp_ttl_minutes)
    # Send before committing: a failed send leaves no code (and no cooldown) behind.
    mailer.send_otp(settings, email, purpose, code, lang or "en")
    db.commit()
    return OtpSentOut(email=email, expires_in_s=settings.otp_ttl_minutes * 60,
                      resend_after_s=settings.otp_resend_cooldown_s)


def consume_otp(db: Session, settings: Settings, email: str, purpose: str, code: str) -> None:
    row = db.scalar(select(OtpCode).where(OtpCode.email == email, OtpCode.purpose == purpose))
    if row is None or row.expires_at < utcnow():
        raise INVALID_CODE
    if row.attempts >= settings.otp_max_attempts:
        raise ProblemError(429, "Too many attempts", "Request a new code and try again.")
    if row.code_hash != hash_otp(settings.auth_secret, email, purpose, code):
        row.attempts += 1
        db.commit()
        raise INVALID_CODE
    db.delete(row)


def _start_session(db: Session, settings: Settings, request: Request, response: Response,
                   user: User, remember: bool, first: bool = False) -> None:
    """`first` is the sign-in that completes sign-up: it gets a welcome, not a device alert."""
    user_agent, ip = _client(request)
    # Accounts from before device tracking have no known devices; their first sign-in per
    # browser is recorded quietly instead of raising an alert.
    had_devices = db.scalar(select(KnownDevice.id).where(KnownDevice.user_id == user.id)
                            .limit(1)) is not None
    if first:
        remember_device(db, user, user_agent)
        notify(db, user, "welcome", {"name": user.name}, link="/score")
    elif remember_device(db, user, user_agent) and had_devices:
        notify(db, user, "new_sign_in", {"user_agent": user_agent, "ip": ip}, link="/settings")
    open_session(db, settings, request, response, user, remember, "user", SESSION_COOKIE)


def open_session(db: Session, settings: Settings, request: Request, response: Response,
                 user: User, remember: bool, scope: str, cookie: str) -> None:
    """Stores a new session of `scope` ("user" | "admin"), commits, and sets its cookie."""
    token = new_session_token()
    user_agent, ip = _client(request)
    ttl = (timedelta(days=settings.session_remember_days) if remember
           else timedelta(hours=settings.session_ttl_hours))
    now = utcnow()
    db.execute(delete(LoginSession).where(LoginSession.user_id == user.id,
                                          LoginSession.expires_at < now))
    db.add(LoginSession(token_hash=hash_token(settings.auth_secret, token), user_id=user.id,
                        expires_at=now + ttl, last_seen_at=now, user_agent=user_agent, ip=ip,
                        scope=scope))
    user.last_login_at = now
    db.commit()
    response.set_cookie(
        cookie, token, httponly=True, samesite="lax", path="/",
        secure=settings.session_cookie_secure,
        # Without "remember me" it's a browser-session cookie; the server TTL still applies.
        max_age=int(ttl.total_seconds()) if remember else None,
    )
    # The account's saved language follows the user to a new browser.
    if user.language in LANGUAGES:
        set_lang_cookie(response, user.language)


def session_user(db: Session, settings: Settings, token: str | None, scope: str) -> User | None:
    """The account behind a session cookie, if the session is live and of this scope."""
    if not token:
        return None
    row = db.get(LoginSession, hash_token(settings.auth_secret, token))
    now = utcnow()
    # A token only works with the cookie it was issued for: an admin-panel session can't be
    # replayed on the ColorLock site, and the other way round.
    if row is None or row.expires_at <= now or row.scope != scope:
        return None
    user = db.get(User, row.user_id)
    # Blocking also deletes the sessions; this covers any created in between.
    if user is None or user.is_blocked:
        return None
    if row.last_seen_at is None or now - row.last_seen_at > LAST_SEEN_EVERY:
        row.last_seen_at = now
        db.commit()
    return user


def optional_user(db: Session = Depends(get_auth_db),
                  settings: Settings = Depends(get_settings),
                  cl_session: str | None = Cookie(default=None)) -> User | None:
    return session_user(db, settings, cl_session, "user")


def current_user(user: User | None = Depends(optional_user)) -> User:
    if user is None:
        raise ProblemError(401, "Not signed in")
    return user


@router.post("/signup", response_model=OtpSentOut, status_code=202)
def signup(body: SignupIn, db: Session = Depends(get_auth_db),
           settings: Settings = Depends(get_settings),
           lang: str | None = Cookie(default=None)) -> OtpSentOut:
    user = db.scalar(select(User).where(User.email == body.email))
    if user is not None and user.is_verified:
        raise ProblemError(409, "Account exists",
                           "An account with this email already exists. Sign in instead.")
    if user is None:
        user = User(email=body.email, name=body.name, password_hash="")
        db.add(user)
    # An unverified sign-up can be restarted; the latest details win.
    user.name = body.name
    user.password_hash = hash_password(body.password)
    db.flush()
    return issue_otp(db, settings, body.email, "signup", lang)


@router.post("/verify-email", response_model=UserOut)
def verify_email(body: VerifyIn, request: Request, response: Response,
                 db: Session = Depends(get_auth_db),
                 settings: Settings = Depends(get_settings)) -> UserOut:
    user = db.scalar(select(User).where(User.email == body.email))
    if user is None or user.is_verified:
        raise INVALID_CODE
    consume_otp(db, settings, body.email, "signup", body.code)
    user.is_verified = True
    user.verified_at = utcnow()
    record_login(db, request, body.email, user, "ok")
    _start_session(db, settings, request, response, user, body.remember, first=True)
    log.info("account verified")
    return user_out(user)


@router.post("/resend-code", response_model=OtpSentOut, status_code=202)
def resend_code(body: ResendIn, db: Session = Depends(get_auth_db),
                settings: Settings = Depends(get_settings),
                lang: str | None = Cookie(default=None)) -> OtpSentOut:
    user = db.scalar(select(User).where(User.email == body.email))
    wanted = user is not None and (user.is_verified == (body.purpose == "reset"))
    if not wanted:
        # Same answer either way, so this can't be used to probe for accounts.
        return OtpSentOut(email=body.email, expires_in_s=settings.otp_ttl_minutes * 60,
                          resend_after_s=settings.otp_resend_cooldown_s)
    return issue_otp(db, settings, body.email, body.purpose, lang)


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, request: Request, response: Response, background: BackgroundTasks,
          db: Session = Depends(get_auth_db),
          settings: Settings = Depends(get_settings)) -> UserOut:
    user = db.scalar(select(User).where(User.email == body.email))
    ok = verify_password(body.password, user.password_hash if user else DUMMY_PASSWORD_HASH)
    if user is None or not ok:
        record_login(db, request, body.email, user, "bad_password" if user else "unknown_email")
        db.commit()
        raise ProblemError(401, "Invalid credentials", "The email or password is incorrect.")
    if not user.is_verified:
        raise ProblemError(403, "Email not verified",
                           "Verify your email to finish signing up.",
                           type_="/problems/email-unverified")
    # Checked after the password, so a block is only revealed to someone who knows it.
    if user.is_blocked:
        record_login(db, request, body.email, user, "blocked")
        db.commit()
        raise blocked_problem(user)
    record_login(db, request, body.email, user, "ok")
    _start_session(db, settings, request, response, user, body.remember)
    queue_sign_in_alert(background, settings, request, user, "user")
    return user_out(user)


@router.post("/logout", status_code=204)
def logout(response: Response, db: Session = Depends(get_auth_db),
           settings: Settings = Depends(get_settings),
           cl_session: str | None = Cookie(default=None)) -> None:
    if cl_session:
        db.execute(delete(LoginSession).where(
            LoginSession.token_hash == hash_token(settings.auth_secret, cl_session)))
        db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)) -> UserOut:
    return user_out(user)


@router.post("/forgot-password", response_model=OtpSentOut, status_code=202)
def forgot_password(body: EmailIn, db: Session = Depends(get_auth_db),
                    settings: Settings = Depends(get_settings),
                    lang: str | None = Cookie(default=None)) -> OtpSentOut:
    return resend_code(ResendIn(email=body.email, purpose="reset"), db, settings, lang)


def apply_password_change(db: Session, settings: Settings, user: User, body: ChangePasswordIn,
                          keep_token: str | None) -> None:
    """Changes the password and signs out every session but `keep_token` (the caller's)."""
    if not verify_password(body.current_password, user.password_hash):
        raise ProblemError(400, "Incorrect password", "Your current password is incorrect.")
    if verify_password(body.new_password, user.password_hash):
        raise ProblemError(400, "Same password",
                           "Choose a new password that is different from the current one.")
    user.password_hash = hash_password(body.new_password)
    keep = hash_token(settings.auth_secret, keep_token or "")
    signed_out = db.execute(delete(LoginSession).where(LoginSession.user_id == user.id,
                                                       LoginSession.token_hash != keep)).rowcount
    notify(db, user, "password_changed", {"signed_out": signed_out or 0}, link="/settings")
    db.commit()
    log.info("password changed")


@router.post("/change-password", status_code=204)
def change_password(body: ChangePasswordIn, user: User = Depends(current_user),
                    db: Session = Depends(get_auth_db),
                    settings: Settings = Depends(get_settings),
                    cl_session: str | None = Cookie(default=None)) -> None:
    # Sign out every other session; this one (current_user guarantees the cookie) stays.
    apply_password_change(db, settings, user, body, cl_session)


@router.post("/reset-password", status_code=204)
def reset_password(body: ResetIn, db: Session = Depends(get_auth_db),
                   settings: Settings = Depends(get_settings)) -> None:
    user = db.scalar(select(User).where(User.email == body.email))
    if user is None or not user.is_verified:
        raise INVALID_CODE
    consume_otp(db, settings, body.email, "reset", body.code)
    user.password_hash = hash_password(body.password)
    # Sign out everywhere: whoever knew the old password loses access.
    db.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
    notify(db, user, "password_reset", link="/settings")
    db.commit()
    log.info("password reset")
