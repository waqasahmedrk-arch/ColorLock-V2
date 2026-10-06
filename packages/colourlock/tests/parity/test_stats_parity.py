"""colourlock.stats vs the notebook's saved summary table and printed H1-H3
results (notebook cells under "Step 9" / "Step 10 -- Hypothesis tests").
"""

import pandas as pd
import pytest

from colourlock.stats import group_summary, run_h1, run_h2, run_h3, sample_guard

pytestmark = pytest.mark.slow

# Printed verbatim in notebooks/ColourLock_v15_local.ipynb, Step 10 output cell.
NOTEBOOK_H1 = {"rho": 0.279, "p": 0.0604}
NOTEBOOK_H2 = {"statistic": 159371.0, "p": 9.50e-01}
NOTEBOOK_H3 = {"levene_stat": 190.62, "kw_stat": 415.80, "kw_p": 0.0000, "tightest": "B_named_hex"}
NOTEBOOK_GUARD = {"n_images": 772, "n_groups": 46, "n_groups_ge_10": 33}


@pytest.fixture(scope="module")
def clean_df(study_dir):
    return pd.read_csv(study_dir / "reliable_results.csv")


@pytest.fixture(scope="module")
def summary(clean_df):
    return group_summary(clean_df)


def test_sample_guard_matches_notebook(clean_df, summary):
    guard = sample_guard(clean_df, summary)
    assert guard.n_images == NOTEBOOK_GUARD["n_images"]
    assert guard.n_groups == NOTEBOOK_GUARD["n_groups"]
    assert guard.n_groups_ge_10 == NOTEBOOK_GUARD["n_groups_ge_10"]
    assert guard.reliable is True


def test_group_summary_matches_saved_csv(summary, study_dir):
    expected = pd.read_csv(study_dir / "summary_by_model_colour_style.csv")
    merged = summary.merge(expected, on=["model", "colour_id", "style"], suffixes=("_pkg", "_nb"))
    assert len(merged) == len(summary) == len(expected)
    for col in ("accuracy_mean", "accuracy_sd", "accuracy_yield_pct", "consistency_mean",
                "consistency_sd", "consistency_yield_pct", "chroma_dev_target_mean",
                "flat_p95_de_median"):
        # notebook's saved CSV is .round(2); allow rounding-only difference.
        diff = (merged[f"{col}_pkg"] - merged[f"{col}_nb"]).abs()
        assert diff.max() < 0.005, f"{col}: max diff {diff.max()}"
    assert (merged["n_pkg"] == merged["n_nb"]).all()


def test_h1_matches_notebook(summary):
    result = run_h1(summary)
    assert result.statistic == pytest.approx(NOTEBOOK_H1["rho"], abs=5e-4)
    assert result.p_value == pytest.approx(NOTEBOOK_H1["p"], abs=5e-4)


def test_h2_matches_notebook(clean_df):
    result = run_h2(clean_df)
    assert result.statistic == pytest.approx(NOTEBOOK_H2["statistic"], abs=1)
    assert result.p_value == pytest.approx(NOTEBOOK_H2["p"], abs=5e-3)


def test_h3_matches_notebook(clean_df):
    result = run_h3(clean_df)
    assert result.statistic == pytest.approx(NOTEBOOK_H3["kw_stat"], abs=5e-2)
    assert f"tightest={NOTEBOOK_H3['tightest']}" in result.direction
