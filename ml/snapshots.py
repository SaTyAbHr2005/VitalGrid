"""Builds one graph snapshot every 5 s per scenario: node risk from the ONNX LSTMs, GAT features, labels.

build() -> {scenario_id: {"t": (S,), "r": (S, N), "feats": (S, N, F), "y": (S, N)}}, cached in data/.
A node's label is 1 if it is affected now or within the next HORIZON seconds.
"""
import pickle

import numpy as np

from backend.agents import HORIZON, IDX, SLOPE_LAG, STRIDE, WINDOW, Perception, battery_level, node_features
from ml.data import CACHE, load
from sim.simulator import NODES

SNAP_CACHE = CACHE.with_name("snapshots.pkl")


def snapshot_times(T):
    return np.arange(WINDOW, T + 1, STRIDE)


def build(force=False):
    if SNAP_CACHE.exists() and not force:  # local cache written only by this function
        return pickle.loads(SNAP_CACHE.read_bytes())
    scenarios, X, gt = load()
    perception = Perception()
    out = {}
    for sid, spec in scenarios.items():
        if sid == "normal":
            continue
        ts = snapshot_times(spec["T"])
        win = {n: np.stack([X[sid][n][t - WINDOW:t] for t in ts]) for n in NODES}
        r = perception.risk(win)
        r_prev = r[np.maximum(np.arange(len(ts)) - SLOPE_LAG, 0)]
        feats = node_features(r, r_prev, battery_level(win))
        y = np.zeros((len(ts), len(NODES)), dtype=np.float32)
        for n, d in gt[sid].items():
            if d["affected"]:
                y[:, IDX[n]] = d["t_affected"] < ts + HORIZON
        out[sid] = {"t": ts, "r": r, "feats": feats, "y": y}
    SNAP_CACHE.write_bytes(pickle.dumps(out))
    return out


if __name__ == "__main__":
    snaps = build(force=True)
    y = np.concatenate([s["y"].ravel() for s in snaps.values()])
    print(f"{len(snaps)} scenarios, {len(y)} node-snapshots, positive rate {y.mean():.2%}")
