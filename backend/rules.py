"""Verification agent (neuro-symbolic rules) and Path agent.

R1 reachability   a node is only at risk if a valid dependency path reaches it from a root source
R2 evidence       a root must show relation-relevant physical evidence (dead/sagging/draining power,
                  lost link, temperature or gas pressure projected past its tolerance within HORIZON)
R3 gating         redundancy and backup block propagation: the ATS is safe while the other feed is
                  healthy, a UPS is safe while its battery outlasts HORIZON
R4 persistence    the root's anomaly must hold for most of the last 10 s (median z-score > 4), which
                  rejects short sensor glitches

All checks read raw telemetry, never the neural outputs, so they act as an independent verifier.
"""
import numpy as np

from backend.agents import HORIZON, IDX, zscore
from sim.simulator import BATTERY_NODES, GAS_FAIL, GRAPH, METRICS, NODE_TYPE, NODES, TEMP_FAIL, V_FAIL

Z_PERSIST = 4.0
PARENTS = {n: [] for n in NODES}
for _e in GRAPH["edges"]:
    PARENTS[_e["target"]].append((_e["source"], _e["relation"]))


def _topo_order():
    order, seen = [], set()

    def visit(n):
        if n not in seen:
            seen.add(n)
            for p, _ in PARENTS[n]:
                visit(p)
            order.append(n)
    for n in NODES:
        visit(n)
    return order


TOPO = _topo_order()
ANCESTORS = {}
for _n in TOPO:
    ANCESTORS[_n] = set().union(*[{p} | ANCESTORS[p] for p, _ in PARENTS[_n]]) if PARENTS[_n] else set()


def signals(cal, tail):
    """tail: {node: (>=20, F) raw values, most recent last} -> {node: {"med", "slope", "z"}}."""
    out = {}
    for n in NODES:
        a = tail[n]
        med = np.median(a[-10:], axis=0)
        slope = (med - np.median(a[-20:-10], axis=0)) / 10
        z = float(np.max(np.abs(np.median(zscore(cal, n, a[-10:]), axis=0))))
        names = METRICS[NODE_TYPE[n]]
        out[n] = {"med": dict(zip(names, med)), "slope": dict(zip(names, slope)), "z": z}
    return out


def _projected(s, metric):
    return s["med"][metric] + s["slope"][metric] * HORIZON


def draining(s):
    b, bs = s["med"]["battery"], s["slope"]["battery"]
    return bs < -0.05 and b / -bs < HORIZON


def evidence(n, s):
    """R2: relation-relevant physical evidence that a failure at n will propagate."""
    s = s[n]
    t = NODE_TYPE[n]
    if t == "power":
        v = s["med"]["voltage"]
        return v < V_FAIL or (v < V_FAIL + 10 and _projected(s, "voltage") < V_FAIL) or draining(s)
    if t == "switch":
        return s["med"]["link_status"] < 0.5 or s["med"]["packet_loss"] > 20
    if t == "environment":
        temp = s["med"]["temp"]
        return temp >= TEMP_FAIL or (temp > TEMP_FAIL - 3 and _projected(s, "temp") >= TEMP_FAIL)
    if t == "gas":
        p = s["med"]["pressure"]
        return p < GAS_FAIL or (p < GAS_FAIL + 3 and _projected(s, "pressure") < GAS_FAIL)
    return False  # devices have no dependants


def gated(src, dst, s):
    """R3: True if redundancy or backup stops a failure at src from reaching dst."""
    if dst == "ATS":
        other = "GEN" if src == "GRID" else "GRID"
        return s[other]["med"]["voltage"] >= V_FAIL + 10
    if dst in BATTERY_NODES:
        return not evidence(dst, s)
    return False


def propagate(roots, edge_ok, r):
    """Shared path builder. Walks the DAG in topological order from `roots`; each reached node keeps
    the reachable parent with the highest risk. Returns {node: path [root, ..., node]}."""
    paths = {}
    for n in TOPO:
        cands = [p for p, _ in PARENTS[n] if p in paths and edge_ok(p, n)]
        if cands:
            p = max(cands, key=lambda c: r[IDX[c]])
            paths[n] = paths[p] + [n]
        elif n in roots:
            paths[n] = [n]
    return paths


def verify(s, r):
    """Verification + Path agents. Returns {node: {"path": [...], "rules": [...]}} for every accepted node."""
    persistent = {n for n in NODES if s[n]["z"] > Z_PERSIST}                       # R4
    roots = {n for n in persistent if evidence(n, s)}                               # R2 + R4
    paths = propagate(roots, lambda p, n: not gated(p, n, s), r)                    # R1 + R3
    accepted = {}
    for n, path in paths.items():
        accepted[n] = {"path": path, "rules": ["R1", "R2", "R3", "R4"]}
    for n in persistent - set(paths):
        # Abnormal but no validated cause reaches it. Accept it as a local fault only if nothing upstream
        # is abnormal too; otherwise it is reacting within tolerance (a UPS covering a power blip, a
        # ventilator under a mild supply drop). A generator running while the grid is down is backup
        # working as designed.
        explained = bool(ANCESTORS[n] & persistent) or (n == "GEN" and "GRID" in persistent)
        if not explained:
            accepted[n] = {"path": [n], "rules": ["R4"]}
    return accepted


def cause(root, s):
    """Coarse, number-free description of the root's evidence (stable enough to cache explanations on)."""
    t, m = NODE_TYPE[root], s[root]["med"]
    if t == "power":
        if m["voltage"] < 20:
            return f"{root} has lost power output"
        if m["voltage"] < V_FAIL:
            return f"{root} output voltage has fallen below the {V_FAIL:.0f} V device tolerance"
        if draining(s[root]):
            return f"{root} is running on battery that will be empty within {HORIZON} s"
        return f"{root} output voltage is sagging toward the {V_FAIL:.0f} V device tolerance"
    if t == "switch":
        return f"{root} network link is down"
    if t == "environment":
        return f"{root} temperature is rising past the {TEMP_FAIL:.0f} C equipment limit"
    if t == "gas":
        return f"{root} supply pressure is falling below the {GAS_FAIL:.0f} psi ventilator minimum"
    return f"{root} readings are persistently abnormal (local device fault)"


def ungated_paths(r, tau=0.5):
    """Path builder for the neural-only baselines: reachability from every node with r >= tau, no rules."""
    anomalous = {n for n in NODES if r[IDX[n]] >= tau}
    return propagate(anomalous, lambda p, n: True, r)
