from __future__ import annotations

import math

from colourlock.prompts import STYLES, build_prompt, validate_prompt
from colourlock.targets import TARGETS
from fastapi import APIRouter

from ..schemas.meta import Health, PromptStyle, PromptValidateIn, PromptValidateOut, Target
from ..services.naming import STYLE_CODES, STYLE_DESCRIPTIONS
from ..services.provenance import model_config, provenance
from ..settings import get_settings

router = APIRouter(tags=["meta"])

EXAMPLE_TARGET = "royal_blue"


@router.get("/health", response_model=Health)
def health() -> Health:
    return Health(status="ok")


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
