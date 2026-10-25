// Shared twin data helpers: fixed floor-plan positions (matching the dependency diagram) and node states.

export const RELATION_STYLE = {
  POWERS: { color: "var(--power)", dash: undefined, label: "Power feed" },
  SUPPORTS_CONNECTIVITY: { color: "var(--network)", dash: "6 4", label: "Network" },
  ENVIRONMENT_AFFECTS: { color: "var(--environment)", dash: "5 3", label: "Room environment" },
  SUPPLIES_OXYGEN: { color: "var(--oxygen)", dash: "2 4", label: "Oxygen" },
  SUPPLIES_MEDICAL_AIR: { color: "var(--air)", dash: "2 4", label: "Medical air" },
};

// Resolved theme colors for places that can't use CSS variables (WebGL, SVG attributes).
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const RELATION_VAR = {
  POWERS: "--power", SUPPORTS_CONNECTIVITY: "--network", ENVIRONMENT_AFFECTS: "--environment",
  SUPPLIES_OXYGEN: "--oxygen", SUPPLIES_MEDICAL_AIR: "--air",
};
export const relationColor = (relation) => cssVar(RELATION_VAR[relation]);
export const stateColor = (state) => cssVar({ ok: "--ok", watch: "--watch", alarm: "--alarm" }[state]);

const SHARED = {
  GRID: [330, 0], GEN: [530, 0], ATS: [430, 80], CPD: [430, 160],
  "NET-UPS": [40, 250], "SW-01": [230, 250], "O2-SUP": [650, 250], "AIR-SUP": [840, 250],
};
const ROOM_ORIGIN = { "01": [0, 360], "02": [520, 360], "03": [0, 590], "04": [520, 590] };
const IN_ROOM = { UPS: [16, 40], ENV: [300, 40], VENT: [16, 125], MON: [158, 125], PUMP: [300, 125] };
export const ROOM_SIZE = [460, 200];

export function position(id) {
  if (SHARED[id]) return { x: SHARED[id][0], y: SHARED[id][1] };
  const [kind, room] = id.split("-");
  const [ox, oy] = ROOM_ORIGIN[room];
  return { x: IN_ROOM[kind][0], y: IN_ROOM[kind][1], room, abs: { x: ox + IN_ROOM[kind][0], y: oy + IN_ROOM[kind][1] } };
}

export const ROOMS = Object.entries(ROOM_ORIGIN).map(([room, [x, y]]) => ({ room, x, y }));

export const KIND_LABEL = {
  power: "Power", switch: "Network switch", environment: "Room environment", ventilator: "Ventilator",
  pump: "Infusion pump", monitor: "Patient monitor", gas: "Medical gas supply",
};

// alarm = rule-validated alert, watch = the neural agents flag it but the rules do not (yet) back it
export function nodeState(n) {
  if (!n) return "ok";
  if (n.validated) return "alarm";
  if (n.r >= 0.5 || n.p >= 0.5) return "watch";
  return "ok";
}

// Edges on any validated alert's path, as "source>target" keys.
export function activeEdges(live) {
  const set = new Set();
  for (const n of live?.nodes || []) {
    if (!n.validated || !n.path) continue;
    n.path.slice(1).forEach((t, i) => set.add(`${n.path[i]}>${t}`));
  }
  return set;
}
