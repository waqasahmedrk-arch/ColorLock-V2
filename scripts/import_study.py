"""Load the frozen study dataset into the study_* tables (specs.md §8).

Run once per environment, after `alembic upgrade head`:

    python scripts/import_study.py --files link      # local dev: hardlink PNGs
    python scripts/import_study.py --files upload    # S3/R2: upload PNGs
    python scripts/import_study.py --files none      # rows only

Every per-image metric is computed with the colourlock package from the
manifest's stored dominant colour (the same RGB->Lab conversion as the
notebook's `_rgb_cols_to_lab`), then checked against the notebook's own
reliable_results.csv for the QC-passed images. Any disagreement aborts the
import before anything is written.
"""

from __future__ import annotations

import argparse
import math
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend" / "api"))

from colourlock.stats import group_summary, run_h1, run_h2, run_h3, sample_guard
from colourlock.targets import TARGETS
from skimage.color import deltaE_ciede2000, rgb2lab
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.models import StudyGroup, StudyHypothesis, StudyImage
from app.db.session import make_engine
from app.services.naming import LOW_N_THRESHOLD, MODEL_KEYS
from app.services.provenance import qc_config
from app.services.storage import LocalStorage, make_storage, study_key
from app.settings import get_settings

DEFAULT_STUDY_DIR = REPO_ROOT / "data" / "study" / "colourlock_full_study"
CHECK_TOL = 1e-9


def _matches_notebook(ours: float, theirs: float) -> bool:
    """True if `ours` equals the notebook value to CHECK_TOL, or to the digits the CSV kept.

    The frozen reliable_results.csv was re-saved through a spreadsheet and rounded to
    ~10 significant figures (decisions.md D-17). A full-precision file still gets the
    strict 1e-9 check; a rounded one is checked to half a unit in its last printed digit.
    """
    if abs(ours - theirs) <= CHECK_TOL:
        return True
    text = repr(float(theirs))
    if "e" in text or "." not in text:
        return False
    decimals = len(text.split(".")[1])
    return abs(ours - theirs) <= 0.5 * 10.0 ** -decimals + 1e-12

HYPOTHESIS_NAMES = {
    "H1": "Accuracy and consistency decouple",
    "H2": "Colour drift is biased toward desaturation",
    "H3": "One prompt style is measurably most consistent",
}


def _none_if_nan(value: object) -> float | None:
    if value is None:
        return None
    f = float(value)  # type: ignore[arg-type]
    return None if math.isnan(f) else f


def build_image_rows(all_images: pd.DataFrame, reliable: pd.DataFrame) -> list[dict]:
    reliable = reliable.assign(image_id=reliable["path"].map(lambda p: Path(p).stem))
    by_id = reliable.set_index("image_id")

    dom_rgb = all_images[["dom_R", "dom_G", "dom_B"]].to_numpy(dtype=float) / 255.0
    lab = rgb2lab(dom_rgb.reshape(-1, 1, 3)).reshape(-1, 3)
    target_lab = np.stack([TARGETS[c].lab for c in all_images["colour_id"]])
    de00 = deltaE_ciede2000(lab, target_lab)
    chroma = np.hypot(lab[:, 1], lab[:, 2])
    target_chroma = np.hypot(target_lab[:, 1], target_lab[:, 2])

    threshold = qc_config().flat_p95_de_max
    rows, problems = [], []
    for i, rec in enumerate(all_images.itertuples(index=False)):
        image_id = Path(rec.path).stem
        model = MODEL_KEYS[rec.model]
        qc_pass = bool(rec.qc_pass)

        if qc_pass != (rec.flat_p95_de <= threshold):
            problems.append(f"{image_id}: qc_pass={qc_pass} disagrees with flat_p95_de "
                            f"{rec.flat_p95_de} vs threshold {threshold}")
        if qc_pass != (image_id in by_id.index):
            problems.append(f"{image_id}: qc_pass={qc_pass} but reliable_results membership "
                            f"is {image_id in by_id.index}")

        consistency = None
        if image_id in by_id.index:
            nb = by_id.loc[image_id]
            for name, ours, theirs in (
                ("dE00_to_target", de00[i], nb["dE00_to_target"]),
                ("chroma", chroma[i], nb["chroma"]),
                ("chroma_dev_from_target", chroma[i] - target_chroma[i],
                 nb["chroma_dev_from_target"]),
                ("L", lab[i, 0], nb["L"]), ("a", lab[i, 1], nb["a"]), ("b", lab[i, 2], nb["b"]),
            ):
                if not _matches_notebook(ours, theirs):
                    problems.append(f"{image_id}: {name} package={ours} notebook={theirs}")
            consistency = float(nb["dE00_to_centroid"])

        rows.append({
            "image_id": image_id, "model": model, "target_id": rec.colour_id,
            "style": rec.style, "slot": int(rec.seed_or_call_index),
            "seed_used": int(rec.seed_used), "prompt_hash": str(rec.prompt_hash),
            "generated_at": str(rec.timestamp),
            "file_key": study_key(model, rec.colour_id, rec.style, image_id),
            "delta_e00": float(de00[i]), "flat_p95_de": float(rec.flat_p95_de),
            "qc_pass": qc_pass, "chroma_sample": float(chroma[i]),
            "chroma_reference": float(target_chroma[i]),
            "chroma_delta": float(chroma[i] - target_chroma[i]),
            "consistency_de00": consistency, "kept_pct": float(rec.kept_pct),
            "sample_L": float(lab[i, 0]), "sample_a": float(lab[i, 1]),
            "sample_b": float(lab[i, 2]),
        })

    if problems:
        head = "\n  ".join(problems[:20])
        raise SystemExit(f"Refusing to import: {len(problems)} check(s) failed:\n  {head}")
    return rows


def build_group_rows(all_images: pd.DataFrame, reliable: pd.DataFrame) -> list[dict]:
    counts = (all_images.groupby(["model", "colour_id", "style"])
              .agg(n=("qc_pass", "size"), n_qc_pass=("qc_pass", "sum")).reset_index())
    summary = group_summary(reliable).rename(columns={"n": "n_summary"})
    merged = counts.merge(summary, on=["model", "colour_id", "style"], how="left")
    if len(merged) != len(counts) or len(summary) != merged["n_summary"].notna().sum():
        raise SystemExit("Refusing to import: reliable_results has groups missing from all_images.")
    present = merged.dropna(subset=["n_summary"])
    if not (present["n_qc_pass"] == present["n_summary"]).all():
        raise SystemExit("Refusing to import: group QC-pass counts disagree with reliable_results.")

    metric_cols = ["accuracy_mean", "accuracy_sd", "accuracy_yield_pct", "consistency_mean",
                   "consistency_sd", "consistency_yield_pct", "chroma_dev_target_mean",
                   "flat_p95_de_median"]
    return [
        {"model": MODEL_KEYS[r["model"]], "target_id": r["colour_id"], "style": r["style"],
         "n": int(r["n"]), "n_qc_pass": int(r["n_qc_pass"]),
         **{c: _none_if_nan(r[c]) for c in metric_cols}}
        for r in merged.to_dict("records")
    ]


def build_hypothesis_rows(reliable: pd.DataFrame) -> list[dict]:
    summary = group_summary(reliable)
    guard = sample_guard(reliable, summary)
    per_model = {}
    for nb_model, key in MODEL_KEYS.items():
        sub = summary[summary["model"] == nb_model]
        per_model[key] = {
            "n_images_qc_pass": int((reliable["model"] == nb_model).sum()),
            "n_groups": len(sub),
            "n_groups_ge_10": int((sub["n"] >= LOW_N_THRESHOLD).sum()),
        }
    shared_extra = {
        "sample_guard": {"n_images": guard.n_images, "n_groups": guard.n_groups,
                         "n_groups_ge_10": guard.n_groups_ge_10, "reliable": guard.reliable},
        "per_model": per_model,
    }
    rows = []
    for result in (run_h1(summary), run_h2(reliable), run_h3(reliable)):
        rows.append({
            "id": result.name, "name": HYPOTHESIS_NAMES[result.name], "test": result.test,
            "statistic": _none_if_nan(result.statistic), "p_value": _none_if_nan(result.p_value),
            "direction": result.direction, "notes": result.notes, "extra": shared_extra,
        })
    return rows


def place_files(rows: list[dict], study_dir: Path, mode: str) -> None:
    if mode == "none":
        return
    storage = make_storage(get_settings())
    if mode == "link" and not isinstance(storage, LocalStorage):
        raise SystemExit("--files link needs STORAGE_BACKEND=local; use --files upload for S3.")
    for n, row in enumerate(rows, 1):
        src = study_dir / f"{row['image_id']}.png"
        if not src.exists():
            raise SystemExit(f"Missing study image: {src}")
        if mode == "link":
            assert isinstance(storage, LocalStorage)
            dst = storage.path_for(row["file_key"])
            dst.parent.mkdir(parents=True, exist_ok=True)
            if not dst.exists():
                try:
                    os.link(src, dst)  # no extra disk space
                except OSError:
                    dst.write_bytes(src.read_bytes())
        else:
            storage.put(row["file_key"], src.read_bytes())
        if n % 500 == 0:
            print(f"  files: {n}/{len(rows)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--study-dir", type=Path, default=DEFAULT_STUDY_DIR)
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--files", choices=["link", "upload", "none"], default="link")
    parser.add_argument("--replace", action="store_true",
                        help="delete existing study_* rows first (the app never writes them)")
    args = parser.parse_args()

    all_images = pd.read_csv(args.study_dir / "all_images.csv")
    reliable = pd.read_csv(args.study_dir / "reliable_results.csv")
    print(f"Loaded {len(all_images)} images, {len(reliable)} QC-passed, from {args.study_dir}")

    image_rows = build_image_rows(all_images, reliable)
    group_rows = build_group_rows(all_images, reliable)
    hypothesis_rows = build_hypothesis_rows(reliable)
    print(f"Checks passed: {len(image_rows)} images, {len(group_rows)} groups, "
          f"{len(hypothesis_rows)} hypotheses")

    engine = make_engine(args.database_url or get_settings().database_url)
    with Session(engine) as db, db.begin():
        existing = db.scalar(select(func.count()).select_from(StudyImage)) or 0
        if existing and not args.replace:
            raise SystemExit(f"study_images already has {existing} rows; pass --replace to reload.")
        for model in (StudyImage, StudyGroup, StudyHypothesis):
            db.execute(delete(model))
        db.execute(StudyImage.__table__.insert(), image_rows)
        db.execute(StudyGroup.__table__.insert(), group_rows)
        db.execute(StudyHypothesis.__table__.insert(), hypothesis_rows)

    place_files(image_rows, args.study_dir, args.files)
    print("Import complete.")


if __name__ == "__main__":
    main()
