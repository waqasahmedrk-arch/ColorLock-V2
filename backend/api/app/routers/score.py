from __future__ import annotations

import io
import re

from colourlock import __version__ as colourlock_version
from colourlock.metrics import score_image
from colourlock.targets import TARGETS, Target, target_from_hex
from fastapi import APIRouter, Depends, File, Form, UploadFile
from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..db.auth import ScoreRecord, User, get_auth_db
from ..db.models import Score
from ..db.session import get_db
from ..errors import ProblemError
from ..schemas.score import (
    BatchError,
    BatchItem,
    BatchResponse,
    ScoreResponse,
    ScoreResultOut,
    TargetOut,
)
from ..services.colour import lab_to_hex
from ..services.explain import explain as explain_score
from ..services.notify import MILESTONES, notify
from ..services.provenance import qc_config
from ..settings import get_settings
from .auth import optional_user

router = APIRouter(tags=["score"])

HEX_RE = re.compile(r"^#?[0-9A-Fa-f]{6}$")
ALLOWED_FORMATS = {"PNG", "JPEG"}


def _resolve_target(target_id: str | None, target_hex: str | None) -> Target:
    if bool(target_id) == bool(target_hex):
        raise ProblemError(422, "Invalid target", "Give exactly one of target_id or target_hex.")
    if target_id:
        if target_id not in TARGETS:
            raise ProblemError(422, "Unknown target", f"target_id must be one of {sorted(TARGETS)}.")
        return TARGETS[target_id]
    assert target_hex is not None
    if not HEX_RE.match(target_hex):
        raise ProblemError(422, "Invalid hex", "target_hex must look like #RRGGBB.")
    return target_from_hex(target_hex)


async def _read_limited(upload: UploadFile, limit: int) -> bytes:
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise ProblemError(413, "Upload too large", f"Maximum upload size is {limit} bytes.")
    if not data:
        raise ProblemError(422, "Empty upload", "The image file is empty.")
    return data


def _check_image_header(data: bytes, max_long_side: int) -> None:
    try:
        with Image.open(io.BytesIO(data)) as img:  # reads the header only
            fmt, (w, h) = img.format, img.size
    except (UnidentifiedImageError, OSError) as exc:
        raise ProblemError(415, "Unsupported image", "Upload a PNG or JPEG image.") from exc
    if fmt not in ALLOWED_FORMATS:
        raise ProblemError(415, "Unsupported image", f"Got {fmt}; upload a PNG or JPEG image.")
    if max(w, h) > max_long_side:
        raise ProblemError(413, "Image too large",
                           f"Long side is {max(w, h)} px; the maximum is {max_long_side} px.")


@router.post("/score", response_model=ScoreResponse, response_model_by_alias=True)
async def score(
    image: UploadFile = File(...),
    target_id: str | None = Form(None),
    target_hex: str | None = Form(None),
    name: str | None = Form(None),
    explain: bool = Form(False),
    db: Session = Depends(get_db),
    auth_db: Session = Depends(get_auth_db),
    user: User | None = Depends(optional_user),
) -> ScoreResponse:
    settings = get_settings()
    target = _resolve_target(target_id, target_hex)
    # A signed-in score is saved to history under a name the user gives it; check the name
    # before spending time on the image.
    label = None
    if user is not None:
        label = clean_name(name)
        ensure_name_free(auth_db, user, label)
    data = await _read_limited(image, settings.max_upload_bytes)
    _check_image_header(data, settings.max_upload_long_side)

    cfg = qc_config()
    try:
        scored = await run_in_threadpool(score_image, data, target, cfg)
    except Image.DecompressionBombError as exc:
        raise ProblemError(413, "Image too large", "Image exceeds the pixel limit.") from exc
    result = ScoreResultOut.from_package(scored)

    row = Score(source="upload", result=result.model_dump(mode="json", by_alias=True),
                package_version=result.package_version, qc_threshold=cfg.flat_p95_de_max)
    db.add(row)
    db.commit()
    response = ScoreResponse(**result.model_dump(), score_id=row.score_id,
                             sample_hex=lab_to_hex(result.sample_lab), name=label)
    if explain:
        # Display-only diagnostics; never stored with the score.
        response.explain = await run_in_threadpool(explain_score, data, scored, cfg)
    if user is not None and label is not None:
        _save_to_history(auth_db, user, response, image.filename, label)
    return response


@router.post("/score/batch", response_model=BatchResponse, response_model_by_alias=True)
async def score_batch(
    images: list[UploadFile] = File(...),
    target_id: str | None = Form(None),
    target_hex: str | None = Form(None),
    db: Session = Depends(get_db),
) -> BatchResponse:
    """Score several images against one target. Each image is validated and scored on its
    own, so one bad file is reported in its row instead of failing the whole batch. Scores are
    stored like single uploads; they are not added to the user's named history."""
    settings = get_settings()
    target = _resolve_target(target_id, target_hex)
    if len(images) > settings.max_batch_files:
        raise ProblemError(413, "Too many images",
                           f"Send at most {settings.max_batch_files} images per batch.")
    cfg = qc_config()
    items: list[BatchItem] = []
    total = 0
    for index, upload in enumerate(images):
        filename = _clean_filename(upload.filename)
        try:
            data = await _read_limited(upload, settings.max_upload_bytes)
            total += len(data)
            if total > settings.max_batch_bytes:
                raise ProblemError(413, "Batch too large",
                                   f"A batch may total at most {settings.max_batch_bytes} bytes.")
            _check_image_header(data, settings.max_upload_long_side)
            try:
                scored = await run_in_threadpool(score_image, data, target, cfg)
            except Image.DecompressionBombError as exc:
                raise ProblemError(413, "Image too large", "Image exceeds the pixel limit.") from exc
        except ProblemError as exc:
            items.append(BatchItem(index=index, filename=filename,
                                   error=BatchError(title=exc.title, detail=exc.detail)))
            continue
        result = ScoreResultOut.from_package(scored)
        row = Score(source="upload", result=result.model_dump(mode="json", by_alias=True),
                    package_version=result.package_version, qc_threshold=cfg.flat_p95_de_max)
        db.add(row)
        db.flush()  # assigns score_id
        items.append(BatchItem(index=index, filename=filename, result=ScoreResponse(
            **result.model_dump(), score_id=row.score_id,
            sample_hex=lab_to_hex(result.sample_lab))))
    db.commit()
    return BatchResponse(
        target=TargetOut(id=target.id, name=target.name, hex=f"#{target.hex}",
                         lab=tuple(target.lab.tolist())),
        qc_threshold=cfg.flat_p95_de_max, package_version=colourlock_version, items=items)


NAME_MAX = 100


def clean_name(raw: str | None) -> str:
    """The score name as stored: whitespace collapsed, 1-100 printable characters."""
    name = " ".join("".join(ch for ch in (raw or "") if ch.isprintable()).split())
    if not name:
        raise ProblemError(422, "Name required", "Give this score a name.")
    if len(name) > NAME_MAX:
        raise ProblemError(422, "Name too long", f"Use at most {NAME_MAX} characters.")
    return name


def name_taken(db: Session, user: User, name: str) -> bool:
    # Case-insensitive, so "Sky" and "sky" can't both exist (MySQL's collation agrees).
    return db.scalar(select(ScoreRecord.id).where(
        ScoreRecord.user_id == user.id,
        func.lower(ScoreRecord.name) == name.lower()).limit(1)) is not None


def ensure_name_free(db: Session, user: User, name: str) -> None:
    if name_taken(db, user, name):
        raise ProblemError(409, "Name already used",
                           f"You already have a score named \u201c{name}\u201d. Choose another name.")


def _clean_filename(name: str | None) -> str | None:
    """Display-only: the base name, printable characters, at most 255 of them."""
    if not name:
        return None
    base = name.replace("\\", "/").rsplit("/", 1)[-1]
    base = "".join(ch for ch in base if ch.isprintable()).strip()
    return base[:255] or None


def _save_to_history(db: Session, user: User, r: ScoreResponse, filename: str | None,
                     label: str) -> None:
    before, best = db.execute(select(func.count(ScoreRecord.id), func.min(ScoreRecord.delta_e00))
                              .where(ScoreRecord.user_id == user.id)).one()
    name = _clean_filename(filename)
    db.add(ScoreRecord(
        user_id=user.id, score_id=r.score_id, filename=name, name=label,
        target_id=r.target.id if r.target.id in TARGETS else None,
        target_name=r.target.name, target_hex=r.target.hex, sample_hex=r.sample_hex,
        delta_e00=r.delta_e00, qc_pass=r.qc.passed,
        result=r.model_dump(mode="json", by_alias=True, exclude={"explain"}),
    ))
    # Same "best" as the History page's stat: the lowest ΔE00 across all saved scores.
    if best is not None and r.delta_e00 < best:
        notify(db, user, "personal_best", {"delta_e00": r.delta_e00, "previous": float(best),
                                           "name": label, "filename": name,
                                           "target_hex": r.target.hex},
               link="/history")
    if before + 1 in MILESTONES:
        notify(db, user, "milestone", {"count": before + 1}, link="/history")
    try:
        db.commit()
    except IntegrityError as exc:
        # Two requests raced for the same name; the unique index kept only one.
        db.rollback()
        raise ProblemError(409, "Name already used",
                           f"You already have a score named \u201c{label}\u201d. "
                           "Choose another name.") from exc
