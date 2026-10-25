import { lazy, Suspense, useEffect, useState } from "react";
import { API_URL, WS_URL, waitForServer } from "./api.js";
import Twin2D from "./Twin2D.jsx";
import { ThemeToggle } from "./Home.jsx";
import { Alerts, Compare, Inject, Legend, NodeDetail, faultLabel } from "./Panels.jsx";

const Twin3D = lazy(() => import("./Twin3D.jsx")); // three.js only loads when the 3D view is opened

export const VIEWS = [["#/twin", "Floor plan"], ["#/3d", "3D building"], ["#/compare", "Results"]];

function useLive(ready) {
  const [live, setLive] = useState(null);
  useEffect(() => {
    if (!ready) return;
    let ws, retry, closed = false;
    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onmessage = (e) => setLive(JSON.parse(e.data));
      ws.onclose = () => { if (!closed) retry = setTimeout(connect, 3000); };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); ws?.close(); };
  }, [ready]);
  return live;
}

export default function Dashboard({ view, hash, theme, toggleTheme }) {
  const [graph, setGraph] = useState(null);
  const [faults, setFaults] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [, setFault] = useState(null);
  const live = useLive(Boolean(graph));

  useEffect(() => {
    waitForServer()
      .then(() => Promise.all([fetch(`${API_URL}/graph`), fetch(`${API_URL}/faults`)]))
      .then(async ([g, f]) => {
        if (!g.ok) throw new Error(`loading the graph returned ${g.status}`);
        setGraph(await g.json());
        setFaults(await f.json());
      })
      .catch((e) => setError(`The server is up, but ${e.message}. Check MONGODB_URI on the backend.`));
  }, []);

  const fault = live?.fault;
  const status = error || (!graph ? "Waking up the server, this takes about a minute on first visit…" :
    live?.status === "live" ? "Live" : live?.status || "Connecting to the live twin…");

  return (
    <div className="app">
      <header className="topbar">
        <h1><a href="#/" className="brand">VitalGrid</a></h1>
        <span className="status"><span className={`dot ${live?.status === "live" ? "live" : ""}`} />{status}</span>
        <nav className="tabs" aria-label="View">
          {VIEWS.map(([h, l]) => (
            <a key={h} href={h} aria-current={hash === h ? "page" : undefined}>{l}</a>
          ))}
        </nav>
        <span className="fault">
          {fault ? `Active fault: ${faultLabel(fault.type).toLowerCase()} at ${fault.source}` : "No active fault"}
        </span>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </header>

      {view === "compare" ? <Compare /> : (
        <div className="main">
          <div className="stage">
            <div className="canvas">
              {graph && (view === "2d"
                ? <Twin2D graph={graph} live={live} selected={selected} onSelect={setSelected} theme={theme} />
                : <Suspense fallback={<p className="empty" style={{ padding: 20 }}>Loading 3D view…</p>}>
                    <Twin3D graph={graph} live={live} selected={selected} onSelect={setSelected} theme={theme} />
                  </Suspense>)}
              {view === "2d" && <Legend />}
            </div>
            <div className="drawer">
              <Inject faults={faults} onChange={setFault} />
              <NodeDetail nodeId={selected} live={live} />
            </div>
          </div>
          <aside className="rail" aria-label="Validated alerts">
            <h2>Validated alerts</h2>
            <Alerts live={live} onSelect={setSelected} />
          </aside>
        </div>
      )}
    </div>
  );
}
