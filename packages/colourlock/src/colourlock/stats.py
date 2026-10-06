"""Group-level statistics and H1-H3 hypothesis tests. Offline only (D-09):
these run once over the frozen study dataset; the API serves stored output.

Ported from notebook Step 9 (`group_summary`) and Step 10 (H1-H3), including
the notebook's own low-sample guard rail.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy import stats as scipy_stats

GROUP_COLS = ["model", "colour_id", "style"]
ACCURACY_YIELD_MAX_DE00 = 5.0
CONSISTENCY_YIELD_MAX_DE00 = 5.0
MIN_TOTAL_IMAGES = 100
MIN_GROUPS_WITH_N10 = 5


def group_summary(clean_df: pd.DataFrame) -> pd.DataFrame:
    """clean_df: QC-passed rows only, with dE00_to_target, dE00_to_centroid,
    chroma_dev_from_target, flat_p95_de columns already computed (see metrics)."""
    rows = []
    for (model, cid, style), sub in clean_df.groupby(GROUP_COLS):
        acc = sub["dE00_to_target"]
        con = sub["dE00_to_centroid"]
        rows.append({
            "model": model, "colour_id": cid, "style": style, "n": len(sub),
            "accuracy_mean": acc.mean(),
            "accuracy_sd": acc.std(ddof=1) if len(acc) > 1 else np.nan,
            "accuracy_yield_pct": (acc <= ACCURACY_YIELD_MAX_DE00).mean() * 100,
            "consistency_mean": con.mean(),
            "consistency_sd": con.std(ddof=1) if len(con) > 1 else np.nan,
            "consistency_yield_pct": (con <= CONSISTENCY_YIELD_MAX_DE00).mean() * 100,
            "chroma_dev_target_mean": sub["chroma_dev_from_target"].mean(),
            "flat_p95_de_median": sub["flat_p95_de"].median(),
        })
    return pd.DataFrame(rows)


@dataclass(frozen=True)
class HypothesisResult:
    name: str
    test: str
    statistic: float
    p_value: float
    direction: str
    notes: str


@dataclass(frozen=True)
class SampleGuard:
    n_images: int
    n_groups: int
    n_groups_ge_10: int
    reliable: bool

    @property
    def warning(self) -> str | None:
        if self.reliable:
            return None
        return (
            "SAMPLE TOO SMALL TO REPORT: treat every number as a smoke test, "
            "not a result. Fix the QC threshold or generate more images first."
        )


def sample_guard(clean_df: pd.DataFrame, summary_df: pd.DataFrame) -> SampleGuard:
    n_images = len(clean_df)
    n_groups_ge_10 = int((summary_df["n"] >= 10).sum())
    reliable = not (n_images < MIN_TOTAL_IMAGES or n_groups_ge_10 < MIN_GROUPS_WITH_N10)
    return SampleGuard(n_images=n_images, n_groups=len(summary_df),
                        n_groups_ge_10=n_groups_ge_10, reliable=reliable)


def run_h1(summary_df: pd.DataFrame) -> HypothesisResult:
    """NOTE: the notebook rounds summary_df to 2dp (`.round(2)`) immediately
    after building it, and every downstream use -- including this
    correlation -- runs on the rounded values, not the raw ones. Replicated
    here for parity (verified against notebook output: rho 0.2764->0.279,
    p 0.0630->0.0604 without this, both match after it)."""
    h1 = summary_df.dropna(subset=["accuracy_mean", "consistency_mean"]).round(2)
    if len(h1) < 5:
        return HypothesisResult("H1", "spearman", float("nan"), float("nan"),
                                 "insufficient", f"only {len(h1)} group(s)")
    rho, p = scipy_stats.spearmanr(h1["accuracy_mean"], h1["consistency_mean"])
    direction = "decoupled" if (abs(rho) < 0.3 or p > 0.05) else "coupled"
    return HypothesisResult(
        name="H1", test="spearman_rho", statistic=float(rho), p_value=float(p),
        direction=direction,
        notes=f"accuracy_mean vs consistency_mean across {len(h1)} model x colour x style groups",
    )


def run_h2(clean_df: pd.DataFrame) -> HypothesisResult:
    """One-sided Wilcoxon signed-rank on chroma_dev_from_target (H0: median=0,
    H1: median<0, i.e. systematically desaturated vs the reference chip).
    Must use chroma_dev_from_target, NOT chroma_dev_from_centroid (v7 bug)."""
    values = clean_df["chroma_dev_from_target"].dropna().to_numpy()
    stat, p = scipy_stats.wilcoxon(values, alternative="less")
    direction = "desaturated" if p < 0.05 else "not_significant"
    return HypothesisResult(
        name="H2", test="wilcoxon_signed_rank", statistic=float(stat), p_value=float(p),
        direction=direction,
        notes=f"n={len(values)}, median deviation={np.median(values):+.2f} chroma units",
    )


def run_h3(clean_df: pd.DataFrame, styles: list[str] | None = None) -> HypothesisResult:
    """Levene + Kruskal-Wallis across prompt styles on dE00_to_centroid (consistency).
    Styles with < 3 samples are excluded. An omnibus significant result does NOT
    identify a winning style without a pairwise follow-up (notebook's own caveat)."""
    groups, labels = [], []
    for style in styles or sorted(clean_df["style"].unique()):
        g = clean_df.loc[clean_df["style"] == style, "dE00_to_centroid"].dropna().to_numpy()
        if len(g) >= 3:
            groups.append(g)
            labels.append(style)
    if len(groups) < 2:
        return HypothesisResult("H3", "levene+kruskal", float("nan"), float("nan"),
                                 "insufficient", "not enough groups with data")
    lev_stat, lev_p = scipy_stats.levene(*groups)
    kw_stat, kw_p = scipy_stats.kruskal(*groups)
    significant = lev_p < 0.05 or kw_p < 0.05
    tightest = None
    if significant:
        means = {label: clean_df.loc[clean_df["style"] == label, "dE00_to_centroid"].mean()
                 for label in labels}
        tightest = min(means, key=lambda style: means[style])
    return HypothesisResult(
        name="H3", test="levene_kruskal", statistic=float(kw_stat), p_value=float(kw_p),
        direction=(f"significant_tightest={tightest}" if significant else "not_significant"),
        notes=(f"levene stat={lev_stat:.2f} p={lev_p:.4f}; styles={labels}; "
               "omnibus does not establish a winner over the runner-up without "
               "a pairwise Mann-Whitney + multiple-comparison correction"),
    )
