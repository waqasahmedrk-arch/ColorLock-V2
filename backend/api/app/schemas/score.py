from __future__ import annotations

from dataclasses import asdict

from colourlock.metrics import ScoreResult as PackageScoreResult
from pydantic import BaseModel, ConfigDict, Field

from ..services.explain import Explain


class TargetOut(BaseModel):
    id: str
    name: str
    hex: str
    lab: tuple[float, float, float]


class QCOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    passed: bool = Field(serialization_alias="pass", validation_alias="pass")
    threshold: float


class ChromaOut(BaseModel):
    sample: float
    reference: float
    delta: float


class ScoreResultOut(BaseModel):
    """specs.md §6 ScoreResult. Mirrors colourlock.metrics.ScoreResult."""

    target: TargetOut
    sample_lab: tuple[float, float, float]
    delta_e00: float
    flat_p95_de: float
    qc: QCOut
    chroma: ChromaOut
    kept_pct: float
    warnings: list[str]
    package_version: str

    @classmethod
    def from_package(cls, result: PackageScoreResult) -> ScoreResultOut:
        data = asdict(result)
        data["target"]["hex"] = f"#{data['target']['hex']}"
        data["qc"] = QCOut(passed=result.qc.passed, threshold=result.qc.threshold)
        return cls.model_validate(data)


class ScoreResponse(ScoreResultOut):
    score_id: str
    sample_hex: str  # display only
    name: str | None = None  # the user's label, when the score was saved to their history
    explain: Explain | None = None  # only when the request asked for it; display only


class BatchError(BaseModel):
    title: str
    detail: str | None = None


class BatchItem(BaseModel):
    index: int  # position in the request, so the client can match its own file list
    filename: str | None
    result: ScoreResponse | None = None
    error: BatchError | None = None


class BatchResponse(BaseModel):
    """One target, many images. Each image succeeds or fails on its own."""

    target: TargetOut
    qc_threshold: float
    package_version: str
    items: list[BatchItem]
