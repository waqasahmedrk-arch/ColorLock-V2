"""Read-only views of the frozen study dataset (FR-1). Nothing here computes
study-level statistics per request (hard rule 9): it serves what
scripts/import_study.py stored."""

from __future__ import annotations

from colourlock.prompts import SDXL_NEGATIVE_PROMPT, build_prompt
from colourlock.targets import TARGETS
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db.models import StudyGroup, StudyHypothesis, StudyImage
from ..db.session import get_db
from ..deps import get_storage
from ..errors import ProblemError
from ..schemas.study import (
    Disclosure,
    HypothesisOut,
    StudyGroupOut,
    StudyImageDetail,
    StudyImageOut,
    StudyImagePage,
)
from ..services.colour import lab_to_hex
from ..services.disclosures import DISCLOSURES
from ..services.naming import LOW_N_THRESHOLD, MODEL_KEYS, resolve_style
from ..services.provenance import model_config
from ..services.storage import LocalStorage, S3Storage

router = APIRouter(prefix="/study", tags=["study"])


def _check_model(model: str | None) -> None:
    if model is not None and model not in MODEL_KEYS.values():
        raise ProblemError(422, "Unknown model", f"model must be one of {sorted(MODEL_KEYS.values())}.")


def _check_target(target_id: str | None) -> None:
    if target_id is not None and target_id not in TARGETS:
        raise ProblemError(422, "Unknown target", f"target_id must be one of {sorted(TARGETS)}.")


def _style_or_422(style: str | None) -> str | None:
    if style is None:
        return None
    resolved = resolve_style(style)
    if resolved is None:
        raise ProblemError(422, "Unknown style", "style must be a style id or its letter A-E.")
    return resolved


@router.get("/summary", response_model=list[StudyGroupOut])
def summary(model: str | None = None, db: Session = Depends(get_db)) -> list[StudyGroupOut]:
    _check_model(model)
    stmt = select(StudyGroup).order_by(StudyGroup.model, StudyGroup.target_id, StudyGroup.style)
    if model:
        stmt = stmt.where(StudyGroup.model == model)
    return [
        StudyGroupOut(
            model=g.model, target_id=g.target_id, style=g.style, n=g.n, n_qc_pass=g.n_qc_pass,
            qc_pass_rate=g.n_qc_pass / g.n if g.n else 0.0,
            low_n=g.n_qc_pass < LOW_N_THRESHOLD,
            accuracy_mean=g.accuracy_mean, accuracy_sd=g.accuracy_sd,
            accuracy_yield_pct=g.accuracy_yield_pct, consistency_mean=g.consistency_mean,
            consistency_sd=g.consistency_sd, consistency_yield_pct=g.consistency_yield_pct,
            chroma_dev_target_mean=g.chroma_dev_target_mean,
            flat_p95_de_median=g.flat_p95_de_median,
        )
        for g in db.scalars(stmt)
    ]


@router.get("/hypotheses", response_model=list[HypothesisOut])
def hypotheses(db: Session = Depends(get_db)) -> list[HypothesisOut]:
    rows = db.scalars(select(StudyHypothesis).order_by(StudyHypothesis.id))
    return [HypothesisOut.model_validate(r, from_attributes=True) for r in rows]


@router.get("/disclosures", response_model=list[Disclosure])
def disclosures() -> list[Disclosure]:
    return [Disclosure.model_validate(d) for d in DISCLOSURES]


def _image_out(img: StudyImage, storage: LocalStorage | S3Storage) -> dict:
    return {
        "image_id": img.image_id, "model": img.model, "target_id": img.target_id,
        "style": img.style, "slot": img.slot, "seed_used": img.seed_used,
        "delta_e00": img.delta_e00, "flat_p95_de": img.flat_p95_de, "qc_pass": img.qc_pass,
        "chroma_sample": img.chroma_sample, "chroma_reference": img.chroma_reference,
        "chroma_delta": img.chroma_delta, "consistency_de00": img.consistency_de00,
        "kept_pct": img.kept_pct, "sample_lab": (img.sample_L, img.sample_a, img.sample_b),
        "sample_hex": lab_to_hex((img.sample_L, img.sample_a, img.sample_b)),
        "image_url": storage.signed_url(img.file_key),
    }


@router.get("/images", response_model=StudyImagePage)
def images(
    model: str | None = None,
    target_id: str | None = None,
    style: str | None = None,
    qc_pass: bool | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(48, ge=1, le=200),
    db: Session = Depends(get_db),
    storage: LocalStorage | S3Storage = Depends(get_storage),
) -> StudyImagePage:
    _check_model(model)
    _check_target(target_id)
    resolved_style = _style_or_422(style)

    filters = []
    if model:
        filters.append(StudyImage.model == model)
    if target_id:
        filters.append(StudyImage.target_id == target_id)
    if resolved_style:
        filters.append(StudyImage.style == resolved_style)
    if qc_pass is not None:
        filters.append(StudyImage.qc_pass == qc_pass)

    total = db.scalar(select(func.count()).select_from(StudyImage).where(*filters)) or 0
    stmt = (
        select(StudyImage).where(*filters)
        .order_by(StudyImage.model, StudyImage.target_id, StudyImage.style, StudyImage.slot)
        .offset((page - 1) * page_size).limit(page_size)
    )
    items = [StudyImageOut(**_image_out(i, storage)) for i in db.scalars(stmt)]
    return StudyImagePage(items=items, total=total, page=page, page_size=page_size)


@router.get("/images/{image_id}", response_model=StudyImageDetail)
def image_detail(
    image_id: str,
    db: Session = Depends(get_db),
    storage: LocalStorage | S3Storage = Depends(get_storage),
) -> StudyImageDetail:
    img = db.get(StudyImage, image_id)
    if img is None:
        raise ProblemError(404, "Image not found", f"No study image with id {image_id!r}.")
    cfg = model_config()[img.model]
    return StudyImageDetail(
        **_image_out(img, storage),
        prompt_hash=img.prompt_hash,
        generated_at=img.generated_at,
        prompt=build_prompt(TARGETS[img.target_id], img.style),
        negative_prompt=SDXL_NEGATIVE_PROMPT if img.model == "sdxl" else None,
        generation={
            "model_id": cfg["repo_id"], "revision": cfg["revision"],
            "precision": cfg["precision"], "steps": cfg["steps"], "guidance": cfg["guidance"],
            "width": cfg["resolution"], "height": cfg["resolution"], "seed": img.seed_used,
            "off_study": False,
        },
    )
