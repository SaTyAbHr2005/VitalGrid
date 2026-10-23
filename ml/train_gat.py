"""Trains the dense typed GAT (and the untyped ablation) on graph snapshots, exports ONNX.

Usage (from repo root): python -m ml.train_gat
Writes models/gat_typed.onnx|json and models/gat_untyped.onnx|json (json holds the val-tuned threshold).
"""
import json

import numpy as np
import onnxruntime as ort
import torch
from torch import nn
from torch.nn import functional as F

from backend.agents import MODELS, N_FEATURES, RELATIONS, adjacency
from ml.data import load
from ml.snapshots import build

torch.manual_seed(0)
DEV = "cuda" if torch.cuda.is_available() else "cpu"


class GATLayer(nn.Module):
    """GATv2-style attention on a fixed dense graph; each relation type adds a learned bias to the attention input."""

    def __init__(self, fin, fout, heads, n_rel, concat):
        super().__init__()
        self.h, self.d, self.concat = heads, fout, concat
        self.ws = nn.Linear(fin, heads * fout, bias=False)
        self.wd = nn.Linear(fin, heads * fout, bias=False)
        self.rel = nn.Embedding(n_rel, heads * fout)
        self.a = nn.Parameter(torch.randn(heads, fout) * 0.1)

    def forward(self, x, rel, mask):
        B, N, _ = x.shape
        hs = self.ws(x).view(B, N, self.h, self.d)
        hd = self.wd(x).view(B, N, self.h, self.d)
        r = self.rel(rel).view(N, N, self.h, self.d)
        e = F.leaky_relu(hd[:, :, None] + hs[:, None, :] + r[None], 0.2)          # B, i, j, H, D
        logits = (e * self.a).sum(-1).masked_fill(~mask[None, :, :, None], -1e9)  # B, i, j, H
        att = torch.softmax(logits, dim=2)
        out = torch.einsum("bijh,bjhd->bihd", att, hs)
        out = out.reshape(B, N, -1) if self.concat else out.mean(2)
        return out, att.mean(-1)


class GAT(nn.Module):
    def __init__(self, typed, hid=32, heads=4):
        super().__init__()
        rel = torch.tensor(adjacency())
        mask = rel >= 0
        if not typed:  # ablation: every edge looks the same, self-loop keeps its own id
            rel = (rel == len(RELATIONS)).long()
        self.register_buffer("rel", rel.clamp(min=0))
        self.register_buffer("mask", mask)
        n_rel = len(RELATIONS) + 1 if typed else 2
        self.l1 = GATLayer(N_FEATURES, hid, heads, n_rel, concat=True)
        self.l2 = GATLayer(hid * heads, hid, heads, n_rel, concat=False)
        self.head = nn.Linear(hid + N_FEATURES, 1)

    def forward(self, x):
        h, a1 = self.l1(x, self.rel, self.mask)
        h, a2 = self.l2(F.elu(h), self.rel, self.mask)
        logit = self.head(torch.cat([F.elu(h), x], -1)).squeeze(-1)
        return logit, (a1 + a2) / 2


class Exported(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, x):
        logit, att = self.m(x)
        return torch.sigmoid(logit), att


def stack(snaps, ids):
    return (torch.tensor(np.concatenate([snaps[s]["feats"] for s in ids])),
            torch.tensor(np.concatenate([snaps[s]["y"] for s in ids])))


def best_threshold(prob, y):
    best = (0.0, 0.5)
    for th in np.arange(0.05, 0.96, 0.05):
        p = prob >= th
        tp = (p & (y == 1)).sum()
        f1 = 2 * tp / max(p.sum() + (y == 1).sum(), 1)
        best = max(best, (f1, float(th)))
    return best


def train(name, typed, snaps, split):
    xtr, ytr = stack(snaps, split["train"])
    xva, yva = stack(snaps, split["val"])
    model = GAT(typed).to(DEV)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-4)
    pos_weight = torch.tensor((ytr == 0).sum() / max((ytr == 1).sum(), 1), device=DEV)
    xtr, ytr, xva_d = xtr.to(DEV), ytr.to(DEV), xva.to(DEV)
    best = (-1, None, 0.5)
    for epoch in range(60):
        model.train()
        perm = torch.randperm(len(xtr), device=DEV)
        for i in range(0, len(xtr), 128):
            idx = perm[i:i + 128]
            logit, _ = model(xtr[idx])
            loss = F.binary_cross_entropy_with_logits(logit, ytr[idx], pos_weight=pos_weight)
            opt.zero_grad()
            loss.backward()
            opt.step()
        model.eval()
        with torch.no_grad():
            prob = torch.sigmoid(model(xva_d)[0]).cpu().numpy()
        f1, th = best_threshold(prob, yva.numpy())
        if f1 > best[0]:
            best = (f1, {k: v.detach().clone() for k, v in model.state_dict().items()}, th)
    model.load_state_dict(best[1])
    model = model.cpu().eval()
    exp = Exported(model)
    path = MODELS / f"{name}.onnx"
    torch.onnx.export(exp, xva[:2], str(path), input_names=["x"], output_names=["prob", "attn"],
                      dynamic_axes={"x": {0: "b"}, "prob": {0: "b"}, "attn": {0: "b"}}, opset_version=17, dynamo=False)
    onnx_prob = ort.InferenceSession(str(path)).run(None, {"x": xva[:300].numpy()})[0]
    with torch.no_grad():
        torch_prob = exp(xva[:300])[0].numpy()
    assert np.allclose(onnx_prob, torch_prob, atol=1e-4), "ONNX/PyTorch mismatch"
    (MODELS / f"{name}.json").write_text(json.dumps({"threshold": best[2], "val_f1": best[0]}))
    print(f"{name}: val F1={best[0]:.3f} at threshold {best[2]:.2f}; ONNX parity ok")


def main():
    scenarios, _, _ = load()
    snaps = build()
    split = {k: [s for s, v in scenarios.items() if v["split"] == k] for k in ("train", "val")}
    if not split["val"]:  # partial dataset (generator still running): borrow a few train scenarios
        split["val"], split["train"] = split["train"][-20:], split["train"][:-20]
        print("no val scenarios yet: provisional model, using 20 train scenarios for validation")
    train("gat_typed", True, snaps, split)
    train("gat_untyped", False, snaps, split)


if __name__ == "__main__":
    main()
