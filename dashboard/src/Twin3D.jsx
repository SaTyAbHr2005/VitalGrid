import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { activeEdges, cssVar, nodeState, relationColor, stateColor } from "./twin.js";

// Building plan in metres: x runs east, z runs south, y is up. One ICU wing: a corridor along z = 0,
// four patient bays off it, plant rooms at the west end, and the grid transformer + generator in a yard outside.
const WALL_H = 1.3; // walls are cut away at this height so every room can be seen into, like an architect's model
const AREAS = [
  { label: "ICU Bay 01", room: "01", x: [-6.5, 0], z: [-7, -1.25], door: "s" },
  { label: "ICU Bay 02", room: "02", x: [0, 6.5], z: [-7, -1.25], door: "s" },
  { label: "ICU Bay 03", room: "03", x: [-6.5, 0], z: [1.25, 7], door: "n" },
  { label: "ICU Bay 04", room: "04", x: [0, 6.5], z: [1.25, 7], door: "n" },
  { label: "Electrical room", x: [-15, -6.5], z: [-7, -1.25], door: "s" },
  { label: "Network room", x: [-15, -11], z: [1.25, 7], door: "n" },
  { label: "Medical gas store", x: [-11, -6.5], z: [1.25, 7], door: "n" },
];
const CORRIDOR = { x: [-15, 6.5], z: [-1.25, 1.25] };
const YARD = { x: [-24, -15], z: [-7, 1.25] };
const CENTER = new THREE.Vector3(-8.75, 0, 0);

// Shared plant: [x, z, rotation].
const SHARED = {
  GRID: [-21, -4.6, 0], GEN: [-20, -0.9, 0], ATS: [-13, -6.75, 0], CPD: [-9.5, -6.62, 0],
  "NET-UPS": [-14, 6.45, Math.PI], "SW-01": [-12.4, 6.45, Math.PI], "O2-SUP": [-9.9, 6.35, 0], "AIR-SUP": [-7.6, 6.35, 0],
};
// Inside a bay, measured from the bay's centre line (dx) and from its back wall (dz); bays 03/04 are mirrored.
const IN_BAY = { UPS: [-2.75, 0.5], VENT: [-1.1, 0.6], MON: [0.95, 0.35], PUMP: [1.05, 1.5], ENV: [2.6, 0.4] };
const DECOR = { bed: [0, 1.2], chair: [-2.0, 2.9], counter: [2.8, 3.4] };

function bayPlace(room, [dx, dz]) {
  const a = AREAS.find((r) => r.room === room);
  const cx = (a.x[0] + a.x[1]) / 2, north = a.door === "s";
  return north ? [cx + dx, a.z[0] + dz, 0] : [cx - dx, a.z[1] - dz, Math.PI];
}
function place(id) {
  if (SHARED[id]) return SHARED[id];
  const [kind, room] = id.split("-");
  return IN_BAY[kind] && bayPlace(room, IN_BAY[kind]);
}

// Ceiling service runs: [height, offset from the corridor centre line] per relation, so each service gets its own lane.
const LANE = {
  POWERS: [2.5, -0.8], SUPPORTS_CONNECTIVITY: [2.75, -0.3], SUPPLIES_OXYGEN: [3.0, 0.3],
  SUPPLIES_MEDICAL_AIR: [3.25, 0.8], ENVIRONMENT_AFFECTS: [2.3, 0],
};

// ---- equipment models: each returns { top, foot } and adds meshes to g; M.body is the device's own tintable material
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r, h, s = 18) => new THREE.CylinderGeometry(r, r, h, s);
function add(g, geom, mat, x, y, z) {
  const m = new THREE.Mesh(geom, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return m;
}
const MODELS = {
  VENT: ["#e6ebe9", (g, M) => {
    add(g, box(0.6, 0.08, 0.6), M.dark, 0, 0.12, 0);
    add(g, cyl(0.035, 0.7), M.metal, 0, 0.5, 0);
    add(g, box(0.52, 0.5, 0.42), M.body, 0, 1.05, 0);
    add(g, box(0.4, 0.28, 0.02), M.screen, 0, 1.12, 0.22);
    add(g, new THREE.TorusGeometry(0.22, 0.025, 8, 24, Math.PI), M.hose, 0.26, 0.95, 0.12).rotation.set(0, Math.PI / 2, -Math.PI / 2);
    return { top: 1.3, foot: 0.45 };
  }],
  MON: ["#2b3433", (g, M) => {
    add(g, cyl(0.22, 0.05), M.dark, 0, 0.03, 0);
    add(g, cyl(0.025, 1.45), M.metal, 0, 0.75, 0);
    add(g, box(0.62, 0.42, 0.08), M.body, 0, 1.6, 0);
    add(g, box(0.56, 0.36, 0.01), M.ecg, 0, 1.6, 0.045);
    return { top: 1.82, foot: 0.35 };
  }],
  PUMP: ["#e6ebe9", (g, M) => {
    add(g, cyl(0.25, 0.04), M.dark, 0, 0.03, 0);
    add(g, cyl(0.018, 1.9), M.metal, 0, 0.97, 0);
    add(g, box(0.24, 0.3, 0.18), M.body, 0, 1.05, 0.08);
    add(g, box(0.16, 0.08, 0.01), M.screen, 0, 1.12, 0.175);
    add(g, box(0.16, 0.24, 0.04), M.bag, 0.12, 1.72, 0);
    return { top: 1.95, foot: 0.35 };
  }],
  UPS: ["#3a4443", (g, M) => {
    add(g, box(0.55, 1.0, 0.75), M.body, 0, 0.5, 0);
    add(g, box(0.4, 0.04, 0.01), M.screen, 0, 0.85, 0.38);
    return { top: 1.0, foot: 0.5 };
  }],
  ENV: ["#e6ebe9", (g, M) => { // precision air-conditioning unit that holds the bay's temperature
    add(g, box(0.9, 1.9, 0.55), M.body, 0, 0.95, 0);
    add(g, box(0.7, 0.9, 0.02), M.dark, 0, 1.3, 0.28);
    add(g, box(0.3, 0.12, 0.01), M.screen, 0, 0.55, 0.28);
    return { top: 1.9, foot: 0.6 };
  }],
  GRID: ["#6f8a7a", (g, M) => { // pad-mounted utility transformer
    add(g, box(2.4, 0.1, 1.9), M.concrete, 0, 0.05, 0);
    add(g, box(1.8, 1.5, 1.3), M.body, 0, 0.85, 0);
    for (let i = -3; i <= 3; i++) for (const s of [-1, 1]) add(g, box(0.04, 1.1, 0.3), M.body, i * 0.25, 0.85, s * 0.8);
    for (const x of [-0.5, 0, 0.5]) add(g, cyl(0.07, 0.45), M.insulator, x, 1.83, 0);
    return { top: 2.05, foot: 1.3 };
  }],
  GEN: ["#d8b24c", (g, M) => { // diesel standby generator
    add(g, box(3.8, 0.1, 1.9), M.concrete, 0, 0.05, 0);
    add(g, box(3.2, 1.5, 1.4), M.body, 0, 0.85, 0);
    add(g, box(1.0, 0.6, 0.02), M.dark, -0.6, 0.9, 0.71);
    add(g, cyl(0.09, 0.9), M.dark, 1.2, 2.0, 0);
    return { top: 2.45, foot: 1.9 };
  }],
  ATS: ["#9aa6a3", (g, M) => { // automatic transfer switch, wall mounted
    add(g, box(1.0, 1.5, 0.35), M.body, 0, 1.05, 0);
    add(g, box(0.9, 1.4, 0.01), M.dark, 0, 1.05, 0.18);
    for (const x of [-0.25, 0, 0.25]) add(g, cyl(0.04, 0.02), M.screen, x, 1.55, 0.19).rotation.x = Math.PI / 2;
    return { top: 1.8, foot: 0.6 };
  }],
  CPD: ["#9aa6a3", (g, M) => { // central power distribution switchboard
    add(g, box(2.2, 2.0, 0.6), M.body, 0, 1.0, 0);
    for (const x of [-0.55, 0, 0.55]) add(g, box(0.02, 1.8, 0.01), M.dark, x, 1.0, 0.305);
    return { top: 2.0, foot: 1.2 };
  }],
  "NET-UPS": ["#3a4443", (g, M) => {
    add(g, box(0.7, 1.3, 0.9), M.body, 0, 0.65, 0);
    add(g, box(0.5, 0.04, 0.01), M.screen, 0, 1.1, 0.455);
    return { top: 1.3, foot: 0.55 };
  }],
  "SW-01": ["#22292a", (g, M) => { // network rack with the core switch
    add(g, box(0.7, 2.0, 0.9), M.body, 0, 1.0, 0);
    for (const y of [1.7, 1.55, 1.4, 1.25]) add(g, box(0.6, 0.08, 0.01), M.led, 0, y, 0.455);
    return { top: 2.0, foot: 0.55 };
  }],
  "O2-SUP": ["#3e8e5e", (g, M) => gasBank(g, M)],
  "AIR-SUP": ["#e8ecea", (g, M) => gasBank(g, M)],
};
function gasBank(g, M) { // manifold of medical gas cylinders
  for (const x of [-0.5, 0, 0.5]) {
    add(g, cyl(0.22, 1.4), M.body, x, 0.7, 0);
    add(g, new THREE.SphereGeometry(0.22, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.body, x, 1.4, 0);
    add(g, cyl(0.05, 0.18), M.dark, x, 1.68, 0);
  }
  add(g, box(1.4, 0.06, 0.06), M.metal, 0, 1.8, 0);
  return { top: 1.85, foot: 0.9 };
}
const DECOR_MODELS = {
  bed: (g, M) => {
    add(g, box(1.0, 0.45, 2.1), M.metal, 0, 0.3, 0);
    add(g, box(0.95, 0.16, 2.0), M.sheet, 0, 0.6, 0);
    add(g, box(0.6, 0.1, 0.35), M.sheet, 0, 0.72, -0.75);
    add(g, box(0.97, 0.06, 1.2), M.blanket, 0, 0.7, 0.35);
    add(g, box(1.0, 0.5, 0.06), M.dark, 0, 0.8, -1.05);
  },
  chair: (g, M) => {
    add(g, box(0.5, 0.45, 0.5), M.blanket, 0, 0.25, 0);
    add(g, box(0.5, 0.5, 0.08), M.blanket, 0, 0.7, -0.22);
  },
  counter: (g, M) => {
    add(g, box(0.6, 0.9, 2.4), M.sheet, 0, 0.45, 0);
    add(g, box(0.36, 0.04, 0.5), M.metal, 0, 0.91, 0.5);
  },
};

function wall(scene, M, x0, z0, x1, z1, h = WALL_H, t = 0.15, mat = M.wall) {
  const w = Math.abs(x1 - x0) || t, d = Math.abs(z1 - z0) || t;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  add(scene, box(w, h, d), mat, cx, h / 2, cz);
  if (mat === M.wall) add(scene, box(w + 0.02, 0.04, d + 0.02), M.cap, cx, h + 0.02, cz);
}
function roomWalls(scene, M, { x: [x0, x1], z: [z0, z1], door }) {
  const cx = (x0 + x1) / 2, gap = 0.9;
  const side = (z) => { wall(scene, M, x0, z, cx - gap, z); wall(scene, M, cx + gap, z, x1, z); };
  door === "n" ? side(z0) : wall(scene, M, x0, z0, x1, z0);
  door === "s" ? side(z1) : wall(scene, M, x0, z1, x1, z1);
  wall(scene, M, x0, z0, x0, z1);
  wall(scene, M, x1, z0, x1, z1);
}
function slab(scene, mat, { x: [x0, x1], z: [z0, z1] }, h = 0.08) {
  const m = add(scene, box(x1 - x0, h, z1 - z0), mat, (x0 + x1) / 2, h / 2, (z0 + z1) / 2);
  m.castShadow = false;
  return m;
}
function label(scene, text, className, x, y, z) {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  const o = new CSS2DObject(el);
  o.position.set(x, y, z);
  scene.add(o);
  return el;
}

// Orthogonal ceiling route: up from the source, along the corridor lane, and down into the target.
function route(a, b, rel, viaCorridor) {
  const [h, off] = LANE[rel];
  const pts = viaCorridor
    ? [a, [a.x, h, a.z], [a.x, h, off], [b.x, h, off], [b.x, h, b.z], b]
    : [a, [a.x, h, a.z], [b.x, h, a.z], [b.x, h, b.z], b];
  const v = pts.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p)));
  return v.filter((p, i) => i === 0 || p.distanceToSquared(v[i - 1]) > 1e-6);
}

function build(graph, onPick) {
  const C = {
    bg: cssVar("--ward"), floor: cssVar("--surface"), floorAlarm: cssVar("--surface-alarm"), corridor: cssVar("--panel"),
    wall: cssVar("--steel"), cap: cssVar("--ink-soft"), yard: cssVar("--track"), alarm: stateColor("alarm"),
  };
  const std = (color, extra) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });
  const M = {
    dark: std("#2b3433"), metal: std("#aab4b2", { metalness: 0.6, roughness: 0.35 }), hose: std("#7fb6c9"),
    screen: std("#0d3b4a", { emissive: "#2aa6c9", emissiveIntensity: 0.7 }),
    ecg: std("#062016", { emissive: "#3fd68a", emissiveIntensity: 0.6 }),
    led: std("#062016", { emissive: "#5be08f", emissiveIntensity: 0.8 }),
    bag: std("#cfe8ff", { transparent: true, opacity: 0.7 }), insulator: std("#b9653f"),
    concrete: std("#9a9e9a"), sheet: std("#f2f5f4"), blanket: std("#5f9c9a"),
    wall: std(C.wall, { roughness: 0.9 }), cap: std(C.cap), fence: std("#9aa6a3", { metalness: 0.5, roughness: 0.4 }),
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.bg);
  scene.add(new THREE.HemisphereLight("#ffffff", "#5a6563", 1.4));
  const sun = new THREE.DirectionalLight("#ffffff", 2.2);
  sun.position.set(CENTER.x - 12, 30, 16);
  sun.target.position.copy(CENTER);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 14, bottom: -14, near: 1, far: 80 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const ground = add(scene, new THREE.PlaneGeometry(160, 160), std(C.bg, { roughness: 1 }), CENTER.x, 0, 0);
  ground.rotation.x = -Math.PI / 2;
  ground.castShadow = false;

  // Floors, walls and area names
  const floors = {};
  for (const a of AREAS) {
    const mat = std(C.floor, { roughness: 0.85 });
    slab(scene, mat, a);
    if (a.room) floors[a.room] = mat;
    roomWalls(scene, M, a);
    const back = a.door === "s" ? a.z[0] : a.z[1];
    label(scene, a.label, "tw3-area", (a.x[0] + a.x[1]) / 2, WALL_H + 0.25, back);
  }
  slab(scene, std(C.corridor, { roughness: 0.85 }), CORRIDOR, 0.06);
  wall(scene, M, CORRIDOR.x[0], CORRIDOR.z[0], CORRIDOR.x[0], CORRIDOR.z[1]);
  wall(scene, M, CORRIDOR.x[1], CORRIDOR.z[0], CORRIDOR.x[1], CORRIDOR.z[1]);
  label(scene, "Services run along the corridor ceiling", "tw3-area", 1, 0.15, 0);
  slab(scene, std(C.yard, { roughness: 1 }), YARD, 0.04);
  wall(scene, M, YARD.x[0], YARD.z[0], YARD.x[1], YARD.z[0], 0.9, 0.05, M.fence);
  wall(scene, M, YARD.x[0], YARD.z[0], YARD.x[0], YARD.z[1], 0.9, 0.05, M.fence);
  wall(scene, M, YARD.x[0], YARD.z[1], -17.5, YARD.z[1], 0.9, 0.05, M.fence);
  label(scene, "Utility yard", "tw3-area", -21.5, 0.15, -6.3);

  for (const room of ["01", "02", "03", "04"]) {
    for (const [kind, at] of Object.entries(DECOR)) {
      const [x, z, rot] = bayPlace(room, at);
      const g = new THREE.Group();
      DECOR_MODELS[kind](g, M);
      g.position.set(x, 0.08, z);
      g.rotation.y = rot;
      scene.add(g);
    }
  }

  // Devices: one per graph node, with a floor halo and a beacon that carry its state
  const haloGeo = new THREE.RingGeometry(1, 1.16, 48), beaconGeo = new THREE.SphereGeometry(0.09, 16, 12);
  const devices = {}, pickable = [];
  for (const n of graph.nodes) {
    const at = place(n._id), kind = SHARED[n._id] ? n._id : n._id.split("-")[0];
    if (!at || !MODELS[kind]) continue;
    const [color, model] = MODELS[kind];
    const body = std(color, { roughness: 0.55 });
    const g = new THREE.Group();
    const { top, foot } = model(g, { ...M, body });
    g.position.set(at[0], 0.08, at[1]);
    g.rotation.y = at[2];
    g.traverse((o) => { o.userData.id = n._id; });
    pickable.push(g);
    scene.add(g);

    const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    halo.rotation.x = -Math.PI / 2;
    halo.scale.setScalar(foot);
    halo.position.set(at[0], 0.13, at[1]);
    const beacon = new THREE.Mesh(beaconGeo, std("#ffffff", { emissiveIntensity: 0.9 }));
    beacon.position.set(at[0], top + 0.2, at[1]);
    scene.add(halo, beacon);
    const el = label(scene, n._id, "tw3-label", at[0], top + 0.55, at[1]);
    el.addEventListener("click", () => onPick(n._id));
    devices[n._id] = { halo, beacon, body, el, foot, room: SHARED[n._id] ? null : n._id.split("-")[1], anchor: new THREE.Vector3(at[0], top + 0.2, at[1]) };
  }

  // Dependency edges as ceiling conduits, one shared unit cylinder scaled per segment
  const unit = cyl(1, 1, 8), joint = new THREE.SphereGeometry(1, 10, 8), UP = new THREE.Vector3(0, 1, 0);
  const edges = [];
  for (const e of graph.edges) {
    const s = devices[e.source], t = devices[e.target];
    if (!s || !t) continue;
    const pts = route(s.anchor, t.anchor, e.relation, s.room !== t.room || !s.room);
    const base = relationColor(e.relation);
    const mat = new THREE.MeshStandardMaterial({ color: base, transparent: true, opacity: 0.6, roughness: 0.5 });
    const meshes = [], path = new THREE.CurvePath();
    pts.slice(1).forEach((q, i) => {
      const p = pts[i];
      const m = new THREE.Mesh(unit, mat);
      m.position.copy(p).add(q).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(UP, q.clone().sub(p).normalize());
      m.userData.len = p.distanceTo(q);
      meshes.push(m);
      path.add(new THREE.LineCurve3(p, q));
      if (i) { const j = new THREE.Mesh(joint, mat); j.position.copy(p); meshes.push(j); }
    });
    scene.add(...meshes);
    edges.push({ key: `${e.source}>${e.target}`, base, mat, meshes, path, len: path.getLength() });
  }

  const select = new THREE.Mesh(new THREE.RingGeometry(1.22, 1.32, 48), new THREE.MeshBasicMaterial({ color: cssVar("--ink"), side: THREE.DoubleSide }));
  select.rotation.x = -Math.PI / 2;
  select.visible = false;
  scene.add(select);

  return {
    scene, devices, edges, floors, pickable, select, C, particles: [],
    dotGeo: new THREE.SphereGeometry(0.11, 12, 8),
    dotMat: new THREE.MeshBasicMaterial({ color: C.alarm }),
  };
}

function applyLive(s, live, selected) {
  const byId = Object.fromEntries((live?.nodes || []).map((n) => [n.id, n]));
  const alarmRooms = new Set();
  for (const [id, d] of Object.entries(s.devices)) {
    const n = byId[id], st = nodeState(n), c = stateColor(st);
    d.state = st;
    d.halo.material.color.set(c);
    d.beacon.material.color.set(c);
    d.beacon.material.emissive.set(c);
    d.body.emissive.set(st === "ok" ? "#000000" : c);
    d.el.title = `${id}: risk ${(n?.p ?? 0).toFixed(2)}`;
    if (st === "alarm" && d.room) alarmRooms.add(d.room);
  }
  s.selected = selected;
  refreshLabels(s);
  for (const [room, m] of Object.entries(s.floors)) m.color.set(alarmRooms.has(room) ? s.C.floorAlarm : s.C.floor);

  const active = activeEdges(live);
  s.scene.remove(...s.particles);
  s.particles = [];
  for (const e of s.edges) {
    const on = active.has(e.key), r = on ? 0.075 : 0.035;
    e.mat.color.set(on ? s.C.alarm : e.base);
    e.mat.opacity = on ? 1 : 0.6;
    for (const m of e.meshes) m.userData.len ? m.scale.set(r, m.userData.len, r) : m.scale.setScalar(r);
    if (on) for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(s.dotGeo, s.dotMat);
      p.userData = { edge: e, off: i / 4 };
      s.particles.push(p);
    }
  }
  if (s.particles.length) s.scene.add(...s.particles);

  const d = s.devices[selected];
  s.select.visible = !!d;
  if (d) {
    s.select.position.set(d.halo.position.x, 0.12, d.halo.position.z);
    s.select.scale.setScalar(d.foot);
  }
}

// To keep the building readable, equipment names show only when flagged, selected or hovered (unless "all labels" is on).
function refreshLabels(s) {
  for (const [id, d] of Object.entries(s.devices)) {
    const shown = s.allLabels || d.state !== "ok" || id === s.selected || id === s.hover;
    d.el.className = `tw3-label ${d.state}${id === s.selected ? " selected" : ""}${shown ? "" : " hidden"}`;
  }
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const VIEW = new THREE.Vector3(6, 30, 30).normalize();

// Where to look at a piece of equipment from: above it, on the corridor side of its room.
export function closeView(id, dist = 7) {
  const at = place(id);
  if (!at) return null;
  const target = new THREE.Vector3(at[0], 0.8, at[1]);
  const pos = target.clone().add(new THREE.Vector3(1.6, 3.4, at[1] < 0 ? 4 : -4).normalize().multiplyScalar(dist));
  return { pos, target };
}

// Builds the building scene into `host` and runs it. Used by the 3D view (orbit controls) and by the
// homepage story (interactive: false, camera driven from outside through `camera` and `target`).
// viewShift(w) moves the picture right by that fraction of the width, leaving room for text on the left.
export function createTwin(host, graph, { onPick = () => {}, interactive = true, viewShift = () => 0 } = {}) {
  const motion = !reducedMotion();
  const s = build(graph, onPick);
  applyLive(s, null, null);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const labels = new CSS2DRenderer();
  Object.assign(labels.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
  host.append(renderer.domElement, labels.domElement);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.3, 300);
  const target = CENTER.clone();
  const controls = interactive ? new OrbitControls(camera, renderer.domElement) : null;
  if (controls) {
    controls.target = target;
    Object.assign(controls, { enableDamping: true, maxPolarAngle: 1.4, minDistance: 3, maxDistance: 90 });
  }

  // Default framing: back off just far enough for the ~31 m wide wing to fill the view
  const homeView = () => {
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return { pos: CENTER.clone().addScaledVector(VIEW, Math.max(16.5 / (tan * camera.aspect), 11 / tan)), target: CENTER.clone() };
  };
  let framed = false;
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = host;
    renderer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / Math.max(h, 1);
    const shift = viewShift(w);
    if (shift) camera.setViewOffset(w, h, -w * shift, 0, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    if (framed || !w) return;
    camera.position.copy(homeView().pos);
    framed = true;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  const fly = ({ pos, target: to }, duration = 0.9) => {
    gsap.killTweensOf([camera.position, target]);
    const d = motion ? duration : 0;
    gsap.to(camera.position, { x: pos.x, y: pos.y, z: pos.z, duration: d, ease: "power3.inOut" });
    gsap.to(target, { x: to.x, y: to.y, z: to.z, duration: d, ease: "power3.inOut" });
  };

  // Click (not drag) on equipment selects it
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const hit = (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(s.pickable, true)[0]?.object.userData.id;
  };
  let down = null;
  const onDown = (ev) => { down = [ev.clientX, ev.clientY]; };
  const onUp = (ev) => {
    if (down && Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) < 5) { const id = hit(ev); if (id) onPick(id); }
    down = null;
  };
  const onMove = (ev) => {
    if (down) return;
    const id = hit(ev);
    renderer.domElement.style.cursor = id ? "pointer" : "";
    if (id !== s.hover) { s.hover = id; refreshLabels(s); }
  };
  if (interactive) {
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointermove", onMove);
  }

  // Alarm flash rates follow IEC 60601-1-8: high priority ~2 Hz, medium priority ~0.6 Hz (design.md 4.2)
  const flash = (hz, t) => (motion ? 0.5 + 0.5 * Math.sin(2 * Math.PI * hz * t) : 1);
  let raf;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    const t = performance.now() / 1000, alarm = flash(2, t), watch = flash(0.6, t);
    for (const d of Object.values(s.devices)) {
      const k = d.state === "alarm" ? alarm : d.state === "watch" ? watch : 0;
      d.body.emissiveIntensity = 0.1 + 0.4 * k;
      d.halo.scale.setScalar(d.foot * (d.state === "alarm" ? 1 + 0.12 * alarm : 1));
    }
    for (const p of s.particles) {
      const { edge, off } = p.userData;
      p.visible = motion;
      p.position.copy(edge.path.getPoint((t * 3 / edge.len + off) % 1));
    }
    if (controls) controls.update();
    else camera.lookAt(target);
    renderer.render(s.scene, camera);
    labels.render(s.scene, camera);
  };
  tick();

  return {
    camera, target,
    apply: (live, selected) => applyLive(s, live, selected),
    setAllLabels: (v) => { s.allLabels = v; refreshLabels(s); },
    flyTo: (id) => { const v = closeView(id); if (v) fly(v); },
    resetView: () => fly(homeView()),
    homeView,
    dispose: () => {
      cancelAnimationFrame(raf);
      gsap.killTweensOf([camera.position, target]);
      ro.disconnect();
      controls?.dispose();
      s.scene.traverse((o) => {
        o.geometry?.dispose();
        [o.material].flat().forEach((m) => m?.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
    },
  };
}

export default function Twin3D({ graph, live, selected, onSelect, theme }) {
  const mount = useRef(null), twinRef = useRef(null), liveRef = useRef(live), selRef = useRef(selected), pickRef = useRef(onSelect);
  liveRef.current = live;
  selRef.current = selected;
  pickRef.current = onSelect;
  const [allLabels, setAllLabels] = useState(false);
  const labelsRef = useRef(allLabels);
  labelsRef.current = allLabels;

  useEffect(() => {
    const twin = createTwin(mount.current, graph, { onPick: (id) => pickRef.current(id) });
    twinRef.current = twin;
    twin.setAllLabels(labelsRef.current);
    twin.apply(liveRef.current, selRef.current);
    return () => { twin.dispose(); twinRef.current = null; };
  }, [graph, theme]);

  useEffect(() => { twinRef.current?.apply(live, selected); }, [live, selected]);
  useEffect(() => { if (selected) twinRef.current?.flyTo(selected); }, [selected]);
  useEffect(() => { twinRef.current?.setAllLabels(allLabels); }, [allLabels]);

  return (
    <div ref={mount} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div className="tw3-tools">
        <button onClick={() => setAllLabels((v) => !v)}>{allLabels ? "Hide equipment names" : "Show all equipment names"}</button>
        <button onClick={() => { onSelect(null); twinRef.current?.resetView(); }}>Reset view</button>
      </div>
      <p className="tw3-hint">Drag to turn the building. Right-drag to move, scroll to zoom, click equipment to inspect it.</p>
    </div>
  );
}
