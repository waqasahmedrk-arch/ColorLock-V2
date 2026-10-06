import numpy as np
import pandas as pd

from colourlock.stats import group_summary, run_h1, run_h2, run_h3, sample_guard


def _synthetic_clean_df(n_per_group=15, seed=0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for model in ("FLUX_local", "SDXL"):
        for style in ("A_hex_only", "B_named_hex", "C_reference_anchor"):
            for colour_id in ("royal_blue", "crimson"):
                acc = rng.normal(5, 1, n_per_group).clip(0)
                con = rng.normal(3, 1, n_per_group).clip(0)
                chroma_dev = rng.normal(-2, 1, n_per_group)
                flat = rng.uniform(0.5, 2.5, n_per_group)
                for a, c, cd, f in zip(acc, con, chroma_dev, flat):
                    rows.append({
                        "model": model, "colour_id": colour_id, "style": style,
                        "dE00_to_target": a, "dE00_to_centroid": c,
                        "chroma_dev_from_target": cd, "flat_p95_de": f,
                    })
    return pd.DataFrame(rows)


def test_group_summary_shape():
    df = _synthetic_clean_df()
    summary = group_summary(df)
    assert len(summary) == 2 * 3 * 2  # models x styles x colours
    assert (summary["n"] == 15).all()


def test_sample_guard_reliable_on_synthetic():
    df = _synthetic_clean_df()
    summary = group_summary(df)
    guard = sample_guard(df, summary)
    assert guard.reliable is True
    assert guard.warning is None


def test_sample_guard_flags_tiny_sample():
    df = _synthetic_clean_df(n_per_group=1)
    summary = group_summary(df)
    guard = sample_guard(df, summary)
    assert guard.reliable is False
    assert guard.warning is not None


def test_h2_detects_injected_desaturation_bias():
    df = _synthetic_clean_df()
    result = run_h2(df)
    assert result.name == "H2"
    assert result.p_value < 0.05
    assert result.direction == "desaturated"


def test_h1_runs_without_error():
    df = _synthetic_clean_df()
    summary = group_summary(df)
    result = run_h1(summary)
    assert result.name == "H1"
    assert not np.isnan(result.statistic)


def test_h3_runs_without_error():
    df = _synthetic_clean_df()
    result = run_h3(df)
    assert result.name == "H3"
