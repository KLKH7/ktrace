"""Scores every forgetting model on the same 300,000 held-out Duolingo reviews.

Two measures, as in the paper the data comes from (Settles & Meeder, 2016), each with a 95%
interval from resampling learners 500 times:
  MAE   the average gap between predicted and actual recall for a review (lower is better)
  AUC   how well the model ranks reviews that went well above ones that went badly, where
        "went well" means at least half the words were recalled (0.5 is chance)

    uv run --with pandas --with numpy bench/duo_score.py --seed 42
"""
import argparse
import datetime
import json
import pathlib
import subprocess

import numpy as np
import pandas as pd

HERE = pathlib.Path(__file__).parent
RESULTS = HERE / "data" / "duo" / "results"
MODELS = ["constant", "ktrace_shipped", "ktrace_history", "ktrace_fit", "ktrace_forget_fit", "ktrace_all_fit", "pimsleur", "leitner", "lr", "hlr"]


def auc(y: np.ndarray, p: np.ndarray) -> float:
    order = pd.Series(p).rank().to_numpy()
    pos = y == 1
    n_pos, n_neg = pos.sum(), (~pos).sum()
    return float((order[pos].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg)) if n_pos and n_neg else float("nan")


def measures(p: np.ndarray, pp: np.ndarray) -> dict[str, float]:
    return {"mae": float(np.mean(np.abs(p - pp))), "auc": auc(np.round(p), pp)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    frames = {m: pd.read_csv(RESULTS / f"{m}.traces.3000000.preds", sep="\t") for m in MODELS}
    base = frames["hlr"]
    for m, f in frames.items():
        # every file must describe the same reviews in the same order
        assert len(f) == len(base) and np.allclose(f["p"], base["p"], atol=1e-4) and (f["user_id"] == base["user_id"]).all(), m
    p = base["p"].to_numpy()
    index_of = pd.Series(np.arange(len(base))).groupby(base["user_id"].to_numpy()).apply(lambda s: s.to_numpy())
    rng = np.random.default_rng(args.seed)
    draws = [np.concatenate(index_of.iloc[rng.integers(0, len(index_of), len(index_of))].to_list()) for _ in range(500)]
    results = {}
    for m in MODELS:
        pp = frames[m]["pp"].to_numpy()
        point = measures(p, pp)
        boot = pd.DataFrame([measures(p[d], pp[d]) for d in draws])
        results[m] = {k: {"value": round(v, 4), "low": round(float(boot[k].quantile(0.025)), 4), "high": round(float(boot[k].quantile(0.975)), 4)} for k, v in point.items()}
    out = {
        "date": datetime.date.today().isoformat(),
        "git": subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=HERE).stdout.strip(),
        "seed": args.seed,
        "data": "Duolingo learning traces (Settles & Meeder 2016), first 3,000,000 reviews, last 10% scored",
        "scored_reviews": int(len(base)),
        "scored_learners": int(base["user_id"].nunique()),
        "share_fully_recalled": round(float((p > 0.99).mean()), 4),
        "ktrace_params": json.loads((RESULTS / "ktrace_params.json").read_text()),
        "results": results,
    }
    (HERE / "results_forgetting.json").write_text(json.dumps(out, indent=2) + "\n")
    print(f"{'model':16} {'MAE':>24} {'AUC':>24}")
    for m in MODELS:
        r = results[m]
        print(f"{m:16} " + " ".join(f"{r[k]['value']:.4f} ({r[k]['low']:.4f}-{r[k]['high']:.4f})".rjust(24) for k in ("mae", "auc")))
    print("scored:", out["scored_reviews"], "reviews,", out["scored_learners"], "learners; fully recalled:", out["share_fully_recalled"])


if __name__ == "__main__":
    main()
