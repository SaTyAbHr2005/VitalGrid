"""Loads the dataset from MongoDB Atlas into arrays, cached under data/ after the first read.

load() -> (scenarios {id: spec}, X {id: {node: array (T, n_metrics)}}, gt {id: {node: gt doc}})
Delete data/ to force a fresh read from Atlas.
"""
import pickle
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from backend.db import get_db
from sim.generate_dataset import BASE_TS
from sim.simulator import METRICS, NODE_TYPE, NODES

CACHE = Path(__file__).resolve().parent.parent / "data" / "dataset.pkl"


def _fetch(ids, T):
    db = get_db()
    X = {sid: {n: np.full((T[sid], len(METRICS[NODE_TYPE[n]])), np.nan, dtype=np.float32) for n in NODES} for sid in ids}
    for d in db.telemetry.find({"meta.scenario_id": {"$in": ids}}, {"_id": 0}, batch_size=20000):
        sid, n = d["meta"]["scenario_id"], d["meta"]["node_id"]
        t = int((d["ts"].replace(tzinfo=BASE_TS.tzinfo) - BASE_TS).total_seconds())
        X[sid][n][t] = [d[m] for m in METRICS[NODE_TYPE[n]]]
    return X


def load_normal():
    """Just the fault-free run (enough for the LSTM autoencoders): {node: array (T, n_metrics)}."""
    T = get_db().telemetry.count_documents({"meta.scenario_id": "normal", "meta.node_id": "GRID"})
    return _fetch(["normal"], {"normal": T})["normal"]


def load():
    if CACHE.exists():  # local, gitignored cache written only by this function, never downloaded
        return pickle.loads(CACHE.read_bytes())
    db = get_db()
    scenarios = {s["_id"]: s for s in db.scenarios.find()}
    normal_T = db.telemetry.count_documents({"meta.scenario_id": "normal", "meta.node_id": "GRID"})
    T = {sid: s.get("T", normal_T) for sid, s in scenarios.items()}
    ids = sorted(scenarios)
    chunks = [ids[i:i + 10] for i in range(0, len(ids), 10)]
    X = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for part in pool.map(lambda c: _fetch(c, T), chunks):
            X.update(part)
    for sid in ids:
        for n in NODES:
            missing = np.isnan(X[sid][n]).any(axis=1).sum()
            assert missing == 0, f"{sid}/{n}: {missing} missing seconds"
    gt = {sid: {} for sid in ids}
    for d in db.ground_truth.find({"scenario_id": {"$in": ids}}, {"_id": 0}):
        gt[d["scenario_id"]][d["node_id"]] = d
    incomplete = [sid for sid in ids if sid != "normal" and len(gt[sid]) != len(NODES)]
    if incomplete:  # generator still running: its newest scenario has no ground truth yet
        print(f"skipping {len(incomplete)} scenario(s) without full ground truth: {incomplete}")
        for sid in incomplete:
            scenarios.pop(sid), X.pop(sid), gt.pop(sid)
    CACHE.parent.mkdir(exist_ok=True)
    CACHE.write_bytes(pickle.dumps((scenarios, X, gt)))
    return scenarios, X, gt
