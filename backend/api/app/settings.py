from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# Dev defaults live under the repo's gitignored data/ dir, whatever the cwd.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_DEV_DATA = _REPO_ROOT / "data"


class Settings(BaseSettings):
    # Always the repo-root .env (same file docker-compose uses), whatever the cwd.
    # Empty values count as unset, so a verbatim copy of .env.example keeps the defaults.
    model_config = SettingsConfigDict(env_file=_REPO_ROOT / ".env", env_ignore_empty=True,
                                      extra="ignore")

    database_url: str = f"sqlite:///{(_DEV_DATA / 'dev' / 'colourlock_dev.db').as_posix()}"

    storage_backend: Literal["local", "s3"] = "local"
    local_storage_root: str = str(_DEV_DATA / "storage")
    s3_bucket: str = "colourlock"
    s3_endpoint_url: str | None = None
    s3_region: str | None = None
    # Browser-reachable endpoint used only to sign URLs; defaults to s3_endpoint_url.
    s3_public_endpoint_url: str | None = None
    signed_url_ttl_s: int = 3600
    # Signs local-storage file URLs. Must be set to a real secret outside dev.
    url_signing_secret: str = "dev-only-insecure-secret"
    public_base_url: str = "http://localhost:8000"

    # The user site and the admin site (frontend/lib/appMode.ts) both call the API.
    frontend_origins: str = "http://localhost:3000,http://localhost:3001"
    # Where links in emails point (sign-in alerts): the user site and the admin site.
    site_url: str = "http://localhost:3000"
    admin_url: str = "http://localhost:3001"
    git_commit: str = "unknown"

    max_upload_bytes: int = 10 * 1024 * 1024
    max_upload_long_side: int = 2048
    # /score/batch: files per request and their combined size.
    max_batch_files: int = 20
    max_batch_bytes: int = 50 * 1024 * 1024

    # "fallback" never touches the network; "clip" loads the pinned SDXL
    # tokenizer (needs the `transformers` extra and HF access on first use).
    prompt_tokenizer: Literal["clip", "fallback"] = "fallback"

    # User accounts live in their own database (MySQL in dev: XAMPP MariaDB), apart from
    # the study data. Unset falls back to database_url so tests need no MySQL server.
    auth_database_url: str | None = None
    # Peppers OTP and session-token hashes. Must be set to a real secret outside dev.
    auth_secret: str = "dev-only-insecure-auth-secret"
    session_ttl_hours: int = 24
    session_remember_days: int = 30
    # False only for plain-http localhost; browsers drop Secure cookies over http.
    session_cookie_secure: bool = False
    otp_ttl_minutes: int = 10
    otp_max_attempts: int = 5
    otp_resend_cooldown_s: int = 60

    # "smtp" sends real mail (Gmail: smtp.gmail.com:587 with an App Password).
    # "console" logs the code instead; opt-in only (tests), since nothing reaches the user.
    email_backend: Literal["smtp", "console"] = "smtp"
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None

    # Comma-separated emails that get admin access when they sign in. Further admins can be
    # granted from the admin panel.
    admin_emails: str = ""
    # Support chat: longest message, and how many a user may send per minute.
    chat_max_chars: int = 2000
    chat_per_minute: int = 12
    # Photos in the chat: largest upload, and the longest side they're stored at.
    chat_image_max_bytes: int = 8 * 1024 * 1024
    chat_image_max_side: int = 1600
    # Admin selfie check (first admin sign-in): how long the selfie step stays open after the
    # emailed code, and the longest side the selfie is stored at.
    selfie_ttl_minutes: int = 10
    selfie_max_side: int = 640

    @property
    def admin_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.admin_emails.split(",") if e.strip()}

    @property
    def auth_db_url(self) -> str:
        return self.auth_database_url or self.database_url

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.frontend_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
