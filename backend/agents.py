"""Perception and Reasoning agents (ONNX inference) plus the shared feature code.

Used both by ml/evaluate.py (offline, many snapshots at once) and the live backend (one snapshot
every 5 s), so the numbers in the results tables come from exactly the deployed code path.
"""
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort

from sim.simulator import GRAPH, METRICS, NODE_TYPE, NODES

MODELS = Path(__file__).resolve().parent.parent / "models"
WINDOW, STRIDE, HORIZON = 60, 5, 60      # seconds
SLOPE_LAG = 6                            # snapshots (30 s) used for the risk trend feature
TYPES = GRAPH["node_types"]
RELATIONS = GRAPH["relations"]
IDX = {n: i for i, n in enumerate(NODES)}
CRIT = np.array([n["criticality"] for n in GRAPH["nodes"]], dtype=np.float32) / 3
TYPE_ONEHOT = np.eye(len(TYPES), dtype=np.float32)[[TYPES.index(NODE_TYPE[n]) for n in NODES]]
N_FEATURES = 4 + len(TYPES)


def adjacency():
    """rel[i, j] = relation index for edge j -> i (risk flows from j to i), len(RELATIONS) on the diagonal, -1 otherwise."""
    rel = np.full((len(NODES), len(NODES)), -1, dtype=np.int64)
    for e in GRAPH["edges"]:
        rel[IDX[e["target"]], IDX[e["source"]]] = RELATIONS.index(e["relation"])
    np.fill_diagonal(rel, len(RELATIONS))
    return rel


def zscore(cal, node, arr):
    c = cal["nodes"][node]
    return np.clip((arr - np.array(c["mean"])) / np.array(c["std"]), -20, 20).astype(np.float32)


def risk_from_error(err, p999):
    """sigmoid(2 ln(err / p999)): 0.5 at the 99.9th percentile of normal error, -> 1 for clear anomalies."""
    e2 = np.square(err)
    return (e2 / (e2 + p999 ** 2)).astype(np.float32)


def node_features(r, r_prev, battery):
    """(S, N) risk, risk 30 s earlier, battery fraction -> (S, N, N_FEATURES)."""
    S = r.shape[0]
    return np.concatenate([
        r[..., None], (r - r_prev)[..., None], battery[..., None],
        np.broadcast_to(CRIT[None, :, None], (S, len(NODES), 1)),
        np.broadcast_to(TYPE_ONEHOT[None], (S, len(NODES), len(TYPES))),
    ], axis=-1).astype(np.float32)


def battery_level(X_tail):
    """Median battery over the last 10 s for power nodes, 1.0 for everything else. X_tail: {node: (..., t, F)}."""
    out = []
    for n in NODES:
        if NODE_TYPE[n] == "power":
            out.append(np.median(X_tail[n][..., -10:, METRICS["power"].index("battery")], axis=-1) / 100)
        else:
            out.append(np.ones(X_tail[n].shape[:-2], dtype=np.float32))
    return np.stack(out, axis=-1).astype(np.float32)


class Perception:
    """LSTM autoencoder per node type -> node risk r(v) in [0, 1]."""

    def __init__(self):
        self.cal = json.loads((MODELS / "calibration.json").read_text())
        self.sess = {t: ort.InferenceSession(str(MODELS / f"lstm_{t}.onnx"), providers=["CPUExecutionProvider"])
                     for t in TYPES}

    def risk(self, windows):
        """windows: {node: (S, WINDOW, F) raw values} -> r: (S, N)."""
        r = np.zeros((next(iter(windows.values())).shape[0], len(NODES)), dtype=np.float32)
        for t in TYPES:
            nodes = [n for n in NODES if NODE_TYPE[n] == t]
            x = np.concatenate([zscore(self.cal, n, windows[n]) for n in nodes])
            err = self.sess[t].run(None, {"x": x})[0].reshape(len(nodes), -1)
            for k, n in enumerate(nodes):
                r[:, IDX[n]] = risk_from_error(err[k], self.cal["types"][t]["p999"])
        return r


class Reasoning:
    """Typed (or untyped) GAT over the 28-node graph -> P(node affected within HORIZON)."""

    def __init__(self, name="gat_typed"):
        self.sess = ort.InferenceSession(str(MODELS / f"{name}.onnx"), providers=["CPUExecutionProvider"])
        self.threshold = json.loads((MODELS / f"{name}.json").read_text())["threshold"]

    def predict(self, feats):
        """feats (S, N, F) -> (prob (S, N), attention (S, N, N) averaged over heads; attn[i, j] = weight of j for i)."""
        prob, attn = self.sess.run(None, {"x": feats})
        return prob, attn
