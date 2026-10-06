from __future__ import annotations

from pydantic import BaseModel


class StudyGroupOut(BaseModel):
    model: str
    target_id: str
    style: str
    n: int
    n_qc_pass: int
    qc_pass_rate: float
    low_n: bool
    accuracy_mean: float | None
    accuracy_sd: float | None
    accuracy_yield_pct: float | None
    consistency_mean: float | None
    consistency_sd: float | None
    consistency_yield_pct: float | None
    chroma_dev_target_mean: float | None
    flat_p95_de_median: float | None


class HypothesisOut(BaseModel):
    id: str
    name: str
    test: str
    statistic: float | None
    p_value: float | None
    direction: str
    notes: str
    extra: dict


class StudyImageOut(BaseModel):
    image_id: str
    model: str
    target_id: str
    style: str
    slot: int
    seed_used: int
    delta_e00: float
    flat_p95_de: float
    qc_pass: bool
    chroma_sample: float
    chroma_reference: float
    chroma_delta: float
    consistency_de00: float | None
    kept_pct: float
    sample_lab: tuple[float, float, float]
    sample_hex: str  # display only
    image_url: str


class StudyImageDetail(StudyImageOut):
    prompt_hash: str
    generated_at: str | None
    prompt: str
    negative_prompt: str | None
    generation: dict


class StudyImagePage(BaseModel):
    items: list[StudyImageOut]
    total: int
    page: int
    page_size: int


class Disclosure(BaseModel):
    id: int
    title: str
    text: str
