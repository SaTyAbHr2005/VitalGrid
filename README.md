# VitalGrid

A neuro-symbolic digital twin for an ICU's critical infrastructure: 28 components (power chain, network, medical gases, 4 rooms of devices). It predicts which components will fail, verifies each prediction against engineering rules, and explains the failure path.

All telemetry is mock data from `sim/`, stored in MongoDB Atlas.

```
simulator ─► Atlas ─► Perception (LSTM autoencoders) ─► Reasoning (typed GAT) ─► Verification + Path (rules R1–R4)
                                                                                   └► Explanation (Gemini → Groq → template)
```

## Run locally

From this folder, with `.env` filled in (copy `.env.example`):

```bash
pip install -r backend/requirements.txt
python -m backend.seed                 # collections, indexes, graph (safe to re-run)
uvicorn backend.api:app --port 8000    # live twin + API
npm --prefix dashboard install
npm --prefix dashboard run dev         # http://localhost:5173
```

The dashboard calls `http://localhost:8000` by default. To use another port, set `VITE_API_URL` in `dashboard/.env.local`.

## Dashboard

- `/`: homepage. Scrolling plays a UPS-02 fault through the 3D building: the voltage sags, the fault spreads, the rules check it, and the alert is explained (GSAP ScrollTrigger + Lenis). It works without the backend.
- `#/twin`: 2D floor plan, fault injection, alerts, and monitor-style readouts for the selected equipment.
- `#/3d`: 3D building model of the ICU wing (three.js). Equipment sits in its rooms and dependencies run as ceiling conduits. Alarms light up rooms and failure paths, and selecting equipment flies the camera to it.
- `#/compare`: results for all methods.

The dashboard is dark by default, with a toggle for light. Visual rules (colours, type, motion, libraries) are in [design.md](design.md).

## Rebuild data and models (optional, takes about 40 min)

These steps need the training extras (`torch`, `onnx`). The models in `models/` are already trained, so you only need this to change the data or the models.

```bash
python -m sim.simulator             # self-check: every fault type propagates as designed
python -m sim.generate_dataset      # 360 scenarios + 2 h normal data into Atlas (~30 min)
python -m ml.train_lstm             # models/lstm_*.onnx + calibration.json
python -m ml.snapshots              # graph snapshots (cached in data/)
python -m ml.train_gat              # models/gat_typed.onnx, gat_untyped.onnx
python -m ml.evaluate               # results/metrics.json + Atlas `metrics`
```

## Results (`results/metrics.json`)

Each method predicts which components are failing now or will fail within 60 s, scored every 5 s.

| Split | Method | Precision | Recall | F1 | False propagation |
|---|---|---|---|---|---|
| Test (seen fault types) | Threshold only | 0.760 | 0.858 | 0.806 | 0.297 |
| | Typed GAT | 0.913 | 0.862 | 0.887 | 0.114 |
| | Rules only | 0.986 | 0.855 | 0.916 | 0.018 |
| | **GAT + rules** | **0.993** | 0.846 | 0.914 | **0.010** |
| Held-out O2 faults | Typed GAT | 0.706 | 0.566 | 0.628 | 0.306 |
| | Rules only | 0.930 | 0.816 | 0.870 | 0.097 |
| | GAT + rules | 0.919 | 0.566 | 0.700 | 0.085 |
| 2× sensor noise | Typed GAT | 0.262 | 0.931 | 0.409 | 0.756 |
| | GAT + rules | 0.923 | 0.789 | 0.851 | 0.085 |

What the numbers show:
- On seen fault types, GAT + rules has the highest precision and 78% fewer false alerts than threshold-only.
- The neural models generalise poorly to an unseen fault type and to higher noise. The rules keep the system usable in both cases.
- Typed and untyped GAT perform the same here, because each node's outgoing relation type is fixed by its node type.

## Deploy (free tier)

- **Backend:** Render Blueprint from `render.yaml`. Set `MONGODB_URI`, `GEMINI_API_KEY`, `GROQ_API_KEY` and `ALLOWED_ORIGINS` in the Render dashboard.
- **Dashboard:** Vercel, with root directory `dashboard/` and `VITE_API_URL` set to the Render URL.

## Limitations

- All data is simulated, and the propagation physics is defined by the simulator.
- The system covers one 28-node topology.
- No real patient or hospital data is used.
- The LLM only rewords alerts the rules already validated.
- The inject API is open, which is fine for a mock-data demo but not for real systems.
