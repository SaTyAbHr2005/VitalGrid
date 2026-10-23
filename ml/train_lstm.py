"""Trains one LSTM autoencoder per node type on fault-free data, calibrates r(v), exports ONNX.

Usage (from repo root): python -m ml.train_lstm
Writes models/lstm_<type>.onnx and models/calibration.json.
"""
import json

import numpy as np
import onnxruntime as ort
import torch
from torch import nn

from backend.agents import MODELS, STRIDE, TYPES, WINDOW, risk_from_error, zscore
from ml.data import load_normal
from sim.simulator import NODE_TYPE, NODES

torch.manual_seed(0)
DEV = "cuda" if torch.cuda.is_available() else "cpu"


class LSTMAE(nn.Module):
    def __init__(self, f, h=32):
        super().__init__()
        self.enc = nn.LSTM(f, h, batch_first=True)
        self.dec = nn.LSTM(h, h, batch_first=True)
        self.out = nn.Linear(h, f)

    def forward(self, x):
        _, (h, _) = self.enc(x)
        y, _ = self.dec(h[-1].unsqueeze(1).expand(-1, x.shape[1], -1).contiguous())
        return self.out(y)


class ErrorHead(nn.Module):
    """Exported graph: z-scored window (B, 60, F) -> mean squared reconstruction error (B,)."""

    def __init__(self, ae):
        super().__init__()
        self.ae = ae

    def forward(self, x):
        return ((self.ae(x) - x) ** 2).mean(dim=(1, 2))


def windows(arr, stride=STRIDE):
    idx = np.arange(0, len(arr) - WINDOW + 1, stride)
    return np.stack([arr[i:i + WINDOW] for i in idx])


def main():
    MODELS.mkdir(exist_ok=True)
    normal = load_normal()
    split = int(0.8 * len(normal["GRID"]))
    cal = {"nodes": {}, "types": {}}
    for n in NODES:
        a = normal[n][:split]
        std = np.maximum(a.std(0), np.maximum(1e-3, 0.01 * np.abs(a.mean(0))))
        cal["nodes"][n] = {"mean": a.mean(0).tolist(), "std": std.tolist()}

    for t in TYPES:
        nodes = [n for n in NODES if NODE_TYPE[n] == t]
        tr = np.concatenate([windows(zscore(cal, n, normal[n][:split]), 2) for n in nodes])
        va = np.concatenate([windows(zscore(cal, n, normal[n][split:])) for n in nodes])
        model = LSTMAE(tr.shape[-1]).to(DEV)
        opt = torch.optim.Adam(model.parameters(), lr=2e-3)
        xt = torch.tensor(tr, device=DEV)
        for epoch in range(40):
            perm = torch.randperm(len(xt), device=DEV)
            for i in range(0, len(xt), 256):
                b = xt[perm[i:i + 256]]
                loss = ((model(b) - b) ** 2).mean()
                opt.zero_grad()
                loss.backward()
                opt.step()
        head = ErrorHead(model).eval()
        with torch.no_grad():
            err = head(torch.tensor(va, device=DEV)).cpu().numpy()
        p999 = float(np.quantile(err, 0.999))
        cal["types"][t] = {"p999": p999, "p50": float(np.median(err))}

        path = MODELS / f"lstm_{t}.onnx"
        head.cpu()
        torch.onnx.export(head, torch.tensor(va[:2]), str(path), input_names=["x"], output_names=["err"],
                          dynamic_axes={"x": {0: "b"}, "err": {0: "b"}}, opset_version=17, dynamo=False)
        # parity: ONNX must match PyTorch
        onnx_err = ort.InferenceSession(str(path)).run(None, {"x": va[:200]})[0]
        with torch.no_grad():
            torch_err = head(torch.tensor(va[:200])).numpy()
        assert np.allclose(onnx_err, torch_err, rtol=1e-3, atol=1e-5), "ONNX/PyTorch mismatch"
        r = risk_from_error(err, p999)
        print(f"{t:12s} windows train={len(tr):6d} val={len(va):5d} final loss={loss.item():.4f} "
              f"p50={np.median(err):.4f} p999={p999:.4f} val r>0.5: {np.mean(r > 0.5):.2%}")

    (MODELS / "calibration.json").write_text(json.dumps(cal))
    print("saved", sorted(p.name for p in MODELS.iterdir()))


if __name__ == "__main__":
    main()
