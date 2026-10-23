import { lazy, Suspense, useEffect, useState } from "react";
import { API_URL, WS_URL, waitForServer } from "./api.js";
import Home from "./Home.jsx";
import Twin2D from "./Twin2D.jsx";
import { Alerts, Compare, Inject, Legend, NodeDetail, ThemeToggle } from "./Panels.jsx";
import "./styles.css";

const Twin3D = lazy(() => import("./Twin3D.jsx")); // three.js only loads when the 3D view is opened

// Hash routes keep the static Vercel deploy free of rewrite rules. Anything else is the homepage.
const ROUTES = { "#/twin": "2d", "#/3d": "3d", "#/compare": "compare" };
const VIEWS = [["#/twin", "Floor plan"], ["#/3d", "3D twin"], ["#/compare", "Method comparison"]];

function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => { setHash(window.location.hash); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

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

// Dark by default. The attribute is set before React renders, because the 3D view and the
// React Flow grid read resolved CSS colors during render.
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("theme", theme);
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
  return theme;
}

function useTheme() {
  const [theme, setTheme] = useState(() => {
    let saved = null;
    try {
      saved = localStorage.getItem("theme");
    } catch {
      /* storage unavailable */
    }
    return applyTheme(saved === "light" ? "light" : "dark");
  });
  return [theme, () => setTheme(applyTheme(theme === "dark" ? "light" : "dark"))];
}

function Dashboard({ view, hash, theme, toggleTheme }) {
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
          {fault ? `Active fault: ${fault.type.replaceAll("_", " ")} at ${fault.source}` : "No active fault"}
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
                    <Twin3D graph={graph} live={live} onSelect={setSelected} theme={theme} />
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

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const hash = useHash();
  const view = ROUTES[hash];
  return view
    ? <Dashboard view={view} hash={hash} theme={theme} toggleTheme={toggleTheme} />
    : <Home theme={theme} toggleTheme={toggleTheme} />;
}
