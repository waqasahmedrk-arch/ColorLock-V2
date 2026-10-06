from __future__ import annotations

import json
import logging
import re

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

from . import errors
from .routers import (
    account,
    admin,
    admin_auth,
    auth,
    chat,
    files,
    history,
    meta,
    notifications,
    profile,
    score,
    study,
)
from .settings import get_settings

API_PREFIX = "/api/v1"
_HF_TOKEN_RE = re.compile(r"hf_[A-Za-z0-9]+")

# Decompression-bomb guard for every PIL open in this process (NFR-5).
Image.MAX_IMAGE_PIXELS = 2048 * 2048 * 4


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": self.formatTime(record), "level": record.levelname,
            "logger": record.name, "msg": record.getMessage(),
        }
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return _HF_TOKEN_RE.sub("hf_[REDACTED]", json.dumps(entry))


def _configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger("colourlock")
    root.handlers[:] = [handler]
    root.setLevel(logging.INFO)


def create_app() -> FastAPI:
    _configure_logging()
    settings = get_settings()
    app = FastAPI(title="ColorLock API", version="0.1.0",
                  openapi_url=f"{API_PREFIX}/openapi.json", docs_url=f"{API_PREFIX}/docs")
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["*"],
                       # Lets the browser read the file name of a history export.
                       expose_headers=["Content-Disposition"],
                       # The auth session cookie rides on cross-origin (port 3000 -> 8000) calls.
                       allow_credentials=True)
    errors.install(app)
    for router in (meta.router, score.router, study.router, files.router, auth.router,
                   profile.router, history.router, account.router, notifications.router,
                   chat.router, admin_auth.router, profile.admin_router, admin.router):
        app.include_router(router, prefix=API_PREFIX)
    return app


app = create_app()
