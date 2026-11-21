"""Step 2: the reference models. pyBKT is the standard library for Bayesian knowledge tracing;
it fits four numbers per skill by expectation-maximisation. Two of its models are run: the
standard one, and the one that also lets a student forget.

    uv run --with pybkt --with pandas --with "scikit-learn<1.5" bench/pybkt_run.py --seed 42
(pyBKT calls scikit-learn in a way newer versions reject, hence the older one.)
"""
import argparse
import pathlib

import pandas as pd
from pyBKT.models import Model

DATA = pathlib.Path(__file__).parent / "data"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--only", choices=["pybkt", "pybkt_forgets"], help="run one of the two models; the forgetting one takes far longer")
    args = parser.parse_args()
    train = pd.read_csv(DATA / "train.csv")
    test = pd.read_csv(DATA / "test.csv")
    for name, forgets in (("pybkt", False), ("pybkt_forgets", True)):
        if args.only and args.only != name:
            continue
        # parallel=False: on macOS the library's worker processes hang
        model = Model(seed=args.seed, num_fits=1, parallel=False)
        model.fit(data=train, forgets=forgets)
        predicted = model.predict(data=test)
        # skills the model never saw in training get no prediction from pyBKT: use the training average
        out = test[["row"]].merge(predicted[["row", "correct_predictions"]], on="row", how="left")
        missing = out["correct_predictions"].isna() | (out["correct_predictions"] == 0.5)
        out["pred"] = out["correct_predictions"].where(~out["correct_predictions"].isna(), train["correct"].mean())
        out[["row", "pred"]].to_csv(DATA / f"preds_{name}.csv", index=False)
        print(f"{name}: {len(out):,} predictions, {int(missing.sum()):,} on skills unseen in training")


if __name__ == "__main__":
    main()
