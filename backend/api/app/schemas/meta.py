from __future__ import annotations

from pydantic import BaseModel, Field


class Health(BaseModel):
    status: str
    # /health?deep=true only: "ok" or why a dependency isn't usable (never secrets).
    checks: dict[str, str] | None = None


class Target(BaseModel):
    id: str
    name: str
    hex: str
    lab: tuple[float, float, float]
    chroma: float
    anchor_object: str


class PromptStyle(BaseModel):
    id: str
    code: str
    description: str
    example_target_id: str
    example_prompt: str


class PromptValidateIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class PromptValidateOut(BaseModel):
    tokens: int
    fits: bool
    limit: int
    source: str
