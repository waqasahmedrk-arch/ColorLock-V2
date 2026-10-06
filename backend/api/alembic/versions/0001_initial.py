"""initial schema (specs.md §8)

Revision ID: 0001
Revises:
Create Date: 2026-09-23
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

JsonType = sa.JSON().with_variant(JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "study_images",
        sa.Column("image_id", sa.String(128), primary_key=True),
        sa.Column("model", sa.String(16), nullable=False),
        sa.Column("target_id", sa.String(32), nullable=False),
        sa.Column("style", sa.String(32), nullable=False),
        sa.Column("slot", sa.Integer, nullable=False),
        sa.Column("seed_used", sa.Integer, nullable=False),
        sa.Column("prompt_hash", sa.String(32), nullable=False),
        sa.Column("generated_at", sa.String(64)),
        sa.Column("file_key", sa.String(256), nullable=False),
        sa.Column("delta_e00", sa.Float, nullable=False),
        sa.Column("flat_p95_de", sa.Float, nullable=False),
        sa.Column("qc_pass", sa.Boolean, nullable=False),
        sa.Column("chroma_sample", sa.Float, nullable=False),
        sa.Column("chroma_reference", sa.Float, nullable=False),
        sa.Column("chroma_delta", sa.Float, nullable=False),
        sa.Column("consistency_de00", sa.Float),
        sa.Column("kept_pct", sa.Float, nullable=False),
        sa.Column("sample_L", sa.Float, nullable=False),
        sa.Column("sample_a", sa.Float, nullable=False),
        sa.Column("sample_b", sa.Float, nullable=False),
    )
    for col in ("model", "target_id", "style", "qc_pass"):
        op.create_index(f"ix_study_images_{col}", "study_images", [col])

    op.create_table(
        "study_groups",
        sa.Column("model", sa.String(16), primary_key=True),
        sa.Column("target_id", sa.String(32), primary_key=True),
        sa.Column("style", sa.String(32), primary_key=True),
        sa.Column("n", sa.Integer, nullable=False),
        sa.Column("n_qc_pass", sa.Integer, nullable=False),
        sa.Column("accuracy_mean", sa.Float),
        sa.Column("accuracy_sd", sa.Float),
        sa.Column("accuracy_yield_pct", sa.Float),
        sa.Column("consistency_mean", sa.Float),
        sa.Column("consistency_sd", sa.Float),
        sa.Column("consistency_yield_pct", sa.Float),
        sa.Column("chroma_dev_target_mean", sa.Float),
        sa.Column("flat_p95_de_median", sa.Float),
    )

    op.create_table(
        "study_hypotheses",
        sa.Column("id", sa.String(8), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("test", sa.String(64), nullable=False),
        sa.Column("statistic", sa.Float),
        sa.Column("p_value", sa.Float),
        sa.Column("direction", sa.String(128), nullable=False),
        sa.Column("notes", sa.Text, nullable=False),
        sa.Column("extra", JsonType, nullable=False),
    )

    op.create_table(
        "jobs",
        sa.Column("job_id", sa.String(36), primary_key=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("request", JsonType, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("timings", JsonType),
        sa.Column("error", sa.Text),
        sa.Column("client_hash", sa.String(64)),
        sa.CheckConstraint(
            "status IN ('queued','loading_model','generating','scoring','succeeded','failed')",
            name="ck_jobs_status",
        ),
    )
    op.create_index("ix_jobs_status", "jobs", ["status"])
    op.create_index("ix_jobs_client_hash", "jobs", ["client_hash"])

    op.create_table(
        "generations",
        sa.Column("job_id", sa.String(36), sa.ForeignKey("jobs.job_id"), primary_key=True),
        sa.Column("model_id", sa.String(128), nullable=False),
        sa.Column("revision", sa.String(64), nullable=False),
        sa.Column("precision", sa.String(32), nullable=False),
        sa.Column("seed", sa.Integer, nullable=False),
        sa.Column("prompt", sa.Text, nullable=False),
        sa.Column("negative_prompt", sa.Text),
        sa.Column("steps", sa.Integer, nullable=False),
        sa.Column("guidance", sa.Float, nullable=False),
        sa.Column("width", sa.Integer, nullable=False),
        sa.Column("height", sa.Integer, nullable=False),
        sa.Column("off_study", sa.Boolean, nullable=False),
        sa.Column("file_key", sa.String(256), nullable=False),
    )

    op.create_table(
        "scores",
        sa.Column("score_id", sa.String(36), primary_key=True),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("jobs.job_id")),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("result", JsonType, nullable=False),
        sa.Column("package_version", sa.String(32), nullable=False),
        sa.Column("qc_threshold", sa.Float, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("source IN ('upload','generation')", name="ck_scores_source"),
    )


def downgrade() -> None:
    for table in ("scores", "generations", "jobs", "study_hypotheses", "study_groups",
                  "study_images"):
        op.drop_table(table)
