import { useEffect, useRef, useState } from "react";
import * as Select from "@radix-ui/react-select";
import * as Slider from "@radix-ui/react-slider";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { API_URL } from "./api.js";
import { RELATION_STYLE, nodeState, stateColor } from "./twin.js";

const PROVIDER = { gemini: "Gemini", groq: "Groq", template: "Rule template" };

// Why an active fault has no validated alert. The rules in backend/rules.py decide; this names the one that applies.
function noAlertReason(live) {
  const f = live?.fault;
  if (!f || f.type === "normal") return "No validated alerts. Cause a fault below to watch it spread through the ICU.";
  const r = live.nodes?.find((n) => n.id === f.source)?.r;
  const seen = r >= 0.7 ? `The anomaly model flagged ${f.source} (risk ${r.toFixed(2)}), but the` : "The";
  if (f.type === "sensor_glitch")
    return `${seen} rules rejected it as a sensor glitch. The spike lasted only a few seconds, and rule R4 needs an anomaly to hold for most of the last 10 s. No equipment actually failed, so nothing downstream is at risk.`;
  return `${seen} rules have not confirmed the ${faultLabel(f.type).toLowerCase()} at ${f.source} yet. A real fault takes 15 to 30 s to push readings past their safety limits (rule R2) and hold there for 10 s (rule R4).`;
}

export function Alerts({ live, onSelect }) {
  const alerts = (live?.nodes || []).filter((n) => n.validated).sort((a, b) => b.p - a.p);
  if (live?.status && live.status !== "live") return <p className="empty">{live.status}</p>;
  if (!alerts.length) return <p className="empty">{noAlertReason(live)}</p>;
  return alerts.map((n) => (
    <div className="alert" key={n.id}>
      <div className="head">
        <button className="btn quiet" style={{ padding: "0 6px" }} onClick={() => onSelect(n.id)}>{n.id}</button>
        <span className="risk">{Math.round(n.p * 100)}% risk</span>
      </div>
      <p>{n.explanation}</p>
      {n.path?.length > 1 && (
        <div className="chain">
          Path: {n.path.join(" → ")}
          {n.attention?.length > 0 && <> (attention {n.attention.map((a) => a.toFixed(2)).join(", ")})</>}
        </div>
      )}
      <div className="meta">
        Rules passed: {n.rules.join(", ")}
        <span className="tag">{PROVIDER[n.provider] || "Rule template"}</span>
      </div>
    </div>
  ));
}

export const FAULT_LABEL = {
  grid_outage: "Grid outage", grid_gen_failure: "Grid and generator failure", ups_voltage_drop: "UPS voltage drop",
  net_ups_failure: "Network UPS failure", switch_failure: "Network switch failure", o2_pressure_drop: "Oxygen pressure drop",
  air_pressure_drop: "Medical air pressure drop", hvac_fault: "Air-conditioning fault", device_fault: "Device fault",
  sensor_glitch: "Sensor glitch", normal: "No fault",
};
export const faultLabel = (t) => FAULT_LABEL[t] || t.replaceAll("_", " ");

function Choice({ id, value, onChange, items, label }) {
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger id={id} className="sel" aria-label={label}>
        <Select.Value placeholder="Choose…" />
        <Select.Icon className="sel-icon">▾</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="sel-menu" position="popper" sideOffset={4}>
          <Select.Viewport>
            {items.map(([v, l]) => (
              <Select.Item key={v} value={v} className="sel-item"><Select.ItemText>{l}</Select.ItemText></Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export function Inject({ faults, onChange }) {
  const types = Object.keys(faults || {}).filter((t) => t !== "normal");
  const [type, setType] = useState("ups_voltage_drop");
  const [node, setNode] = useState("");
  const [severity, setSeverity] = useState(0.8);
  const [msg, setMsg] = useState("");
  const nodes = faults?.[type] || [];
  useEffect(() => setNode(nodes[0] || ""), [type, faults]); // eslint-disable-line react-hooks/exhaustive-deps

  async function post(path, body) {
    const r = await fetch(`${API_URL}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail?.[0]?.msg || j.detail || r.status);
    return j;
  }

  return (
    <div className="inject">
      <h2>Cause a fault</h2>
      <label htmlFor="ft">Fault</label>
      <Choice id="ft" label="Fault" value={type} onChange={setType} items={types.map((t) => [t, faultLabel(t)])} />
      <label htmlFor="fn">Starts at</label>
      <Choice id="fn" label="Starts at" value={node} onChange={setNode} items={nodes.map((n) => [n, n])} />
      <label htmlFor="sev">Severity {severity.toFixed(2)}</label>
      <Slider.Root id="sev" className="sld" min={0} max={1} step={0.05} value={[severity]} onValueChange={([v]) => setSeverity(v)}>
        <Slider.Track className="sld-track"><Slider.Range className="sld-range" /></Slider.Track>
        <Slider.Thumb className="sld-thumb" aria-label="Severity" />
      </Slider.Root>
      <div className="actions">
        <button className="btn" disabled={!node}
          onClick={() => post("/inject", { fault_type: type, node_id: node, severity })
            .then((j) => { setMsg(`Fault injected: ${faultLabel(type).toLowerCase()} at ${node}.`); onChange(j.fault); })
            .catch((e) => setMsg(`The fault was not injected: ${e.message}`))}>Inject fault</button>
        <button className="btn quiet"
          onClick={() => post("/reset").then(() => { setMsg("All faults cleared. Batteries recharge over the next few minutes."); onChange(null); })
            .catch((e) => setMsg(`Faults were not cleared: ${e.message}`))}>Clear faults</button>
      </div>
      {msg && <p className="empty" style={{ marginTop: 8 }}>{msg}</p>}
    </div>
  );
}

const UNIT = { voltage: "V", current: "A", battery: "%", temp: "°C", freq: "Hz", humidity: "%", co2: "ppm", latency: "ms" };

// A bedside-monitor style trace: no axes, just the waveform.
function Trace({ xs, ys, color }) {
  const box = useRef(null), plot = useRef(null);
  useEffect(() => {
    const el = box.current;
    plot.current = new uPlot({
      width: el.clientWidth, height: 40, legend: { show: false }, cursor: { show: false },
      scales: { x: { time: false } }, axes: [{ show: false }, { show: false }],
      series: [{}, { stroke: color, width: 1.5, points: { show: false } }],
    }, [[], []], el);
    const ro = new ResizeObserver(() => plot.current.setSize({ width: el.clientWidth, height: 40 }));
    ro.observe(el);
    return () => { ro.disconnect(); plot.current.destroy(); };
  }, [color]);
  useEffect(() => { plot.current?.setData([xs, ys]); }, [xs, ys]);
  return <div ref={box} className="trace" />;
}

export function NodeDetail({ nodeId, live }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!nodeId) return;
    let stop = false;
    setData(null);
    const load = () => fetch(`${API_URL}/nodes/${nodeId}/telemetry?seconds=180`).then((r) => r.json())
      .then((j) => !stop && setData(j)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [nodeId]);

  if (!nodeId) return <p className="empty">Select equipment on the twin to see its last 3 minutes of readings.</p>;
  const n = (live?.nodes || []).find((x) => x.id === nodeId);
  const state = nodeState(n);
  const color = stateColor(state);
  const xs = (data?.points || []).map((_, i) => i);
  return (
    <div className="detail">
      <div className="detail-head">
        <h2>{nodeId}</h2>
        <span className={`state ${state}`}>{{ ok: "Normal", watch: "Being watched", alarm: "Validated alert" }[state]}</span>
        <span className="detail-scores">Anomaly score {n ? n.r.toFixed(2) : "–"}. Predicted risk {n ? n.p.toFixed(2) : "–"}.</span>
      </div>
      <div className="readouts">
        {(data?.metrics || []).map((m) => {
          const ys = data.points.map((p) => p[m]);
          const last = ys.at(-1);
          return (
            <div className="vital" key={m}>
              <span className="vital-label">{m.replaceAll("_", " ")}</span>
              <span className="vital-value" style={{ color }}>
                {last !== undefined ? last.toFixed(Math.abs(last) >= 100 ? 0 : 2) : "–"}
                {UNIT[m] && <small> {UNIT[m]}</small>}
              </span>
              <Trace xs={xs} ys={ys} color={color} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Legend() {
  const seen = new Set();
  return (
    <div className="legend">
      {Object.values(RELATION_STYLE).filter((s) => !seen.has(s.label) && seen.add(s.label)).map((s) => (
        <span key={s.label}><i style={{ borderColor: s.color, borderTopStyle: s.dash ? "dashed" : "solid" }} />{s.label}</span>
      ))}
      <span><i style={{ borderColor: "var(--alarm)" }} />Validated failure path</span>
    </div>
  );
}

const SPLITS = {
  test: ["Test scenarios", "Fault types seen in training, unseen scenarios."],
  heldout: ["Held-out fault type", "Oxygen supply failures, never shown to any model during training."],
  noise2x: ["Double sensor noise", "Unseen scenarios with twice the training noise level."],
};
const COLS = [
  ["precision", "Precision"], ["recall", "Recall"], ["f1", "F1"], ["false_prop_rate", "False propagation"],
  ["path_correctness", "Path correct"], ["detection_delay_s", "Delay (s)"], ["false_alerts_per_scenario", "False alerts / run"],
];

const DECIMALS = { detection_delay_s: 1, false_alerts_per_scenario: 2 };
const fmt = (k, v) => (typeof v === "number" ? v.toFixed(DECIMALS[k] ?? 3) : "–");

export function Compare() {
  const [rows, setRows] = useState(null);
  useEffect(() => { fetch(`${API_URL}/metrics`).then((r) => r.json()).then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <div className="compare"><p>Loading results…</p></div>;
  if (!rows.length) return <div className="compare"><p>No evaluation results yet. Run python -m ml.evaluate to produce them.</p></div>;
  return (
    <div className="compare">
      <p>
        Each method predicts which components are failing now or will fail within 60 s, scored every 5 s.
        Negative delay means the warning came before the failure.
      </p>
      {Object.entries(SPLITS).map(([split, [title, note]]) => {
        const r = rows.filter((x) => x.split === split);
        if (!r.length) return null;
        return (
          <section key={split}>
            <h2>{title}</h2>
            <p>{note}</p>
            <table>
              <thead><tr><th>Method</th>{COLS.map(([, l]) => <th key={l}>{l}</th>)}</tr></thead>
              <tbody>
                {r.map((x) => (
                  <tr key={x.method} className={x.method === "B6" ? "ours" : ""}>
                    <td>{x.name}</td>
                    {COLS.map(([k]) => <td key={k}>{fmt(k, x[k])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
