"""Step 1 of the benchmark: fetch a public dataset of student answers and split it by student.

The data is the ASSISTments 2009-2010 "skill builder" set, as distributed with pyBKT's examples:
one row per answer, with the student, the skill, and whether the answer was right. Students are
divided at random (by --seed) into 80% whose answers the models learn from and 20% they are
tested on, so no model ever sees a test student. Every model is scored on the same test rows.

Cleaning: in the raw file, about 121,000 rows repeat an answer that is already listed for the
same skill. A repeated row makes the next answer trivially predictable and inflates every
model's score, so they are dropped (the first is kept). An answer that counts towards several
different skills is kept once per skill. --raw skips the cleaning, to reproduce the inflated run.

    uv run --with pandas bench/prepare.py --seed 42
"""
import argparse
import hashlib
import pathlib
import urllib.request

import pandas as pd

URL = "https://raw.githubusercontent.com/CAHLR/pyBKT-examples/master/data/as.csv"
DATA = pathlib.Path(__file__).parent / "data"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--raw", action="store_true")
    args = parser.parse_args()
    DATA.mkdir(exist_ok=True)
    raw = DATA / "as.csv"
    if not raw.exists():
        urllib.request.urlretrieve(URL, raw)
    df = pd.read_csv(raw, encoding="latin-1", low_memory=False, usecols=["order_id", "user_id", "skill_name", "correct"])
    df = df.dropna(subset=["skill_name"])
    before = len(df)
    if not args.raw:
        df = df.drop_duplicates(subset=["order_id", "skill_name"], keep="first")
    print(f"answers with a skill: {before:,}; after dropping repeats: {len(df):,}")
    df = df[df["correct"].isin([0, 1])].astype({"correct": int})
    df = df.sort_values(["user_id", "order_id"], kind="stable").reset_index(drop=True)
    # skills get a number as well as a name, and the columns a fixed order, so any program can read the files
    df["skill_id"] = df["skill_name"].astype("category").cat.codes
    df = df[["order_id", "user_id", "skill_id", "correct", "skill_name"]]
    # a student is in the test set if a hash of their id and the seed falls in the last fifth
    part = df["user_id"].map(lambda u: int(hashlib.sha256(f"{args.seed}:{u}".encode()).hexdigest(), 16) % 5)
    for name, rows in (("train", df[part != 0]), ("test", df[part == 0])):
        rows.reset_index(drop=True).rename_axis("row").to_csv(DATA / f"{name}.csv")
        print(f"{name}: {len(rows):,} answers, {rows['user_id'].nunique():,} students, {rows['skill_name'].nunique()} skills, {rows['correct'].mean():.3f} right")


if __name__ == "__main__":
    main()
