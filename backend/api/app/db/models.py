"""ORM models for specs.md §8. `study_*` tables are written only by
scripts/import_study.py and are read-only to the app."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

JsonType = JSON().with_variant(JSONB(), "postgresql")


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class StudyImage(Base):
    __tablename__ = "study_images"

    image_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    model: Mapped[str] = mapped_column(String(16), index=True)
    target_id: Mapped[str] = mapped_column(String(32), index=True)
    style: Mapped[str] = mapped_column(String(32), index=True)
    slot: Mapped[int] = mapped_column(Integer)
    seed_used: Mapped[int] = mapped_column(Integer)
    prompt_hash: Mapped[str] = mapped_column(String(32))
    generated_at: Mapped[str | None] = mapped_column(String(64))
    file_key: Mapped[str] = mapped_column(String(256))
    delta_e00: Mapped[float] = mapped_column(Float)
    flat_p95_de: Mapped[float] = mapped_column(Float)
    qc_pass: Mapped[bool] = mapped_column(Boolean, index=True)
    chroma_sample: Mapped[float] = mapped_column(Float)
    chroma_reference: Mapped[float] = mapped_column(Float)
    chroma_delta: Mapped[float] = mapped_column(Float)
    # Only defined for QC-passed images: the group centroid is built from them.
    consistency_de00: Mapped[float | None] = mapped_column(Float)
    kept_pct: Mapped[float] = mapped_column(Float)
    sample_L: Mapped[float] = mapped_column(Float)
    sample_a: Mapped[float] = mapped_column(Float)
    sample_b: Mapped[float] = mapped_column(Float)


class StudyGroup(Base):
    __tablename__ = "study_groups"

    model: Mapped[str] = mapped_column(String(16), primary_key=True)
    target_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    style: Mapped[str] = mapped_column(String(32), primary_key=True)
    n: Mapped[int] = mapped_column(Integer)
    n_qc_pass: Mapped[int] = mapped_column(Integer)
    # All metric columns are NULL when n_qc_pass == 0.
    accuracy_mean: Mapped[float | None] = mapped_column(Float)
    accuracy_sd: Mapped[float | None] = mapped_column(Float)
    accuracy_yield_pct: Mapped[float | None] = mapped_column(Float)
    consistency_mean: Mapped[float | None] = mapped_column(Float)
    consistency_sd: Mapped[float | None] = mapped_column(Float)
    consistency_yield_pct: Mapped[float | None] = mapped_column(Float)
    chroma_dev_target_mean: Mapped[float | None] = mapped_column(Float)
    flat_p95_de_median: Mapped[float | None] = mapped_column(Float)


class StudyHypothesis(Base):
    __tablename__ = "study_hypotheses"

    id: Mapped[str] = mapped_column(String(8), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    test: Mapped[str] = mapped_column(String(64))
    statistic: Mapped[float | None] = mapped_column(Float)
    p_value: Mapped[float | None] = mapped_column(Float)
    direction: Mapped[str] = mapped_column(String(128))
    notes: Mapped[str] = mapped_column(Text)
    extra: Mapped[dict] = mapped_column(JsonType, default=dict)


class Job(Base):
    __tablename__ = "jobs"

    job_id: Mapped[str] = mapped_column(String(36), primary_key=True,
                                        default=lambda: str(uuid.uuid4()))
    status: Mapped[str] = mapped_column(String(16), index=True)
    request: Mapped[dict] = mapped_column(JsonType)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    timings: Mapped[dict | None] = mapped_column(JsonType)
    error: Mapped[str | None] = mapped_column(Text)
    client_hash: Mapped[str | None] = mapped_column(String(64), index=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('queued','loading_model','generating','scoring','succeeded','failed')",
            name="ck_jobs_status",
        ),
    )


class Generation(Base):
    __tablename__ = "generations"

    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.job_id"), primary_key=True)
    model_id: Mapped[str] = mapped_column(String(128))
    revision: Mapped[str] = mapped_column(String(64))
    precision: Mapped[str] = mapped_column(String(32))
    seed: Mapped[int] = mapped_column(Integer)
    prompt: Mapped[str] = mapped_column(Text)
    negative_prompt: Mapped[str | None] = mapped_column(Text)
    steps: Mapped[int] = mapped_column(Integer)
    guidance: Mapped[float] = mapped_column(Float)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    off_study: Mapped[bool] = mapped_column(Boolean, default=False)
    file_key: Mapped[str] = mapped_column(String(256))


class Score(Base):
    __tablename__ = "scores"

    score_id: Mapped[str] = mapped_column(String(36), primary_key=True,
                                          default=lambda: str(uuid.uuid4()))
    job_id: Mapped[str | None] = mapped_column(ForeignKey("jobs.job_id"))
    source: Mapped[str] = mapped_column(String(16))
    result: Mapped[dict] = mapped_column(JsonType)
    package_version: Mapped[str] = mapped_column(String(32))
    qc_threshold: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    __table_args__ = (
        CheckConstraint("source IN ('upload','generation')", name="ck_scores_source"),
    )
