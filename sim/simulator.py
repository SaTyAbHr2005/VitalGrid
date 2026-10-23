"""Mock ICU telemetry simulator (1 Hz) with conditional fault propagation and ground truth.

Faults only spread when the physics says so: a grid outage is absorbed by the generator, a
UPS on battery only fails its devices once the battery runs out, mild sags or pressure drops
stay local. `affected` records, for every impaired node, when it failed and which edge caused it.

Run directly for a self-check of every fault type: python -m sim.simulator
"""
import numpy as np

from graph.topology import load

METRICS = {
    "power": ["voltage", "current", "battery", "temp", "freq"],
    "switch": ["latency", "packet_loss", "throughput", "link_status"],
    "environment": ["temp", "humidity", "co2", "airflow"],
    "ventilator": ["pressure", "flow", "cycle_regularity", "heartbeat"],
    "pump": ["flow_rate", "motor_current", "occlusion", "heartbeat"],
    "monitor": ["display_heartbeat", "network_heartbeat", "signal_quality"],
    "gas": ["pressure", "flow"],
}

SIGMA = {
    "voltage": 1.0, "current": 0.3, "battery": 0.1, "temp": 0.3, "freq": 0.02,
    "latency": 0.3, "packet_loss": 0.05, "throughput": 10.0, "link_status": 0.01,
    "humidity": 0.8, "co2": 15.0, "airflow": 0.03,
    "pressure": 0.4, "flow": 0.8, "cycle_regularity": 0.005, "heartbeat": 0.01,
    "flow_rate": 0.08, "motor_current": 0.02, "occlusion": 0.005,
    "display_heartbeat": 0.01, "network_heartbeat": 0.01, "signal_quality": 0.01,
}

GRAPH = load()
NODES = [n["id"] for n in GRAPH["nodes"]]
NODE_TYPE = {n["id"]: n["type"] for n in GRAPH["nodes"]}
NODE_ROOM = {n["id"]: n["room"] for n in GRAPH["nodes"]}
ROOMS = sorted({r for r in NODE_ROOM.values() if r})
RELATION = {(e["source"], e["target"]): e["relation"] for e in GRAPH["edges"]}
BATTERY_NODES = ["NET-UPS"] + [f"UPS-{r}" for r in ROOMS]
DEVICES = [n for n in NODES if NODE_TYPE[n] in ("ventilator", "pump", "monitor")]

V_FAIL = 195.0        # device power fails below this UPS output voltage
TEMP_FAIL = 30.0      # room temperature at which devices are impaired
GAS_FAIL = 40.0       # supply pressure (psi) below which ventilators are impaired

FAULTS = {
    "grid_outage": ["GRID"],                 # absorbed: ATS switches to generator
    "grid_gen_failure": ["GRID"],            # CPD lost, UPS batteries drain
    "ups_voltage_drop": [f"UPS-{r}" for r in ROOMS],
    "net_ups_failure": ["NET-UPS"],
    "switch_failure": ["SW-01"],
    "o2_pressure_drop": ["O2-SUP"],
    "air_pressure_drop": ["AIR-SUP"],
    "hvac_fault": [f"ENV-{r}" for r in ROOMS],
    "device_fault": DEVICES,
    "sensor_glitch": NODES,                  # spike only: nothing is affected
    "normal": [None],
}


class Sim:
    def __init__(self, seed=0, noise=1.0):
        self.rng = np.random.default_rng(seed)
        self.noise = noise
        self.t = 0
        # Battery runtime (s on a full charge) is fixed per run: it is what makes power cascades conditional.
        self.runtime = {b: float(self.rng.uniform(60, 900)) for b in BATTERY_NODES}
        self.drift = {(n, m): 0.0 for n in NODES for m in METRICS[NODE_TYPE[n]]}
        self.restore()

    def restore(self):
        """Clear all faults (live mode reset). Batteries recharge on their own."""
        self.grid_up = self.gen_up = True
        self.ats_source, self.switch_timer = "grid", 0.0
        if not hasattr(self, "battery"):
            self.battery = {b: 100.0 for b in BATTERY_NODES}
        self.sag = {b: 0.0 for b in BATTERY_NODES}
        self.sag_target = dict(self.sag)
        self.net_ups_failed = self.sw_failed = False
        self.temp = {r: 22.0 for r in ROOMS}
        self.hvac_rate = {r: 0.0 for r in ROOMS}
        self.gas = {"O2-SUP": 50.0, "AIR-SUP": 50.0}
        self.gas_target = dict(self.gas)
        self.device_fault = set()
        self.glitch = None
        self.fault = None
        self.affected = {}  # node -> {"t", "parent", "relation"}

    def inject(self, fault_type, node=None, severity=1.0):
        assert fault_type in FAULTS, fault_type
        if fault_type == "normal":
            return
        node = node or FAULTS[fault_type][0]
        assert node in FAULTS[fault_type], f"{fault_type} cannot start at {node}"
        self.fault = {"type": fault_type, "source": node, "t": self.t, "severity": float(severity)}
        if fault_type == "sensor_glitch":
            m = self.rng.choice(METRICS[NODE_TYPE[node]])
            self.glitch = (node, m, self.t + int(self.rng.integers(3, 6)), 15 * SIGMA[m] * self.rng.choice([-1, 1]))
            return
        self._mark(node, None)
        if fault_type == "grid_outage":
            self.grid_up = False
        elif fault_type == "grid_gen_failure":
            self.grid_up = self.gen_up = False
            self._mark("GEN", None)
        elif fault_type == "ups_voltage_drop":
            self.sag_target[node] = 10 + 50 * severity   # > 35 V sag pushes output below V_FAIL
        elif fault_type == "net_ups_failure":
            self.net_ups_failed = True
        elif fault_type == "switch_failure":
            self.sw_failed = True
        elif fault_type in ("o2_pressure_drop", "air_pressure_drop"):
            self.gas_target[node] = 50 - (3 + 17 * severity)  # drop > 10 psi impairs ventilators
        elif fault_type == "hvac_fault":
            self.hvac_rate[NODE_ROOM[node]] = 0.01 + 0.06 * severity  # degC per second
        elif fault_type == "device_fault":
            self.device_fault.add(node)

    def _mark(self, node, parent):
        if node not in self.affected:
            rel = RELATION.get((parent, node)) if parent else None
            self.affected[node] = {"t": self.t, "parent": parent, "relation": rel}

    def step(self):
        """Advance 1 s and return {node: {metric: value}}."""
        # --- power chain ---
        if self.ats_source == "grid" and not self.grid_up and self.switch_timer <= 0:
            self.switch_timer = float(self.rng.uniform(5, 10))
        if self.switch_timer > 0:
            self.switch_timer -= 1
            if self.switch_timer <= 0:
                self.ats_source = "gen" if self.gen_up else None
        if self.ats_source == "gen" and not self.gen_up:
            self.ats_source = None
        ats_out = self.ats_source is not None and self.switch_timer <= 0
        out_ok, volt = {}, {}
        for b in BATTERY_NODES:
            if ats_out:
                self.battery[b] = min(100.0, self.battery[b] + 100 / 600)
            else:
                self.battery[b] = max(0.0, self.battery[b] - 100 / self.runtime[b])
            self.sag[b] += np.clip(self.sag_target[b] - self.sag[b], -2, 2)  # sag ramps ~2 V/s
            out_ok[b] = (ats_out or self.battery[b] > 0) and not (b == "NET-UPS" and self.net_ups_failed)
            volt[b] = 230 - self.sag[b] if out_ok[b] else 0.0
        sw_up = out_ok["NET-UPS"] and not self.sw_failed
        for r in ROOMS:
            self.temp[r] += self.hvac_rate[r] if self.hvac_rate[r] else -0.05 * (self.temp[r] - 22)
        for g in self.gas:
            self.gas[g] += np.clip(self.gas_target[g] - self.gas[g], -0.5, 0.5)

        # --- ground truth (order matters: parents before children) ---
        if self.ats_source is None and self.switch_timer <= 0:
            self._mark("ATS", "GRID")
        if not ats_out and "ATS" in self.affected:
            self._mark("CPD", "ATS")
        for b in BATTERY_NODES:
            if not out_ok[b] and "CPD" in self.affected:
                self._mark(b, "CPD")
        if not sw_up and "NET-UPS" in self.affected:
            self._mark("SW-01", "NET-UPS")
        for d in DEVICES:
            r, kind = NODE_ROOM[d], NODE_TYPE[d]
            causes = [
                (volt[f"UPS-{r}"] < V_FAIL, f"UPS-{r}"),
                (not sw_up, "SW-01"),
                (self.temp[r] >= TEMP_FAIL, f"ENV-{r}"),
                (kind == "ventilator" and self.gas["O2-SUP"] < GAS_FAIL, "O2-SUP"),
                (kind == "ventilator" and self.gas["AIR-SUP"] < GAS_FAIL, "AIR-SUP"),
            ]
            parent = next((p for bad, p in causes if bad), None)
            if parent:
                self._mark(d, parent)

        readings = self._readings(ats_out, out_ok, volt, sw_up)
        self.t += 1
        return readings

    def _readings(self, ats_out, out_ok, volt, sw_up):
        gen_running = self.ats_source == "gen"
        v = {}
        for n in ("GRID", "GEN", "ATS", "CPD"):
            up = {"GRID": self.grid_up, "GEN": self.gen_up}.get(n, ats_out)
            feeding = {"GRID": self.ats_source == "grid", "GEN": gen_running}.get(n, ats_out)
            v[n] = {"voltage": 230.0 if up else 0.0, "current": 40.0 if feeding and up else 0.0, "battery": 100.0,
                    "temp": 30.0 + (20.0 if n == "GEN" and gen_running else 0.0), "freq": 50.0 if up else 0.0}
        for b in BATTERY_NODES:
            v[b] = {"voltage": volt[b], "current": 5.0 if out_ok[b] else 0.0, "battery": self.battery[b],
                    "temp": 35.0 + (5.0 if not ats_out else 0.0), "freq": 50.0 if out_ok[b] else 0.0}
        v["SW-01"] = ({"latency": 2.0, "packet_loss": 0.1, "throughput": 800.0, "link_status": 1.0} if sw_up
                      else {"latency": 1000.0, "packet_loss": 100.0, "throughput": 0.0, "link_status": 0.0})
        for r in ROOMS:
            t = self.temp[r]
            v[f"ENV-{r}"] = {"temp": t, "humidity": 45.0 - 0.5 * (t - 22), "co2": 600.0,
                             "airflow": 0.2 if self.hvac_rate[r] else 1.0}
            powered = volt[f"UPS-{r}"] >= V_FAIL
            hb = 1.0 if sw_up and powered else 0.0
            heat = max(0.0, t - 26)
            gas = min(1.0, self.gas["O2-SUP"] / 50) * min(1.0, self.gas["AIR-SUP"] / 50)
            vent = {"pressure": 20.0 * gas, "flow": 30.0 * gas, "cycle_regularity": 0.98 - 0.05 * heat, "heartbeat": hb}
            pump = {"flow_rate": 5.0, "motor_current": 0.5 + 0.05 * heat, "occlusion": 0.01, "heartbeat": hb}
            mon = {"display_heartbeat": 1.0, "network_heartbeat": hb, "signal_quality": 0.95 - 0.03 * heat}
            if f"VENT-{r}" in self.device_fault:
                vent.update(pressure=5.0, flow=5.0, cycle_regularity=0.5)
            if f"PUMP-{r}" in self.device_fault:
                pump.update(flow_rate=0.0, motor_current=1.2, occlusion=1.0)
            if f"MON-{r}" in self.device_fault:
                mon.update(display_heartbeat=0.0, signal_quality=0.3)
            if not powered:
                vent = {k: 0.0 for k in vent}
                pump = {k: 0.0 for k in pump}
                mon = {k: 0.0 for k in mon}
            v[f"VENT-{r}"], v[f"PUMP-{r}"], v[f"MON-{r}"] = vent, pump, mon
        for g in self.gas:
            v[g] = {"pressure": self.gas[g], "flow": 100.0 * self.gas[g] / 50}

        # noise + slow drift (mean-reverting random walk)
        for n, metrics in v.items():
            for m in metrics:
                s = SIGMA[m] * self.noise
                d = self.drift[(n, m)] = 0.98 * self.drift[(n, m)] + 0.2 * s * self.rng.standard_normal()
                metrics[m] = float(metrics[m] + d + s * self.rng.standard_normal())
        if self.glitch and self.t < self.glitch[2]:
            n, m, _, delta = self.glitch
            v[n][m] += delta
        return v


def run_scenario(fault_type, source, severity, t_inject, T=300, seed=0, noise=1.0):
    """Returns ({node: array (T, n_metrics)}, affected dict)."""
    sim = Sim(seed, noise)
    X = {n: np.zeros((T, len(METRICS[NODE_TYPE[n]])), dtype=np.float32) for n in NODES}
    for t in range(T):
        if t == t_inject:
            sim.inject(fault_type, source, severity)
        r = sim.step()
        for n in NODES:
            X[n][t] = [r[n][m] for m in METRICS[NODE_TYPE[n]]]
    return X, sim.affected


def gt_path(affected, node):
    """Ground-truth causal chain [source, ..., node] following parent links."""
    path = [node]
    while affected[path[0]]["parent"]:
        path.insert(0, affected[path[0]]["parent"])
    return path


if __name__ == "__main__":
    def got(ft, src, sev, seed=1):
        return set(run_scenario(ft, src, sev, 60, T=300, seed=seed)[1])

    room = lambda r: {f"VENT-{r}", f"MON-{r}", f"PUMP-{r}"}
    assert got("normal", None, 0) == set()
    assert got("sensor_glitch", "UPS-01", 1) == set()
    assert got("grid_outage", "GRID", 1) == {"GRID"}
    assert got("ups_voltage_drop", "UPS-02", 1.0) == {"UPS-02"} | room("02")
    assert got("ups_voltage_drop", "UPS-02", 0.0) == {"UPS-02"}
    assert got("switch_failure", "SW-01", 1) == {"SW-01"} | set(DEVICES)
    assert got("net_ups_failure", "NET-UPS", 1) == {"NET-UPS", "SW-01"} | set(DEVICES)
    assert got("o2_pressure_drop", "O2-SUP", 1.0) == {"O2-SUP"} | {f"VENT-{r}" for r in ROOMS}
    assert got("o2_pressure_drop", "O2-SUP", 0.0) == {"O2-SUP"}
    assert got("hvac_fault", "ENV-03", 1.0) == {"ENV-03"} | room("03")
    assert got("hvac_fault", "ENV-03", 0.0) == {"ENV-03"}
    assert got("device_fault", "PUMP-04", 1) == {"PUMP-04"}

    # Grid + generator failure: which rooms fail depends on each battery's runtime.
    sim_seed = 3
    X, aff = run_scenario("grid_gen_failure", "GRID", 1, 60, T=300, seed=sim_seed)
    runtime = Sim(sim_seed).runtime
    for b in BATTERY_NODES:
        assert (b in aff) == (runtime[b] < 240), (b, runtime[b], b in aff)
    assert {"GRID", "GEN", "ATS", "CPD"} <= set(aff)
    for d in DEVICES:
        if d in aff:
            assert gt_path(aff, d)[0] == "GRID", gt_path(aff, d)
    print("ok: grid_gen_failure affected", sorted(aff))
    print("ok: all fault types propagate as designed")
