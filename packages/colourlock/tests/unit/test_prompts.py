from colourlock.prompts import (
    PROMPT_HEAD,
    PROMPT_TAIL_USED,
    SDXL_NEG_CLAUSES,
    SDXL_NEGATIVE_PROMPT,
    build_prompt,
    colour_desc,
    validate_prompt,
)
from colourlock.targets import TARGETS


def test_frozen_tail_clause_count():
    assert len(PROMPT_TAIL_USED) == 6
    assert len(PROMPT_HEAD) == 5


def test_all_21_negative_clauses_kept():
    assert len(SDXL_NEG_CLAUSES) == 21
    assert SDXL_NEGATIVE_PROMPT == ", ".join(SDXL_NEG_CLAUSES)


def test_colour_desc_a_hex_only():
    target = TARGETS["royal_blue"]
    assert colour_desc(target, "A_hex_only") == "colour HEX #4169E1"


def test_colour_desc_d_explicit_cielab_format():
    target = TARGETS["crimson"]
    desc = colour_desc(target, "D_explicit_cielab")
    assert desc.startswith("colour at CIELAB L=")
    assert "crimson" in desc


def test_build_prompt_includes_head_and_tail():
    target = TARGETS["teal"]
    prompt = build_prompt(target, "B_named_hex")
    assert "flat matte solid colour fill" in prompt
    assert "no border" in prompt
    assert "colour teal, HEX #008080" in prompt


def test_validate_prompt_fallback_estimate_flags_source():
    check = validate_prompt("colour HEX #4169E1")
    assert check.source in ("clip_tokenizer", "fallback_estimate")
    assert check.tokens > 0
