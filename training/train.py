#!/usr/bin/env python3
"""Train oho's banner classifier (logistic regression) and export model/weights.json.

Not shipped in the extension. Input: one or more CSVs produced by the collector
(training/collector.js) with one column per feature, a `label` column (1 = cookie
banner, 0 = not) and an optional `url` column.

    pip install -r training/requirements.txt
    python training/train.py training/data/*.csv            # writes model/weights.json
    python training/train.py data.csv --out /tmp/w.json --threshold 0.75 --dry-run

Feature order is taken from the current model/weights.json, so the exported file
always matches what src/features.ts computes.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, precision_score, recall_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict

ROOT = Path(__file__).resolve().parent.parent
WEIGHTS = ROOT / "model" / "weights.json"


def load(paths: list[Path], features: list[str]) -> tuple[np.ndarray, np.ndarray]:
    xs, ys = [], []
    for p in paths:
        with p.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                missing = [k for k in features if k not in row]
                if missing:
                    sys.exit(f"{p}: missing feature columns {missing}")
                xs.append([float(row[k]) for k in features])
                ys.append(int(row["label"]))
    if not xs:
        sys.exit("no rows found")
    return np.asarray(xs), np.asarray(ys)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, default=WEIGHTS)
    ap.add_argument("--threshold", type=float, help="decision threshold (default: keep current)")
    ap.add_argument("--hide-threshold", type=float, help="stricter threshold for hiding without a reject button")
    ap.add_argument("--C", type=float, default=1.0, help="inverse regularisation strength")
    ap.add_argument("--dry-run", action="store_true", help="print metrics, do not write")
    args = ap.parse_args()

    current = json.loads(WEIGHTS.read_text(encoding="utf-8"))
    features: list[str] = current["features"]
    X, y = load(args.csv, features)
    pos, neg = int(y.sum()), int(len(y) - y.sum())
    print(f"{len(y)} rows: {pos} banners, {neg} non-banners")
    if pos == 0 or neg == 0:
        sys.exit("need both positive and negative examples")

    # class_weight balances the (usually) rare positives
    model = LogisticRegression(C=args.C, class_weight="balanced", max_iter=2000)
    threshold = args.threshold if args.threshold is not None else current.get("threshold", 0.7)

    folds = min(5, pos, neg)
    if folds >= 2:
        proba = cross_val_predict(model, X, y, cv=StratifiedKFold(folds, shuffle=True, random_state=0), method="predict_proba")[:, 1]
        pred = (proba >= threshold).astype(int)
        print(f"\n{folds}-fold cross-validation @ threshold {threshold}:")
        print(classification_report(y, pred, target_names=["other", "banner"], digits=3, zero_division=0))
        # precision matters most: a false positive means oho touches a non-banner
        print(f"precision={precision_score(y, pred, zero_division=0):.3f} recall={recall_score(y, pred, zero_division=0):.3f}")
    else:
        print("too few rows for cross-validation; fitting on everything")

    model.fit(X, y)
    out = {
        "version": current.get("version", 1) + 1,
        "source": f"trained on {len(y)} rows ({', '.join(p.name for p in args.csv)})",
        "features": features,
        "weights": [round(float(w), 4) for w in model.coef_[0]],
        "bias": round(float(model.intercept_[0]), 4),
        "threshold": threshold,
        "hideThreshold": args.hide_threshold if args.hide_threshold is not None else current.get("hideThreshold", threshold),
    }
    print("\nweights:")
    for k, w in zip(features, out["weights"]):
        print(f"  {k:<14}{w:+.3f}")
    print(f"  {'bias':<14}{out['bias']:+.3f}")
    if args.dry_run:
        return
    args.out.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {args.out} - run `npm run build && npm test && npm run bench` before shipping")


if __name__ == "__main__":
    main()
