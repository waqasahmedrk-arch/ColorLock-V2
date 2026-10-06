from __future__ import annotations

import re
from datetime import UTC, date, datetime, timedelta
from typing import Literal, get_args

from pydantic import BaseModel, Field, field_validator

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _email(v: str) -> str:
    v = v.strip().lower()
    if len(v) > 254 or not _EMAIL_RE.match(v):
        raise ValueError("Enter a valid email address.")
    return v


def _password(v: str) -> str:
    if len(v) < 8:
        raise ValueError("Password must be at least 8 characters.")
    if not (re.search(r"[A-Za-z]", v) and re.search(r"\d", v)):
        raise ValueError("Password must contain at least one letter and one number.")
    return v


class EmailIn(BaseModel):
    email: str

    _v_email = field_validator("email")(_email)


class SignupIn(EmailIn):
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(max_length=128)

    _v_password = field_validator("password")(_password)

    @field_validator("name")
    @classmethod
    def _v_name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("Enter your name.")
        return v


class LoginIn(EmailIn):
    password: str = Field(max_length=128)
    remember: bool = False


class VerifyIn(EmailIn):
    code: str = Field(pattern=r"^\d{6}$")
    remember: bool = False


class ResendIn(EmailIn):
    purpose: Literal["signup", "reset"]


class ResetIn(EmailIn):
    code: str = Field(pattern=r"^\d{6}$")
    password: str = Field(max_length=128)

    _v_password = field_validator("password")(_password)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(max_length=128)

    _v_new_password = field_validator("new_password")(_password)


Gender = Literal["female", "male", "non_binary", "other", "prefer_not_to_say"]
GENDERS = get_args(Gender)
_PHONE_RE = re.compile(r"^\+?[0-9 ()\-.]+$")


class ProfileIn(BaseModel):
    """Only the fields sent are changed; send null (or "") to clear an optional one."""

    name: str = Field(min_length=1, max_length=100)
    gender: Gender | None = None
    date_of_birth: date | None = None
    phone: str | None = Field(default=None, max_length=32)
    job_title: str | None = Field(default=None, max_length=100)

    @field_validator("name")
    @classmethod
    def _v_name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("Enter your name.")
        return v

    @field_validator("gender", mode="before")
    @classmethod
    def _v_gender(cls, v: object) -> object:
        return None if v == "" else v

    @field_validator("date_of_birth", mode="before")
    @classmethod
    def _v_dob_blank(cls, v: object) -> object:
        return None if v == "" else v

    @field_validator("date_of_birth")
    @classmethod
    def _v_dob(cls, v: date | None) -> date | None:
        # Up to "tomorrow" in UTC: for users ahead of UTC, their today is already that date.
        latest = (datetime.now(UTC) + timedelta(days=1)).date()
        if v is not None and not date(1900, 1, 1) <= v <= latest:
            raise ValueError("Enter a date of birth between 1900 and today.")
        return v

    @field_validator("phone")
    @classmethod
    def _v_phone(cls, v: str | None) -> str | None:
        v = " ".join((v or "").split())
        if not v:
            return None
        # Digits with an optional leading + and common separators; 6-15 digits (E.164 max).
        digits = sum(ch.isdigit() for ch in v)
        if not _PHONE_RE.match(v) or not 6 <= digits <= 15:
            raise ValueError("Enter a valid phone number, e.g. +44 20 7946 0958.")
        return v

    @field_validator("job_title")
    @classmethod
    def _v_job(cls, v: str | None) -> str | None:
        v = " ".join((v or "").split())
        return v or None


class PreferencesIn(BaseModel):
    language: Literal["en", "zh"]


class DeleteAccountIn(BaseModel):
    password: str = Field(max_length=128)


class SessionOut(BaseModel):
    # A short prefix of the stored token hash: identifies the row, can't sign anyone in.
    id: str
    created_at: datetime
    last_seen_at: datetime | None
    expires_at: datetime
    user_agent: str | None
    ip: str | None
    current: bool


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    avatar_url: str | None = None
    language: str | None = None
    created_at: datetime
    gender: str | None = None
    date_of_birth: date | None = None
    phone: str | None = None
    job_title: str | None = None
    is_admin: bool = False


class OtpSentOut(BaseModel):
    email: str
    expires_in_s: int
    resend_after_s: int
