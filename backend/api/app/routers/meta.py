from __future__ import annotations

import math
import os
from collections.abc import Callable

from colourlock.config import load_qc_config
from colourlock.prompts import STYLES, build_prompt, validate_prompt
from colourlock.targets import TARGETS
from fastapi import APIRouter
from sqlalchemy import text

from ..db.session import make_engine
from ..schemas.meta import Health, PromptStyle, PromptValidateIn, PromptValidateOut, Target
from ..services.naming import STYLE_CODES, STYLE_DESCRIPTIONS
from ..services.provenance import model_config, provenance
from ..settings import get_settings

router = APIRouter(tags=["meta"])

EXAMPLE_TARGET = "royal_blue"


@router.get("/health", response_model=Health, response_model_exclude_none=True)
def health(deep: bool = False) -> Health:
    """`deep=true` also tries the databases and the config files, for diagnosing a deployment.
    It reports only "ok", "not configured" or the error's type, never URLs or messages."""
    if not deep:
        return Health(status="ok")
    settings = get_settings()
    checks = {
        "database": _check_db(settings.database_url),
        "auth_database": _check_db(settings.auth_db_url),
        "config": _check(lambda: (load_qc_config(), model_config())),
    }
    return Health(status="ok" if set(checks.values()) == {"ok"} else "degraded", checks=checks)


def _check(fn: Callable[[], object]) -> str:
    try:
        fn()
        return "ok"
    except Exception as exc:  # noqa: BLE001 - reported by type only
        return f"error: {type(exc).__name__}"


def _check_db(url: str) -> str:
    # Serverless hosts (Vercel sets VERCEL=1) have a read-only file system: SQLite can't work.
    if url.startswith("sqlite") and os.environ.get("VERCEL"):
        return "not configured (set DATABASE_URL / AUTH_DATABASE_URL to a Postgres URL)"

    def ping() -> None:
        with make_engine(url).connect() as conn:
            conn.execute(text("SELECT 1"))
    return _check(ping)


@router.get("/provenance")
def get_provenance() -> dict:
    return provenance()


@router.get("/targets", response_model=list[Target])
def targets() -> list[Target]:
    return [
        Target(id=t.id, name=t.name, hex=f"#{t.hex}", lab=tuple(t.lab.tolist()),
               chroma=math.hypot(t.lab[1], t.lab[2]), anchor_object=t.anchor_object)
        for t in TARGETS.values()
    ]


@router.get("/prompt-styles", response_model=list[PromptStyle])
def prompt_styles() -> list[PromptStyle]:
    target = TARGETS[EXAMPLE_TARGET]
    return [
        PromptStyle(id=s, code=STYLE_CODES[s], description=STYLE_DESCRIPTIONS[s],
                    example_target_id=EXAMPLE_TARGET, example_prompt=build_prompt(target, s))
        for s in STYLES
    ]


@router.post("/prompts/validate", response_model=PromptValidateOut)
def prompts_validate(body: PromptValidateIn) -> PromptValidateOut:
    kwargs: dict = {}
    if get_settings().prompt_tokenizer == "clip":
        sdxl = model_config()["sdxl"]
        kwargs = {"repo_id": sdxl["repo_id"], "revision": sdxl["revision"]}
    check = validate_prompt(body.text, **kwargs)
    return PromptValidateOut(tokens=check.tokens, fits=check.fits, limit=check.limit,
                             source=check.source)
