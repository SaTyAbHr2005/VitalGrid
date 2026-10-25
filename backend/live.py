"""Live digital twin loop: simulator -> Atlas -> agents -> Atlas `results` -> WebSocket.

Every second the simulator inserts 28 readings into `telemetry_live`. Every 5 s the agents read the
last 60 s back from Atlas, run Perception -> Reasoning -> Verification/Path -> Explanation, and store
the result. The loop only runs while a dashboard is connected or the API was used in the last 10 min.
"""
import asyncio
import time
from collections import deque
from datetime import datetime, timezone

import numpy as np

from backend.agents import IDX, SLOPE_LAG, STRIDE, WINDOW, Perception, Reasoning, battery_level, node_features
from backend.db import get_db
from backend.explain import explain_many
from backend.rules import cause, signals, verify
from sim.simulator import METRICS, NODE_TYPE, NODES, Sim

IDLE_AFTER_S = 600
RELEASE = 0.5  # a raised alert holds while the rules confirm it and the GAT stays above this


def alert_gate(accepted, prob, raised, threshold):
    """Hysteresis on the GAT probability, as alarm systems do: an alert is raised at `threshold` and held
    down to RELEASE, so a probability hovering near the threshold doesn't make it blink every cycle.
    The rules must confirm it every cycle, so clearing a fault still drops it at once."""
    return {n for n in accepted if prob[n] >= threshold or (n in raised and prob[n] >= RELEASE)}


class LiveEngine:
    def __init__(self):
        self.sim = Sim(seed=int(time.time()))
        self.started = datetime.now(timezone.utc)
        self.perception = Perception()
        self.reasoning = Reasoning("gat_typed")
        self.r_hist = deque(maxlen=SLOPE_LAG + 1)
        self.last_active = 0.0
        self.clients = set()
        self.latest = {"status": "idle"}
        self.raised = set()  # alerts shown last cycle (see alert_gate)

    def touch(self):
        self.last_active = time.time()

    @property
    def active(self):
        return bool(self.clients) or time.time() - self.last_active < IDLE_AFTER_S

    async def run(self):
        tick = 0
        while True:
            start = time.time()
            if self.active:
                try:
                    await asyncio.to_thread(self._tick)
                    tick += 1
                    if tick % STRIDE == 0:
                        self.latest = await asyncio.to_thread(self.cycle)
                        await self._broadcast(self.latest)
                except Exception as e:  # keep the twin alive through transient Atlas/network errors
                    print(f"live loop error: {type(e).__name__}: {e}")
            await asyncio.sleep(max(0.0, 1.0 - (time.time() - start)))

    def _tick(self):
        now = datetime.now(timezone.utc)
        readings = self.sim.step()
        get_db().telemetry_live.insert_many([
            {"ts": now, "meta": {"scenario_id": "live", "node_id": n, "node_type": NODE_TYPE[n]}, **readings[n]}
            for n in NODES])

    def _window(self):
        """Latest WINDOW readings per node (one reading per simulator tick, however long the ticks took)."""
        since = self.started  # readings from an earlier run come from a different simulator state
        cur = (get_db().telemetry_live.find({"meta.scenario_id": "live", "ts": {"$gte": since}})
               .sort("ts", -1).limit(len(NODES) * WINDOW))
        rows = {n: [] for n in NODES}
        for d in reversed(list(cur)):
            n = d["meta"]["node_id"]
            rows[n].append([d[m] for m in METRICS[NODE_TYPE[n]]])
        if min(len(v) for v in rows.values()) < WINDOW:
            return None, min(len(v) for v in rows.values())
        return {n: np.array(v[-WINDOW:], dtype=np.float32) for n, v in rows.items()}, WINDOW

    def cycle(self):
        win, have = self._window()
        ts = datetime.now(timezone.utc).isoformat()
        if win is None:
            return {"ts": ts, "status": f"warming up ({have}/{WINDOW} s of telemetry)", "fault": self.sim.fault}
        r = self.perception.risk({n: w[None] for n, w in win.items()})
        self.r_hist.append(r)
        feats = node_features(r, self.r_hist[0], battery_level({n: w[None] for n, w in win.items()}))
        prob, attn = self.reasoning.predict(feats)
        s = signals(self.perception.cal, win)
        accepted = verify(s, r[0])
        self.raised = alert_gate(accepted, {n: prob[0, IDX[n]] for n in accepted}, self.raised, self.reasoning.threshold)
        alerts = [n for n in NODES if n in self.raised]
        items = [{"node": n, "node_type": NODE_TYPE[n], "path": accepted[n]["path"],
                  "cause": cause(accepted[n]["path"][0], s), "rules": accepted[n]["rules"]} for n in alerts]
        texts = dict(zip(alerts, explain_many(items))) if items else {}
        nodes = []
        for n in NODES:
            i = IDX[n]
            a = accepted.get(n)
            path = a["path"] if a else None
            nodes.append({
                "id": n, "r": round(float(r[0, i]), 3), "p": round(float(prob[0, i]), 3),
                "validated": n in alerts, "path": path, "rules": a["rules"] if a else [],
                # GAT attention along the explained path (weight each hop's target gives its source)
                "attention": [round(float(attn[0, IDX[b], IDX[a_]]), 3) for a_, b in zip(path, path[1:])] if path else [],
                "explanation": texts.get(n, {}).get("text"), "provider": texts.get(n, {}).get("provider"),
            })
        doc = {"ts": ts, "status": "live", "fault": self.sim.fault, "alerts": alerts, "nodes": nodes}
        get_db().results.insert_one({**doc, "ts": datetime.now(timezone.utc)})
        return doc

    async def _broadcast(self, doc):
        for ws in list(self.clients):
            try:
                await ws.send_json(doc)
            except Exception:
                self.clients.discard(ws)


if __name__ == "__main__":
    # alert_gate self-check: raise at the threshold, hold above RELEASE, drop when the rules stop confirming.
    p = {"A": 0.85, "B": 0.75, "C": 0.75, "D": 0.40}
    accepted = {"A": {}, "B": {}, "C": {}, "D": {}}
    assert alert_gate(accepted, p, set(), 0.8) == {"A"}                    # only A is high enough to raise
    assert alert_gate(accepted, p, {"A", "B", "D"}, 0.8) == {"A", "B"}     # B held, D below RELEASE drops
    assert alert_gate({"A": {}}, p, {"A", "B"}, 0.8) == {"A"}              # rules no longer confirm B
    print("alert_gate ok")
