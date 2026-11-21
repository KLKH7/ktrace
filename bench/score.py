"""Step 4: score every model on the same test answers and write the results.

Three measures, each with a 95% interval from resampling test students 1,000 times:
  AUC       how well the model ranks right answers above wrong ones (0.5 is chance, 1 is perfect)
  log loss  how good its probabilities are (lower is better)
  RMSE      the same idea on a gentler scale (lower is better)

    uv run --with pandas --with numpy bench/score.py --seed 42
"""
import argparse
import datetime
import json
import pathlib
import subprocess

import numpy as np
import pandas as pd

HERE = pathlib.Path(__file__).parent
DATA = HERE / "data"
MODELS = ["base_overall", "base_skill", "ktrace_defaults", "ktrace_fit", "ktrace_per_skill", "pybkt", "pybkt_forgets"]


def auc(y: np.ndarray, p: np.ndarray) -> float:
    order = pd.Series(p).rank().to_numpy()
    pos = y == 1
    n_pos, n_neg = pos.sum(), (~pos).sum()
    return float((order[pos].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg)) if n_pos and n_neg else float("nan")


def measures(y: np.ndarray, p: np.ndarray) -> dict[str, float]:
    q = np.clip(p, 1e-6, 1 - 1e-6)
    return {"auc": auc(y, p), "log_loss": float(-np.mean(y * np.log(q) + (1 - y) * np.log(1 - q))), "rmse": float(np.sqrt(np.mean((y - p) ** 2)))}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    test = pd.read_csv(DATA / "test.csv")
    y = test["correct"].to_numpy()
    # a model whose predictions are not there yet is left out and named, so partial results can be read
    missing = [m for m in MODELS if not (DATA / f"preds_{m}.csv").exists()]
    models = [m for m in MODELS if m not in missing]
    preds = {m: test[["row"]].merge(pd.read_csv(DATA / f"preds_{m}.csv"), on="row")["pred"].to_numpy() for m in models}
    # resample whole students, since one student's answers are not independent of each other
    students = test["user_id"].to_numpy()
    index_of = pd.Series(np.arange(len(test))).groupby(students).apply(lambda s: s.to_numpy())
    rng = np.random.default_rng(args.seed)
    draws = [np.concatenate(index_of.iloc[rng.integers(0, len(index_of), len(index_of))].to_list()) for _ in range(1000)]
    results = {}
    for m in models:
        point = measures(y, preds[m])
        boot = pd.DataFrame([measures(y[d], preds[m][d]) for d in draws])
        results[m] = {k: {"value": round(v, 4), "low": round(float(boot[k].quantile(0.025)), 4), "high": round(float(boot[k].quantile(0.975)), 4)} for k, v in point.items()}
    # the comparison that matters: this project's best pre-chosen version against the standard library, on the same resamples
    gap = [measures(y[d], preds["ktrace_per_skill"][d])["auc"] - measures(y[d], preds["pybkt"][d])["auc"] for d in draws]
    out = {
        "date": datetime.date.today().isoformat(),
        "git": subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=HERE).stdout.strip(),
        "seed": args.seed,
        "data": "ASSISTments 2009-2010 skill builder (as.csv from pyBKT-examples)",
        "test_answers": int(len(test)),
        "test_students": int(test["user_id"].nunique()),
        "ktrace_params": json.loads((DATA / "ktrace_params.json").read_text()),
        "not_run": missing,
        "results": results,
        "auc_gap_ktrace_per_skill_minus_pybkt": {"value": round(results["ktrace_per_skill"]["auc"]["value"] - results["pybkt"]["auc"]["value"], 4), "low": round(float(np.quantile(gap, 0.025)), 4), "high": round(float(np.quantile(gap, 0.975)), 4)},
    }
    (HERE / "results.json").write_text(json.dumps(out, indent=2) + "\n")
    print(f"{'model':18} {'AUC':>22} {'log loss':>22} {'RMSE':>22}")
    for m in models:
        r = results[m]
        print(f"{m:18} " + " ".join(f"{r[k]['value']:.4f} ({r[k]['low']:.4f}-{r[k]['high']:.4f})".rjust(22) for k in ("auc", "log_loss", "rmse")))
    if missing:
        print("not run yet:", ", ".join(missing))
    print("AUC gap, ktrace_per_skill minus pybkt:", out["auc_gap_ktrace_per_skill_minus_pybkt"])


if __name__ == "__main__":
    main()
