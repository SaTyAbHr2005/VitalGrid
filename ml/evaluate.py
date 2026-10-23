"""Compares B1-B6 (and rules-only) on the test, held-out-fault and 2x-noise splits.

Usage (from repo root): python -m ml.evaluate [--split val]
Writes results/metrics.json and the `metrics` collection in Atlas.
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

from backend.agents import IDX, Perception, Reasoning
from backend.db import get_db
from backend.rules import signals, ungated_paths, verify
from ml.data import load
from ml.snapshots import build
from sim.simulator import NODES

RESULTS = Path(__file__).resolve().parent.parent / "results"
TAU = 0.5  # r(v) threshold = the 99.9th percentile of normal reconstruction error
METHODS = {
    "B1": "Threshold only (LSTM-AE)",
    "B2": "Temporal correlation",
    "B3": "Graph reachability",
    "B4": "Untyped GAT",
    "B5": "Typed GAT",
    "R": "Rules only (R1-R4)",
    "B6": "Typed GAT + rules (VitalGrid)",
}
PATH_METHODS = {"B3", "B5", "R", "B6"}


def predict_scenario(X, snap, cal, gat_t, gat_u):
    """-> {method: (S, N) bool}, {method: [ {node: path} per snapshot ]}"""
    r, ts = snap["r"], snap["t"]
    pt, _ = gat_t.predict(snap["feats"])
    pu, _ = gat_u.predict(snap["feats"])
    S, N = r.shape
    pred = {m: np.zeros((S, N), bool) for m in METHODS}
    paths = {m: [] for m in PATH_METHODS}
    pred["B1"] = r >= TAU
    pred["B4"] = pu >= gat_u.threshold
    pred["B5"] = pt >= gat_t.threshold
    for k, t in enumerate(ts):
        any_recent = (r[max(0, k - 6):k + 1] >= TAU).any(axis=0)
        rising = r[k] - r[max(0, k - 6)] >= 0.1
        for i in range(N):
            others = np.delete(any_recent, i).any()
            pred["B2"][k, i] = pred["B1"][k, i] or (rising[i] and others)
        up = ungated_paths(r[k], TAU)
        for n in up:
            pred["B3"][k, IDX[n]] = True
        acc = verify(signals(cal, {n: X[n][t - 20:t] for n in NODES}), r[k])
        for n in acc:
            pred["R"][k, IDX[n]] = True
        pred["B6"][k] = pred["R"][k] & pred["B5"][k]
        paths["B3"].append(up)
        paths["B5"].append({n: p for n, p in up.items() if pred["B5"][k, IDX[n]]})
        paths["R"].append({n: a["path"] for n, a in acc.items()})
        paths["B6"].append({n: a["path"] for n, a in acc.items() if pred["B6"][k, IDX[n]]})
    return pred, paths


def score(rows):
    """rows: list of per-scenario dicts -> aggregated metrics."""
    tp = sum(x["tp"] for x in rows)
    fp = sum(x["fp"] for x in rows)
    fn = sum(x["fn"] for x in rows)
    prop_fp = sum(x["prop_fp"] for x in rows)
    prop_pos = sum(x["prop_pos"] for x in rows)
    path_ok = sum(x["path_ok"] for x in rows)
    path_n = sum(x["path_n"] for x in rows)
    delays = [d for x in rows for d in x["delays"]]
    p = tp / max(tp + fp, 1)
    rc = tp / max(tp + fn, 1)
    return {
        "precision": round(p, 3), "recall": round(rc, 3), "f1": round(2 * p * rc / max(p + rc, 1e-9), 3),
        "false_prop_rate": round(prop_fp / max(prop_pos, 1), 3),
        "path_correctness": round(path_ok / path_n, 3) if path_n else None,
        "detection_delay_s": float(np.median(delays)) if delays else None,
        "missed_cascade_nodes": sum(x["missed"] for x in rows),
        "false_alerts_per_scenario": round(sum(x["false_alerts"] for x in rows) / max(len(rows), 1), 2),
    }


def scenario_rows(spec, gt, snap, pred, paths):
    y = snap["y"].astype(bool)
    ts = snap["t"]
    sources = {spec["source_node"]} | ({"GEN"} if spec["fault_type"] == "grid_gen_failure" else set())
    non_src = np.array([n not in sources for n in NODES])
    rows = {}
    for m, P in pred.items():
        row = {"tp": int((P & y).sum()), "fp": int((P & ~y).sum()), "fn": int((~P & y).sum()),
               "prop_fp": int((P & ~y)[:, non_src].sum()), "prop_pos": int(P[:, non_src].sum()),
               "path_ok": 0, "path_n": 0, "delays": [], "missed": 0,
               # alert = rising edge of a prediction on a node that is not (going to be) affected
               "false_alerts": int((P[1:] & ~P[:-1] & ~y[1:]).sum() + (P[0] & ~y[0]).sum())}
        for n in NODES:
            d = gt[n]
            if not d["affected"] or n in sources:
                continue
            i = IDX[n]
            hits = np.where(P[:, i] & (ts > spec["t_inject"]))[0]
            if len(hits):
                row["delays"].append(float(ts[hits[0]] - d["t_affected"]))
            else:
                row["missed"] += 1
            if m in PATH_METHODS and len(d["path"]) >= 2:
                for k in np.where(P[:, i] & y[:, i])[0]:
                    pth = paths[m][k].get(n)
                    row["path_n"] += 1
                    row["path_ok"] += bool(pth and len(pth) >= 2 and pth[0] == d["path"][0] and pth[-2] == d["path"][-2])
        rows[m] = row
    return rows


def main(splits):
    scenarios, X, gt = load()
    snaps = build()
    cal = Perception().cal
    gat_t, gat_u = Reasoning("gat_typed"), Reasoning("gat_untyped")
    report = {}
    for split in splits:
        ids = sorted(s for s, v in scenarios.items() if v["split"] == split)
        per_method = defaultdict(list)
        for sid in ids:
            pred, paths = predict_scenario(X[sid], snaps[sid], cal, gat_t, gat_u)
            for m, row in scenario_rows(scenarios[sid], gt[sid], snaps[sid], pred, paths).items():
                per_method[m].append(row)
        report[split] = {m: {"name": METHODS[m], **score(per_method[m])} for m in METHODS}
        b1, b6 = report[split]["B1"]["false_alerts_per_scenario"], report[split]["B6"]["false_alerts_per_scenario"]
        report[split]["alert_reduction_b6_vs_b1"] = round(1 - b6 / b1, 3) if b1 else None
        print(f"\n== {split} ({len(ids)} scenarios) ==")
        print(f"{'method':4s} {'P':>6s} {'R':>6s} {'F1':>6s} {'FalseProp':>9s} {'PathOK':>7s} {'Delay(s)':>8s} "
              f"{'Missed':>6s} {'FalseAlerts':>11s}")
        for m in METHODS:
            x = report[split][m]
            print(f"{m:4s} {x['precision']:6.3f} {x['recall']:6.3f} {x['f1']:6.3f} {x['false_prop_rate']:9.3f} "
                  f"{x['path_correctness'] if x['path_correctness'] is not None else '-':>7} "
                  f"{x['detection_delay_s'] if x['detection_delay_s'] is not None else '-':>8} "
                  f"{x['missed_cascade_nodes']:6d} {x['false_alerts_per_scenario']:11.2f}")
        print("alert reduction B6 vs B1:", report[split]["alert_reduction_b6_vs_b1"])

    RESULTS.mkdir(exist_ok=True)
    out = RESULTS / "metrics.json"
    old = json.loads(out.read_text()) if out.exists() else {}
    out.write_text(json.dumps({**old, **report}, indent=2))
    db = get_db()
    for split, methods in report.items():
        db.metrics.delete_many({"split": split})
        db.metrics.insert_many([{"split": split, "method": m, **v} for m, v in methods.items() if isinstance(v, dict)])
    print(f"\nwrote {out} and Atlas `metrics`")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", nargs="*", default=["test", "heldout", "noise2x"])
    main(ap.parse_args().split)
