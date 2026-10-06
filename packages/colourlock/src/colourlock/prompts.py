"""Prompt construction: styles A-E, the frozen tail-clause set, CLIP budget check.

`PROMPT_TAIL_USED` and `SDXL_NEGATIVE_PROMPT` are run artifacts from the v15
study (see claude/specs.md §5), not re-derived formulas -- they are hard-coded
so build_prompt reproduces the study exactly (D-03, PROMPT_FIT_CLIP=True).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

from .targets import Target

Style = Literal["A_hex_only", "B_named_hex", "C_reference_anchor", "D_explicit_cielab", "E_name_only"]

STYLES: list[Style] = [
    "A_hex_only", "B_named_hex", "C_reference_anchor", "D_explicit_cielab", "E_name_only",
]

PROMPT_HEAD: list[str] = [
    "flat matte solid colour fill", "no gradient", "no vignette", "no shadows", "no lighting falloff",
]

# The 6 of 14 candidate tail clauses that fit the CLIP budget against the
# worst-case colour spec across the whole v15 run. Frozen, not recomputed.
PROMPT_TAIL_USED: list[str] = [
    "filling the entire image edge to edge", "no texture", "no pattern",
    "no object", "no garment", "no border",
]

SDXL_NEG_CLAUSES: list[str] = [
    "gradient", "vignette", "lighting falloff", "shadow", "shading", "texture",
    "noise", "grain", "pattern", "object", "product", "garment", "fabric folds",
    "text", "logo", "watermark", "reflection", "glossy highlight", "border",
    "frame", "3d render",
]
# All 21 clauses fit the study's CLIP budget (51 tokens); nothing was dropped.
SDXL_NEGATIVE_PROMPT: str = ", ".join(SDXL_NEG_CLAUSES)

CLIP_LIMIT_DEFAULT = 77
CLIP_BUDGET_DEFAULT = CLIP_LIMIT_DEFAULT - 2  # BOS + EOS


def colour_desc(target: Target, style: Style) -> str:
    hexcode, name, anchor = target.hex, target.name, target.anchor_object
    lab = target.lab
    return {
        "A_hex_only": f"colour HEX #{hexcode}",
        "B_named_hex": f"colour {name}, HEX #{hexcode}",
        "C_reference_anchor": f"a colour matching {anchor}, a {name} shade",
        "D_explicit_cielab": f"colour at CIELAB L={lab[0]:.1f} a={lab[1]:.1f} b={lab[2]:.1f} ({name})",
        "E_name_only": f"colour {name}",
    }[style]


def build_prompt(target: Target, style: Style) -> str:
    desc = colour_desc(target, style)
    return ", ".join(PROMPT_HEAD + [f"pure uniform {desc}"] + PROMPT_TAIL_USED)


@dataclass(frozen=True)
class PromptCheck:
    tokens: int
    fits: bool
    limit: int
    source: str  # "clip_tokenizer" or "fallback_estimate"


_TOKENIZER: Any = None
_TOKENIZER_LOAD_ATTEMPTED = False


def _load_tokenizer(repo_id: str, revision: str | None, token: str | None) -> Any:
    global _TOKENIZER, _TOKENIZER_LOAD_ATTEMPTED
    if _TOKENIZER_LOAD_ATTEMPTED:
        return _TOKENIZER
    _TOKENIZER_LOAD_ATTEMPTED = True
    try:
        from transformers import CLIPTokenizer
        _TOKENIZER = CLIPTokenizer.from_pretrained(
            repo_id, subfolder="tokenizer", token=token, revision=revision,
        )
    except (ImportError, OSError, ValueError):  # missing extra, no network, bad repo
        _TOKENIZER = None
    return _TOKENIZER


def n_tokens(text: str, *, repo_id: str | None = None, revision: str | None = None,
             token: str | None = None) -> tuple[int, str]:
    """Returns (token_count_incl_BOS_EOS, source). Requires the `[prompts]` extra
    for a real CLIP count; falls back to a conservative regex estimate otherwise."""
    tokenizer = _load_tokenizer(repo_id, revision, token) if repo_id else _TOKENIZER
    if tokenizer is not None:
        return len(tokenizer(text, truncation=False)["input_ids"]), "clip_tokenizer"
    # Conservative fallback: CLIP's BPE splits punctuation and hex strings, so
    # pad the word count generously rather than risk silent truncation.
    estimate = int(len(re.findall(r"[\w#]+|[^\w\s]", text)) * 1.35) + 2
    return estimate, "fallback_estimate"


def validate_prompt(text: str, *, repo_id: str | None = None, revision: str | None = None,
                     token: str | None = None, limit: int = CLIP_LIMIT_DEFAULT) -> PromptCheck:
    count, source = n_tokens(text, repo_id=repo_id, revision=revision, token=token)
    return PromptCheck(tokens=count, fits=count <= limit, limit=limit, source=source)
