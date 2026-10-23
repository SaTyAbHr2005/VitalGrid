import { useEffect, useState } from "react";
import metrics from "../../results/metrics.json";
import { waitForServer } from "./api.js";
import { ThemeToggle } from "./Panels.jsx";
import { KIND_LABEL, ROOMS, ROOM_SIZE, position } from "./twin.js";

// Same topology as graph/topology.yaml, kept static so the homepage never waits on the backend.
const SHARED_NODES = { GRID: "power", GEN: "power", ATS: "power", CPD: "power", "NET-UPS": "power",
  "SW-01": "switch", "O2-SUP": "gas", "AIR-SUP": "gas" };
const ROOM_NODES = { UPS: "power", ENV: "environment", VENT: "ventilator", MON: "monitor", PUMP: "pump" };
const SHARED_EDGES = [["GRID", "POWERS", "ATS"], ["GEN", "POWERS", "ATS"], ["ATS", "POWERS", "CPD"],
  ["CPD", "POWERS", "NET-UPS"], ["NET-UPS", "POWERS", "SW-01"]];
const ROOM_EDGES = [["CPD", "POWERS", "UPS"], ["UPS", "POWERS", "VENT"], ["UPS", "POWERS", "MON"], ["UPS", "POWERS", "PUMP"],
  ["SW-01", "SUPPORTS_CONNECTIVITY", "VENT"], ["SW-01", "SUPPORTS_CONNECTIVITY", "MON"], ["SW-01", "SUPPORTS_CONNECTIVITY", "PUMP"],
  ["ENV", "ENVIRONMENT_AFFECTS", "VENT"], ["ENV", "ENVIRONMENT_AFFECTS", "MON"], ["ENV", "ENVIRONMENT_AFFECTS", "PUMP"],
  ["O2-SUP", "SUPPLIES_OXYGEN", "VENT"], ["AIR-SUP", "SUPPLIES_MEDICAL_AIR", "VENT"]];
const roomId = (id, r) => (ROOM_NODES[id] ? `${id}-${r}` : id);
const NODES = [
  ...Object.entries(SHARED_NODES),
  ...ROOMS.flatMap(({ room }) => Object.entries(ROOM_NODES).map(([k, t]) => [`${k}-${room}`, t])),
];
const EDGES = [...SHARED_EDGES, ...ROOMS.flatMap(({ room }) => ROOM_EDGES.map(([s, rel, t]) => [roomId(s, room), rel, roomId(t, room)]))];

// The replayed run: UPS-02 sags, its three devices are flagged in turn.
const SOURCE = "UPS-02";
const VICTIMS = ["VENT-02", "MON-02", "PUMP-02"];
const W = 132, H = 44;
const at = (id) => position(id).abs || position(id);

function Cascade({ run }) {
  return (
    <svg key={run} className="cascade" viewBox="-10 -10 1000 810" role="img"
      aria-label="ICU dependency graph. UPS-02 fails and the ventilator, monitor and infusion pump in room 02 are flagged in turn.">
      {ROOMS.map(({ room, x, y }) => (
        <g key={room}>
          <rect className="c-room" x={x} y={y} width={ROOM_SIZE[0]} height={ROOM_SIZE[1]} rx="10" />
          <text className="c-room-label" x={x + 12} y={y + 22}>ICU room {room}</text>
        </g>
      ))}
      {EDGES.map(([s, rel, t]) => {
        const a = at(s), b = at(t);
        const hot = s === SOURCE && VICTIMS.includes(t);
        const d = `M${a.x + W / 2},${a.y + H} C${a.x + W / 2},${a.y + H + 40} ${b.x + W / 2},${b.y - 40} ${b.x + W / 2},${b.y}`;
        return (
          <g key={`${s}>${t}`}>
            <path className={`c-edge e-${rel}`} d={d} />
            {hot && <path className="c-flow" d={d} pathLength="1"
              style={{ animationDelay: `${1.1 + VICTIMS.indexOf(t) * 0.35}s` }} />}
          </g>
        );
      })}
      {NODES.map(([id, kind]) => {
        const p = at(id);
        const step = id === SOURCE ? 0 : VICTIMS.indexOf(id) + 1;
        const hot = id === SOURCE || VICTIMS.includes(id);
        return (
          <g key={id} className={hot ? "c-node hot" : "c-node"}
            style={hot ? { animationDelay: `${step === 0 ? 0.4 : 1.6 + (step - 1) * 0.35}s` } : undefined}>
            <rect x={p.x} y={p.y} width={W} height={H} rx="7" />
            <text className="c-id" x={p.x + 10} y={p.y + 19}>{id}</text>
            <text className="c-kind" x={p.x + 10} y={p.y + 34}>{KIND_LABEL[kind]}</text>
          </g>
        );
      })}
      <text className="c-note" x="536" y="580">VENT-02 at risk via UPS-02: voltage below the 195 V device limit</text>
    </svg>
  );
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const f2 = (x) => x.toFixed(2);

export default function Home({ theme, toggleTheme }) {
  const [run, setRun] = useState(0);
  const [serverReady, setServerReady] = useState(false);
  useEffect(() => {
    // Wake the free-tier backend while the visitor reads, so the live twin is ready when they open it.
    waitForServer().then(() => setServerReady(true));
  }, []);

  const t = metrics.test, h = metrics.heldout, n = metrics.noise2x;

  return (
    <div className="home">
      <nav className="home-nav" aria-label="Site">
        <a href="#/" className="brand">VitalGrid</a>
        <a href="#/twin">Live twin</a>
        <a href="#/compare">Results</a>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </nav>

      <header className="hero">
        <div className="hero-text">
          <h1>Know which ICU equipment a fault will reach, and why.</h1>
          <p className="lede">
            VitalGrid is a digital twin of a four-room ICU’s power, network, medical gas and room systems.
            It predicts how a fault will spread, checks every prediction against engineering rules, and explains
            the failure path in one plain sentence.
          </p>
          <div className="cta">
            <a className="btn big" href="#/twin">Open the live twin</a>
            <a className="btn quiet big" href="#/compare">See the results</a>
          </div>
          <p className="server">
            <span className={`dot ${serverReady ? "live" : ""}`} />
            {serverReady ? "The live twin is ready." : "Waking the live twin server. Free hosting sleeps when idle, so this takes about a minute."}
          </p>
        </div>
        <figure className="hero-figure">
          <Cascade run={run} />
          <figcaption>
            A replay from the live twin. UPS-02’s output voltage sags, and VitalGrid flags the ventilator,
            monitor and pump in room 02 with the dependency that connects them.{" "}
            <button className="link" onClick={() => setRun((r) => r + 1)}>Replay</button>
          </figcaption>
        </figure>
      </header>

      <section className="band">
        <h2>Why alarms alone are not enough</h2>
        <div className="problems">
          <p><b>One fault sets off many alarms.</b> When a room’s UPS sags, every device on it misbehaves. Threshold
            monitors raise a separate alarm for each one and bury the real cause.</p>
          <p><b>Not every fault spreads.</b> The generator absorbs a grid outage and a UPS battery covers a short blip.
            A system that assumes every dependency fails cries wolf.</p>
          <p><b>Predictions need reasons.</b> A neural network can guess where a failure will spread but cannot say why.
            Clinical engineers need the path and the evidence before they act.</p>
        </div>
      </section>

      <section className="band">
        <h2>How a reading becomes an explained alert</h2>
        <ol className="steps">
          <li><b>Stream.</b> Simulated telemetry from 28 components, from the grid feed down to each infusion pump,
            lands in MongoDB Atlas every second.</li>
          <li><b>Notice.</b> The perception agent, an LSTM autoencoder per device type, learns normal behaviour and
            scores how unusual each component looks.</li>
          <li><b>Predict.</b> The reasoning agent, a graph attention network over the dependency graph, estimates which
            components will fail within the next 60 seconds.</li>
          <li><b>Verify.</b> The verification agent checks each prediction against engineering rules: real physical
            evidence, a valid dependency path, no backup absorbing the fault, and an anomaly that persists.</li>
          <li><b>Explain.</b> The explanation agent asks Gemini, or Groq as a backup, to phrase each verified path as one
            sentence. The language model only words the alert; it never decides one.</li>
        </ol>
      </section>

      <section className="band">
        <h2>Results on scenarios the models never saw</h2>
        <p className="section-lede">
          Each method predicts which components are failing now or will fail within 60 seconds, checked every
          5 seconds across 105 held-back scenarios.
        </p>
        <div className="findings">
          <div>
            <h3>Almost no false spread</h3>
            <p>On fault types seen in training, {pct(t.B6.precision)} of VitalGrid’s alerts were real, against{" "}
              {pct(t.B1.precision)} for threshold alarms. It wrongly spread a fault {pct(t.B6.false_prop_rate)} of the
              time, compared with {pct(t.B1.false_prop_rate)} for thresholds and {pct(t.B3.false_prop_rate)} for plain
              graph reachability, and raised {Math.round(t.alert_reduction_b6_vs_b1 * 100)}% fewer false alerts.</p>
          </div>
          <div>
            <h3>Rules carry new faults</h3>
            <p>Oxygen supply failures were kept out of training. There the graph network’s F1 fell to {f2(h.B5.f1)} while
              the rules alone held {f2(h.R.f1)}, and the combined system reached {f2(h.B6.f1)}. Making the neural model
              generalise to new fault types is our main open problem.</p>
          </div>
          <div>
            <h3>Steady under noisy sensors</h3>
            <p>With twice the training noise, neural-only methods fell to an F1 of {f2(n.B5.f1)} as random readings
              looked like faults. VitalGrid stayed at {f2(n.B6.f1)} because the rules ignore spikes that do not persist.</p>
          </div>
        </div>
        <p><a href="#/compare">See the full comparison of all seven methods</a></p>
      </section>

      <section className="band two">
        <div>
          <h2>Built with</h2>
          <p>A Python simulator with conditional fault physics, MongoDB Atlas, PyTorch models exported to ONNX,
            a FastAPI backend on Render, and this React dashboard on Vercel. Gemini and Groq write the alert text.</p>
        </div>
        <div>
          <h2>Team</h2>
          <p>Ayush Bayangolkar, Alston Gonsalves, Kavya Kalathiya and Diksha Raul, Department of Computer
            Engineering. Presented at the Avishkar Research Convention 2026–27, Medicine and Pharmacy category.</p>
        </div>
      </section>

      <footer className="home-foot">
        VitalGrid is a research prototype that runs on simulated data. It is not a medical device.
      </footer>
    </div>
  );
}
