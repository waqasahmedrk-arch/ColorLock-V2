"""Sign-in for the admin panel, separate from the ColorLock site's.

The admin panel has its own session cookie (cl_admin) and its own session rows (scope
"admin"), so signing in or out on one site never changes who is signed in on the other.
Only admin accounts can sign in here; there is no sign-up. Admins are made by another
admin (POST /admin/admins), or by listing the email in settings.admin_emails.

Signing in takes two steps: the password (POST /login), then a 6-digit code emailed to the
admin (POST /verify). The code also proves the admin owns the address, so an admin account
created by another admin starts unverified and is verified by its first sign-in.

An admin with no selfie on file (a new admin's first sign-in, or an existing admin's first
since the check was added) takes a third step: /verify answers 202 with a short-lived selfie
token instead of a session, and the session opens only once POST /selfie stores a camera
selfie. The face and liveness check (a blink and a head turn) runs in the browser
(app/(auth)/admin-login/SelfieStep.tsx); the server checks the token and that the upload is a
real photo, then keeps it privately.
"""

from __future__ import annotations

import hmac
import io
import logging
import secrets
from datetime import timedelta
from typing import Literal

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Cookie,
    Depends,
    File,
    Form,
    Request,
    Response,
    UploadFile,
)
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db.auth import LoginSession, OtpCode, User, get_auth_db, utcnow
from ..deps import get_storage
from ..errors import ProblemError
from ..schemas.auth import ChangePasswordIn, EmailIn, LoginIn, OtpSentOut, UserOut
from ..services.security import (
    DUMMY_PASSWORD_HASH,
    hash_token,
    new_session_token,
    verify_password,
)
from ..services.storage import LocalStorage, S3Storage
from ..settings import Settings, get_settings
from .auth import (
    apply_password_change,
    blocked_problem,
    consume_otp,
    issue_otp,
    open_session,
    queue_sign_in_alert,
    record_login,
    session_user,
    user_out,
)

router = APIRouter(prefix="/admin/auth", tags=["admin"])
log = logging.getLogger("colourlock.admin")

ADMIN_COOKIE = "cl_admin"  # matches the `cl_admin` Cookie params below
PURPOSE = "admin"  # OtpCode.purpose for admin sign-in codes
SELFIE = "selfie"  # OtpCode.purpose for the selfie step's token (code_hash = hash_token)
SELFIE_FORMATS = {"JPEG", "PNG", "WEBP"}
SELFIE_MIN_SIDE = 240  # px; smaller than this can't usefully show a face
SELFIE_MAX_BYTES = 5 * 1024 * 1024

NOT_ADMIN = ProblemError(403, "Not an admin account",
                         "This account doesn't have access to the admin panel.",
                         type_="/problems/not-admin")
SELFIE_EXPIRED = ProblemError(400, "Sign in again",
                              "Your sign-in expired. Enter your password again.")


class AdminVerifyIn(EmailIn):
    code: str = Field(pattern=r"^\d{6}$")
    remember: bool = False


class SelfieRequiredOut(BaseModel):
    """/verify's answer for an admin with no selfie yet: no session until POST /selfie."""

    selfie_required: Literal[True] = True
    token: str
    expires_in_s: int


def admin_user(db: Session = Depends(get_auth_db), settings: Settings = Depends(get_settings),
               cl_admin: str | None = Cookie(default=None)) -> User:
    """The signed-in admin. Every admin route depends on this."""
    user = session_user(db, settings, cl_admin, "admin")
    if user is None:
        raise ProblemError(401, "Not signed in")
    # Checked on every request, so removing someone's admin role takes effect at once.
    if not user.is_admin:
        raise ProblemError(403, "Admins only", "You don't have access to the admin panel.")
    return user


def _may_be_admin(user: User, settings: Settings) -> bool:
    # ADMIN_EMAILS bootstraps the first admin; it's made an admin once the code is verified.
    return user.is_admin or user.email in settings.admin_email_set


@router.post("/login", response_model=OtpSentOut, status_code=202)
def login(body: LoginIn, request: Request, db: Session = Depends(get_auth_db),
          settings: Settings = Depends(get_settings),
          lang: str | None = Cookie(default=None)) -> OtpSentOut:
    """Step 1: checks the password and emails a sign-in code. No session yet."""
    user = db.scalar(select(User).where(User.email == body.email))
    ok = verify_password(body.password, user.password_hash if user else DUMMY_PASSWORD_HASH)
    if user is None or not ok:
        record_login(db, request, body.email, user, "bad_password" if user else "unknown_email",
                     scope="admin")
        db.commit()
        raise ProblemError(401, "Invalid credentials", "The email or password is incorrect.")
    if user.is_blocked:
        record_login(db, request, body.email, user, "blocked", scope="admin")
        db.commit()
        raise blocked_problem(user)
    if not _may_be_admin(user, settings):
        record_login(db, request, body.email, user, "not_admin", scope="admin")
        db.commit()
        raise NOT_ADMIN
    # Entering the password again while a fresh code is still on its way reuses that code,
    # rather than refusing with "please wait".
    row = db.scalar(select(OtpCode).where(OtpCode.email == user.email, OtpCode.purpose == PURPOSE))
    if row is not None and row.expires_at > utcnow():
        wait = settings.otp_resend_cooldown_s - (utcnow() - row.created_at).total_seconds()
        if wait > 0:
            return OtpSentOut(email=user.email, expires_in_s=int((row.expires_at - utcnow()).total_seconds()),
                              resend_after_s=int(wait) + 1)
    return issue_otp(db, settings, user.email, PURPOSE, lang or user.language)


@router.post("/resend", response_model=OtpSentOut, status_code=202)
def resend(body: EmailIn, db: Session = Depends(get_auth_db),
           settings: Settings = Depends(get_settings),
           lang: str | None = Cookie(default=None)) -> OtpSentOut:
    """A new code, only while a sign-in is in progress (the password was just entered)."""
    row = db.scalar(select(OtpCode).where(OtpCode.email == body.email, OtpCode.purpose == PURPOSE))
    if row is None or row.expires_at <= utcnow():
        raise ProblemError(400, "Sign in again",
                           "Your sign-in expired. Enter your password again.")
    return issue_otp(db, settings, body.email, PURPOSE, lang)


@router.post("/verify", response_model=UserOut | SelfieRequiredOut)
def verify(body: AdminVerifyIn, request: Request, response: Response, background: BackgroundTasks,
           db: Session = Depends(get_auth_db),
           settings: Settings = Depends(get_settings)) -> UserOut | SelfieRequiredOut:
    """Step 2: the emailed code verifies the account's email and opens the admin session,
    or, for an admin with no selfie on file, opens the selfie step instead (202)."""
    user = db.scalar(select(User).where(User.email == body.email))
    try:
        if user is None:
            raise ProblemError(400, "Invalid code", "That code is wrong or has expired.")
        consume_otp(db, settings, body.email, PURPOSE, body.code)
    except ProblemError:
        record_login(db, request, body.email, user, "bad_code", scope="admin")
        db.commit()
        raise
    # The role or a block may have changed while the code was on its way. The code is used
    # up either way (the commit saves its deletion).
    if user.is_blocked:
        db.commit()
        raise blocked_problem(user)
    if user.email in settings.admin_email_set:
        user.is_admin = True
    if not user.is_admin:
        db.commit()
        raise NOT_ADMIN
    if not user.is_verified:
        user.is_verified, user.verified_at = True, utcnow()
        log.info("admin account verified")
    if user.selfie_key is None:
        response.status_code = 202
        return _open_selfie_step(db, settings, user)
    record_login(db, request, body.email, user, "ok", scope="admin")
    open_session(db, settings, request, response, user, body.remember, "admin", ADMIN_COOKIE)
    queue_sign_in_alert(background, settings, request, user, "admin")
    log.info("admin signed in")
    return user_out(user)


def _open_selfie_step(db: Session, settings: Settings, user: User) -> SelfieRequiredOut:
    token = new_session_token()
    row = db.scalar(select(OtpCode).where(OtpCode.email == user.email, OtpCode.purpose == SELFIE))
    if row is None:
        row = OtpCode(email=user.email, purpose=SELFIE)
        db.add(row)
    now = utcnow()
    row.code_hash, row.attempts = hash_token(settings.auth_secret, token), 0
    row.created_at, row.expires_at = now, now + timedelta(minutes=settings.selfie_ttl_minutes)
    db.commit()
    return SelfieRequiredOut(token=token, expires_in_s=settings.selfie_ttl_minutes * 60)


def _store_selfie(settings: Settings, storage: LocalStorage | S3Storage, user_id: str,
                  image: UploadFile) -> str:
    """Checks the upload is a photo big enough to show a face, re-encodes it (dropping EXIF
    and anything else in the file) and stores it privately. Returns the storage key."""
    data = image.file.read(SELFIE_MAX_BYTES + 1)
    if len(data) > SELFIE_MAX_BYTES:
        raise ProblemError(413, "Image too large", "The selfie can be up to 5 MB.")
    try:
        with Image.open(io.BytesIO(data)) as src:
            if src.format not in SELFIE_FORMATS:
                raise ProblemError(415, "Unsupported image", "Use a JPEG, PNG or WebP image.")
            im = ImageOps.exif_transpose(src).convert("RGB")
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise ProblemError(422, "Unreadable image", "That file isn't a readable image.") from exc
    if min(im.size) < SELFIE_MIN_SIDE:
        raise ProblemError(422, "Selfie too small",
                           "The photo is too small. Take the selfie with your camera.")
    side = settings.selfie_max_side
    im.thumbnail((side, side), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    im.save(out, format="JPEG", quality=85, optimize=True)
    key = f"selfies/{user_id}/{secrets.token_hex(12)}.jpg"
    storage.put(key, out.getvalue(), "image/jpeg")
    return key


@router.post("/selfie", response_model=UserOut)
def selfie(request: Request, response: Response, background: BackgroundTasks,
           email: str = Form(..., max_length=254), token: str = Form(..., max_length=128),
           remember: bool = Form(False), image: UploadFile = File(...),
           db: Session = Depends(get_auth_db), settings: Settings = Depends(get_settings),
           storage: LocalStorage | S3Storage = Depends(get_storage)) -> UserOut:
    """Step 3, for an admin with no selfie on file: the selfie opens the admin session.
    A rejected photo leaves the token in place, so the admin can retake it."""
    email = email.strip().lower()
    row = db.scalar(select(OtpCode).where(OtpCode.email == email, OtpCode.purpose == SELFIE))
    user = db.scalar(select(User).where(User.email == email))
    if (row is None or user is None or row.expires_at <= utcnow()
            or not hmac.compare_digest(row.code_hash, hash_token(settings.auth_secret, token))):
        raise SELFIE_EXPIRED
    # As in /verify: the account may have been blocked or lost admin access meanwhile.
    if user.is_blocked or not user.is_admin:
        db.delete(row)
        db.commit()
        raise blocked_problem(user) if user.is_blocked else NOT_ADMIN
    old = user.selfie_key
    user.selfie_key, user.selfie_at = _store_selfie(settings, storage, user.id, image), utcnow()
    db.delete(row)
    record_login(db, request, email, user, "ok", scope="admin")
    open_session(db, settings, request, response, user, remember, "admin", ADMIN_COOKIE)
    if old:
        storage.delete(old)
    queue_sign_in_alert(background, settings, request, user, "admin")
    log.info("admin selfie stored; admin signed in")
    return user_out(user)


@router.post("/logout", status_code=204)
def logout(response: Response, db: Session = Depends(get_auth_db),
           settings: Settings = Depends(get_settings),
           cl_admin: str | None = Cookie(default=None)) -> None:
    if cl_admin:
        db.execute(delete(LoginSession).where(
            LoginSession.token_hash == hash_token(settings.auth_secret, cl_admin)))
        db.commit()
    response.delete_cookie(ADMIN_COOKIE, path="/")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(admin_user)) -> UserOut:
    return user_out(user)


@router.post("/change-password", status_code=204)
def change_password(body: ChangePasswordIn, user: User = Depends(admin_user),
                    db: Session = Depends(get_auth_db),
                    settings: Settings = Depends(get_settings),
                    cl_admin: str | None = Cookie(default=None)) -> None:
    """Same rules as /auth/change-password; this admin session stays signed in, every other
    session of the account (on either site) is signed out."""
    apply_password_change(db, settings, user, body, cl_admin)
