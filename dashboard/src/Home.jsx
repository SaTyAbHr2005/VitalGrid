import { Fragment, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import metrics from "../../results/metrics.json";
import { waitForServer } from "./api.js";
import { KIND_LABEL, ROOMS, ROOM_SIZE, position } from "./twin.js";

gsap.registerPlugin(ScrollTrigger);

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
const GRAPH = {
  nodes: NODES.map(([_id, type]) => ({ _id, type })),
  edges: EDGES.map(([source, relation, target]) => ({ source, relation, target })),
};

// The replayed run: UPS-02 sags, its three devices are flagged in turn.
const SOURCE = "UPS-02";
const VICTIMS = ["VENT-02", "MON-02", "PUMP-02"];
const W = 132, H = 44;
const at = (id) => position(id).abs || position(id);

// Flat fallback for browsers without WebGL.
function Cascade() {
  return (
    <svg className="cascade" viewBox="-10 -10 1000 810" role="img"
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
    </svg>
  );
}

// ---- the scroll story: what the twin shows at each step, and where the camera stands
const node = (id, extra) => ({ id, r: 0, p: 0, validated: false, ...extra });
const flagged = (id, path) => node(id, { r: 1, p: 0.98, validated: true, path });
const OK = { status: "live", nodes: [] };
const SAG = { status: "live", nodes: [node(SOURCE, { r: 0.62, p: 0.4 })] };
const CAUGHT = { status: "live", nodes: [flagged(SOURCE, [SOURCE])] };
const SPREAD = { status: "live", nodes: [flagged(SOURCE, [SOURCE]), ...VICTIMS.map((v) => flagged(v, [SOURCE, v]))] };

const RULES = [
  ["R1", "A dependency path really connects them"],
  ["R2", "The UPS shows physical evidence: output under 195 V"],
  ["R3", "No backup absorbs it, and this UPS has no second feed"],
  ["R4", "The anomaly has held for the last 10 seconds"],
];

// Camera keyframes [position, look-at] in metres, in the building's own coordinates (see Twin3D.jsx).
const SHOTS = [
  [[4.6, 2.5, 1.6], [1.8, 0.8, -5.2]],
  [[2.6, 1.9, -2.6], [0.5, 0.8, -6.4]],
  [[3.4, 4.2, -0.9], [1.6, 0.7, -5.4]],
  [[5.2, 8.6, 3.2], [2.6, 0.5, -4.5]],
  [[8.5, 10.5, 5.5], [2.2, 0.5, -4.3]],
  null, // the whole wing (the twin's default view)
];
const STATES = [OK, SAG, CAUGHT, SPREAD, SPREAD, SPREAD];
const VOLTS = [230, 201, 182, 176, 176, 176];

function useWebGL() {
  const [ok] = useState(() => {
    try {
      return Boolean(document.createElement("canvas").getContext("webgl2"));
    } catch {
      return false;
    }
  });
  return ok;
}

function Story({ theme, serverReady }) {
  const section = useRef(null), stage = useRef(null), volts = useRef(null);
  const [step, setStep] = useState(0);
  const webgl = useWebGL();

  useEffect(() => {
    if (!webgl) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let twin, trigger, tl, dead = false, current = -1;

    import("./Twin3D.jsx").then(({ createTwin }) => {
      if (dead) return;
      twin = createTwin(stage.current, GRAPH, { interactive: false, viewShift: (w) => (w > 900 ? 0.17 : 0) });
      const shot = (i) => {
        if (SHOTS[i]) return { pos: { x: SHOTS[i][0][0], y: SHOTS[i][0][1], z: SHOTS[i][0][2] },
          target: { x: SHOTS[i][1][0], y: SHOTS[i][1][1], z: SHOTS[i][1][2] } };
        const v = twin.homeView();
        return { pos: v.pos, target: v.target };
      };
      const cut = (i) => { const s = shot(i); twin.camera.position.set(s.pos.x, s.pos.y, s.pos.z); twin.target.set(s.target.x, s.target.y, s.target.z); };
      const show = (i) => {
        if (i === current) return;
        current = i;
        setStep(i);
        twin.apply(STATES[i], null);
        if (reduced) { cut(i); volts.current.textContent = VOLTS[i].toFixed(0); }
      };
      cut(0);
      show(0);

      // Scroll is time: one scrubbed timeline moves the camera and the voltage readout between shots.
      if (!reduced) {
        const v = { v: VOLTS[0] };
        tl = gsap.timeline({ paused: true, defaults: { ease: "power2.inOut", duration: 1 } });
        for (let i = 1; i < SHOTS.length; i++) {
          const s = shot(i);
          tl.to(twin.camera.position, s.pos, i - 1)
            .to(twin.target, s.target, i - 1)
            .to(v, { v: VOLTS[i], onUpdate: () => { volts.current.textContent = v.v.toFixed(0); } }, i - 1);
        }
      }
      trigger = ScrollTrigger.create({
        trigger: section.current, start: "top top", end: "bottom bottom", scrub: reduced ? false : 0.8,
        animation: tl,
        onUpdate: (self) => show(Math.min(SHOTS.length - 1, Math.floor(self.progress * SHOTS.length))),
      });
    });
    return () => { dead = true; trigger?.kill(); tl?.kill(); twin?.dispose(); };
  }, [theme, webgl]);

  const n = SHOTS.length - 1;
  return (
    <section ref={section} className="story" style={{ height: webgl ? `${(n + 1) * 100}vh` : "auto" }}
      aria-label="How VitalGrid follows a power fault through ICU Bay 02">
      <div className="story-stage">
        <div ref={stage} className="story-canvas">{!webgl && <Cascade />}</div>

        <div className="story-copy">
          <div className={`beat intro ${step === 0 ? "on" : ""}`}>
            <h1>One failing machine can take three others down with it.</h1>
            <p className="lede">
              VitalGrid is a digital twin of an ICU wing’s power, network, medical gas and room systems. It sees a fault
              coming, follows where it will spread, and tells you why in one sentence.
            </p>
            <p className="scroll-cue">Scroll to follow a real fault through Bay 02.</p>
          </div>

          <div className={`beat ${step === 1 ? "on" : ""}`}>
            <p className="beat-n">Step 1 of 5</p>
            <h2>The UPS in Bay 02 starts to sag.</h2>
            <p>Its output falls from 230 V towards the 195 V that the ventilator, monitor and infusion pump need.
              No threshold alarm has fired yet.</p>
          </div>

          <div className={`beat ${step === 2 ? "on" : ""}`}>
            <p className="beat-n">Step 2 of 5</p>
            <h2>Perception notices first.</h2>
            <p>A neural network trained only on healthy equipment can no longer predict this UPS’s readings. Its anomaly
              score crosses the line before any fixed threshold would.</p>
          </div>

          <div className={`beat ${step === 3 ? "on" : ""}`}>
            <p className="beat-n">Step 3 of 5</p>
            <h2>Reasoning predicts the spread.</h2>
            <p>A graph network reads how every machine depends on the others and predicts that the three devices on this
              UPS will fail within 60 seconds. Their power lines light up in the ceiling.</p>
          </div>

          <div className={`beat ${step === 4 ? "on" : ""}`}>
            <p className="beat-n">Step 4 of 5</p>
            <h2>Engineering rules check it.</h2>
            <ul className="rules">
              {RULES.map(([id, text]) => <li key={id}><b>{id}</b> {text}</li>)}
            </ul>
          </div>

          <div className={`beat ${step === 5 ? "on" : ""}`}>
            <p className="beat-n">Step 5 of 5</p>
            <h2>Then it says why, in plain words.</h2>
            <blockquote className="sentence">
              VENT-02 is at risk because UPS-02’s output voltage fell below the 195 V that the ventilator needs.
            </blockquote>
            <div className="cta">
              <a className="btn big" href="#/twin">Cause a fault yourself</a>
              <a className="btn quiet big" href="#/compare">See the results</a>
            </div>
            <p className="server">
              <span className={`dot ${serverReady ? "live" : ""}`} />
              {serverReady ? "The live twin is ready." : "Waking the live twin server. Free hosting sleeps when idle, so this takes about a minute."}
            </p>
          </div>
        </div>

        {webgl && (
          <div className={`readout ${step >= 2 ? "alarm" : step === 1 ? "watch" : ""}`} aria-hidden="true">
            <span className="readout-label">UPS-02 output</span>
            <span className="readout-value"><span ref={volts}>230</span> V</span>
          </div>
        )}
      </div>
    </section>
  );
}

export function ThemeToggle({ theme, onToggle }) {
  return (
    <button className="theme" onClick={onToggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} background`}>
      {theme === "dark" ? "Light background" : "Dark background"}
    </button>
  );
}

// ---- below the story: the problem, the results and the build, shown rather than told

const STORM = [
  ["UPS-02", "Output voltage low", "182 V"],
  ["VENT-02", "Supply power fault", "Check unit"],
  ["MON-02", "Display heartbeat lost", "No signal"],
  ["PUMP-02", "Motor current low", "0.21 A"],
];

function Problem() {
  return (
    <section className="band" aria-labelledby="why">
      <h2 id="why">Why alarms alone are not enough</h2>
      <div className="versus">
        <figure className="pane">
          <figcaption>A threshold monitor during the UPS-02 sag</figcaption>
          <ul className="storm">
            {STORM.map(([id, what, val]) => (
              <li key={id}><span className="blink" aria-hidden="true" /><b>{id}</b><span>{what}</span><span className="val">{val}</span></li>
            ))}
          </ul>
          <p className="verdict">Four alarms at once, and nothing says which one caused the others.</p>
        </figure>
        <figure className="pane ours">
          <figcaption>VitalGrid during the same sag</figcaption>
          <div className="one-alert">
            <svg viewBox="0 0 320 132" role="img" aria-label="UPS-02 feeds VENT-02, MON-02 and PUMP-02">
              {[22, 66, 110].map((y) => <path key={y} d={`M92 66 C140 66 150 ${y} 196 ${y}`} className="chain-line" />)}
              <g className="chain-node src"><rect x="4" y="50" width="88" height="32" rx="6" /><text x="48" y="71">UPS-02</text></g>
              {["VENT-02", "MON-02", "PUMP-02"].map((id, i) => (
                <g key={id} className="chain-node"><rect x="196" y={6 + i * 44} width="96" height="32" rx="6" /><text x="244" y={27 + i * 44}>{id}</text></g>
              ))}
            </svg>
            <p>UPS-02’s output fell below the 195 V its devices need, so the ventilator, monitor and pump on it are at risk.</p>
            <p className="checks">Checked against rules R1, R2, R3 and R4</p>
          </div>
          <p className="verdict">One alert, with the cause, the path and the evidence.</p>
        </figure>
      </div>

      <div className="absorbed">
        <svg viewBox="0 0 300 96" role="img" aria-label="The grid feed fails, the transfer switch moves to the generator, and power keeps flowing">
          <path d="M70 26 H130 V48 H150" className="feed dead" />
          <path d="M70 74 H130 V48 H150" className="feed live" />
          <path d="M210 48 H240" className="feed live" />
          <g className="chain-node dead"><rect x="4" y="12" width="66" height="28" rx="6" /><text x="37" y="31">GRID</text></g>
          <g className="chain-node"><rect x="4" y="60" width="66" height="28" rx="6" /><text x="37" y="79">GEN</text></g>
          <g className="chain-node"><rect x="150" y="34" width="60" height="28" rx="6" /><text x="180" y="53">ATS</text></g>
          <g className="chain-node"><rect x="240" y="34" width="56" height="28" rx="6" /><text x="268" y="53">CPD</text></g>
        </svg>
        <div>
          <h3>And not every fault spreads.</h3>
          <p>When the grid fails, the transfer switch moves to the generator within seconds and the ICU keeps its power.
            A system that assumes every dependency fails would flag all 20 machines downstream of the grid. VitalGrid’s rules know the
            backup absorbs it and raise none.</p>
        </div>
      </div>
    </section>
  );
}

const METHODS = [
  ["B1", "Threshold alarms"],
  ["B5", "Graph network alone"],
  ["R", "Rules alone"],
  ["B6", "VitalGrid"],
];
const SPLIT_TITLES = [
  ["test", "Fault types seen in training"],
  ["heldout", "A fault type never seen (oxygen)"],
  ["noise2x", "Twice the sensor noise"],
];
const MEASURES = [
  ["f1", "Accuracy (F1 score)", "higher is better"],
  ["false_prop_rate", "Faults wrongly spread", "lower is better"],
];

function Bars({ split, measure }) {
  const [hover, setHover] = useState(null);
  const pctMeasure = measure === "false_prop_rate";
  return (
    <div className="bars">
      {METHODS.map(([key, name]) => {
        const m = metrics[split][key];
        const v = m[measure];
        return (
          <div key={key} className={`bar-row${key === "B6" ? " ours" : ""}`} tabIndex={0}
            onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(key)} onBlur={() => setHover(null)}>
            <span className="bar-name">{name}</span>
            <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(v * 100, 1)}%` }} /></span>
            <span className="bar-val">{pctMeasure ? `${(v * 100).toFixed(1)}%` : v.toFixed(2)}</span>
            {hover === key && (
              <span className="bar-tip" role="tooltip">
                <b>{name}</b>
                Precision {m.precision.toFixed(2)}, recall {m.recall.toFixed(2)}, F1 {m.f1.toFixed(2)}.
                Wrongly spread {(m.false_prop_rate * 100).toFixed(1)}% of faults.
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Results() {
  return (
    <section className="band" aria-labelledby="results">
      <h2 id="results">Results on scenarios the models never saw</h2>
      <p className="section-lede">
        Each method predicts which equipment is failing now or will fail within 60 seconds, checked every 5 seconds
        across 105 held-back scenarios. VitalGrid is the graph network with the rules on top.
      </p>
      <div className="results-grid">
        <span />
        {SPLIT_TITLES.map(([s, title]) => <h3 key={s} className="col-head">{title}</h3>)}
        {MEASURES.map(([measure, label, hint]) => (
          <Fragment key={measure}>
            <p className="row-head"><b>{label}</b> <span>{hint}</span></p>
            <ul className="names-col" aria-hidden="true">{METHODS.map(([k, name]) => <li key={k} className={k === "B6" ? "ours" : ""}>{name}</li>)}</ul>
            {SPLIT_TITLES.map(([s, title]) => (
              <div key={s} className="cell"><span className="cell-title">{title}</span><Bars split={s} measure={measure} /></div>
            ))}
          </Fragment>
        ))}
      </div>
      <p className="results-note">
        Where the network has seen the fault type, VitalGrid wrongly spreads a fault {(metrics.test.B6.false_prop_rate * 100).toFixed(1)}% of
        the time, against {(metrics.test.B1.false_prop_rate * 100).toFixed(1)}% for threshold alarms. On the unseen oxygen fault, the rules
        alone do better than VitalGrid, because the network holds them back. Making the network generalise is our main open problem.{" "}
        <a href="#/compare">See all seven methods in full</a>
      </p>
    </section>
  );
}

const PIPELINE = [
  ["Simulated ICU", "28 machines report every second, with real fault physics", "Python"],
  ["Telemetry store", "Every reading, the graph and the results", "MongoDB Atlas"],
  ["Perception", "Spots equipment that stops behaving normally", "LSTM autoencoders"],
  ["Reasoning", "Predicts where a failure will spread", "Graph attention network"],
  ["Verification", "Keeps only predictions the physics backs up", "Rules R1 to R4"],
  ["Explanation", "Words each alert as one sentence", "Gemini, with Groq as backup"],
  ["This site", "The twin you can break yourself", "React on Vercel, FastAPI on Render"],
];

function Built() {
  return (
    <section className="band" aria-labelledby="built">
      <h2 id="built">How it’s built</h2>
      <ol className="pipeline">
        {PIPELINE.map(([name, what, tech]) => (
          <li key={name}>
            <b>{name}</b>
            <span>{what}</span>
            <span className="tech">{tech}</span>
          </li>
        ))}
      </ol>
      <p className="pipeline-note">Both neural networks run as ONNX files, so the live server fits in the free tier’s 512 MB.
        The language model only words an alert; it never decides one.</p>
    </section>
  );
}

export default function Home({ theme, toggleTheme }) {
  const [serverReady, setServerReady] = useState(false);
  useEffect(() => {
    // Wake the free-tier backend while the visitor reads, so the live twin is ready when they open it.
    waitForServer().then(() => setServerReady(true));
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis();
    lenis.on("scroll", ScrollTrigger.update);
    const raf = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    return () => { gsap.ticker.remove(raf); lenis.destroy(); };
  }, []);

  return (
    <div className="home">
      <nav className="home-nav" aria-label="Site">
        <a href="#/" className="brand">VitalGrid</a>
        <a href="#/twin">Live twin</a>
        <a href="#/compare">Results</a>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </nav>

      <Story theme={theme} serverReady={serverReady} />

      <div className="home-body">
        <Problem />
        <Results />
        <Built />
        <footer className="home-foot">
          VitalGrid is a research prototype that runs on simulated data. It is not a medical device.
        </footer>
      </div>
    </div>
  );
}
