import { useEffect, useState } from "react";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { API_URL } from "./api.js";
import { RELATION_STYLE, cssVar } from "./twin.js";

const PROVIDER = { gemini: "Gemini", groq: "Groq", template: "Rule template" };

export function Alerts({ live, onSelect }) {
  const alerts = (live?.nodes || []).filter((n) => n.validated).sort((a, b) => b.p - a.p);
  if (live?.status && live.status !== "live") return <p className="empty">{live.status}</p>;
  if (!alerts.length)
    return <p className="empty">No validated risks. Inject a fault below to watch a failure spread through the ICU.</p>;
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

export function Inject({ faults, onChange }) {
  const types = Object.keys(faults || {});
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
      <h2>Inject a fault</h2>
      <label htmlFor="ft">Fault</label>
      <select id="ft" value={type} onChange={(e) => setType(e.target.value)}>
        {types.map((t) => <option key={t} value={t}>{t.replaceAll("_", " ")}</option>)}
      </select>
      <label htmlFor="fn">Starts at</label>
      <select id="fn" value={node} onChange={(e) => setNode(e.target.value)}>
        {nodes.map((n) => <option key={n}>{n}</option>)}
      </select>
      <label htmlFor="sev">Severity {severity.toFixed(2)}</label>
      <input id="sev" type="range" min="0" max="1" step="0.05" value={severity}
        onChange={(e) => setSeverity(Number(e.target.value))} />
      <div className="actions">
        <button className="btn" disabled={!node}
          onClick={() => post("/inject", { fault_type: type, node_id: node, severity })
            .then((j) => { setMsg(`Injected ${type.replaceAll("_", " ")} at ${node}.`); onChange(j.fault); })
            .catch((e) => setMsg(`Injection failed: ${e.message}`))}>Inject fault</button>
        <button className="btn quiet"
          onClick={() => post("/reset").then(() => { setMsg("Faults cleared. Batteries recharge over the next minutes."); onChange(null); })
            .catch((e) => setMsg(`Clearing failed: ${e.message}`))}>Clear faults</button>
      </div>
      {msg && <p className="empty" style={{ marginTop: 8 }}>{msg}</p>}
    </div>
  );
}

export function NodeDetail({ nodeId, live }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!nodeId) return;
    let stop = false;
    const load = () => fetch(`${API_URL}/nodes/${nodeId}/telemetry?seconds=180`).then((r) => r.json())
      .then((j) => !stop && setData(j)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [nodeId]);

  if (!nodeId) return <p className="empty">Select a component on the twin to see its last 3 minutes of telemetry.</p>;
  const n = (live?.nodes || []).find((x) => x.id === nodeId);
  return (
    <div>
      <h2>{nodeId}: anomaly {n ? n.r.toFixed(2) : "–"}, predicted risk {n ? n.p.toFixed(2) : "–"}</h2>
      <div className="charts">
        {(data?.metrics || []).map((m) => {
          const pts = data.points.map((p) => ({ v: p[m] }));
          const last = pts.at(-1)?.v;
          return (
            <div className="chart" key={m}>
              {m.replaceAll("_", " ")} <b>{last !== undefined ? last.toFixed(2) : "–"}</b>
              <ResponsiveContainer width="100%" height={48}>
                <LineChart data={pts}>
                  <YAxis hide domain={["auto", "auto"]} />
                  <Line dataKey="v" dot={false} stroke={cssVar("--power")} strokeWidth={1.4} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
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

export function ThemeToggle({ theme, onToggle }) {
  return (
    <button className="theme" onClick={onToggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} background`}>
      {theme === "dark" ? "Light background" : "Dark background"}
    </button>
  );
}
