"""Generates mock scenarios and inserts telemetry + ground truth straight into MongoDB Atlas.

Usage (from repo root):
  python -m sim.generate_dataset --mini      # 20 scenarios, for a size/speed check
  python -m sim.generate_dataset             # full dataset (drops and recreates the dataset collections)
"""
import argparse
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import numpy as np

from backend.db import get_db
from backend.seed import create_collections
from sim.simulator import FAULTS, METRICS, NODE_TYPE, NODES, gt_path, run_scenario

BASE_TS = datetime(2026, 1, 1, tzinfo=timezone.utc)
T = 300
HELDOUT = "o2_pressure_drop"


def scenario_specs(n_main, n_heldout, n_noise, seed=42):
    rng = np.random.default_rng(seed)
    main_types = [f for f in FAULTS if f != HELDOUT]
    specs = []

    def spec(i, ft, split, noise):
        return {"_id": f"S{i:04d}", "fault_type": ft, "source_node": rng.choice(FAULTS[ft]) if ft != "normal" else None,
                "severity": float(rng.uniform()), "t_inject": int(rng.integers(60, 121)), "split": split,
                "noise": noise, "seed": int(rng.integers(1 << 31))}

    order = rng.permutation(n_main)
    for k, i in enumerate(order):
        split = "train" if k < 0.7 * n_main else "val" if k < 0.85 * n_main else "test"
        specs.append(spec(len(specs), main_types[i % len(main_types)], split, 1.0))
    for _ in range(n_heldout):
        specs.append(spec(len(specs), HELDOUT, "heldout", 1.0))
    for _ in range(n_noise):
        specs.append(spec(len(specs), main_types[int(rng.integers(len(main_types)))], "noise2x", 2.0))
    return specs


def telemetry_docs(scenario_id, X):
    for n in NODES:
        names = METRICS[NODE_TYPE[n]]
        meta = {"scenario_id": scenario_id, "node_id": n, "node_type": NODE_TYPE[n]}
        for t, row in enumerate(X[n]):
            yield {"ts": BASE_TS + timedelta(seconds=t), "meta": meta, **dict(zip(names, map(float, row)))}


def insert_batched(coll, docs, pool, batch=5000):
    buf, futures = [], []
    for d in docs:
        buf.append(d)
        if len(buf) == batch:
            futures.append(pool.submit(coll.insert_many, buf, ordered=False))
            buf = []
    if buf:
        futures.append(pool.submit(coll.insert_many, buf, ordered=False))
    for f in futures:
        f.result()


def main(mini):
    db = get_db()
    for name in ("telemetry", "scenarios", "ground_truth"):
        db.drop_collection(name)
    create_collections(db)

    specs = scenario_specs(*((14, 3, 3) if mini else (300, 30, 30)))
    start = time.time()
    with ThreadPoolExecutor(max_workers=8) as pool:
        # 2 h of fault-free data for the LSTM autoencoders (30 min in mini mode)
        X, _ = run_scenario("normal", None, 0, 0, T=1800 if mini else 7200, seed=7)
        db.scenarios.insert_one({"_id": "normal", "fault_type": "normal", "split": "normal", "noise": 1.0})
        insert_batched(db.telemetry, telemetry_docs("normal", X), pool)

        for k, s in enumerate(specs):
            X, affected = run_scenario(s["fault_type"], s["source_node"], s["severity"], s["t_inject"],
                                       T=T, seed=s["seed"], noise=s["noise"])
            insert_batched(db.telemetry, telemetry_docs(s["_id"], X), pool)
            db.scenarios.insert_one({**s, "T": T})
            db.ground_truth.insert_many([
                {"scenario_id": s["_id"], "node_id": n, "affected": n in affected,
                 "t_affected": affected[n]["t"] if n in affected else None,
                 "parent_node": affected[n]["parent"] if n in affected else None,
                 "relation": affected[n]["relation"] if n in affected else None,
                 "path": gt_path(affected, n) if n in affected else None,
                 "fault_type": s["fault_type"], "source_node": s["source_node"]}
                for n in NODES])
            if (k + 1) % 20 == 0:
                print(f"{k + 1}/{len(specs)} scenarios, {time.time() - start:.0f}s", flush=True)

    n_docs = db.telemetry.count_documents({})
    stats = db.command("dbStats")
    print(f"done in {time.time() - start:.0f}s: {len(specs)} scenarios + normal, {n_docs} telemetry docs")
    print(f"storageSize {stats['storageSize'] / 1e6:.1f} MB, dataSize {stats['dataSize'] / 1e6:.1f} MB")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--mini", action="store_true")
    main(ap.parse_args().mini)
