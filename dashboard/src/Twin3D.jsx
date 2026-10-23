import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import { activeEdges, cssVar, nodeState, position, relationColor, stateColor } from "./twin.js";

export default function Twin3D({ graph, live, onSelect, theme }) {
  const box = useRef(null);
  const [size, setSize] = useState({ width: 800, height: 500 });
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  // Graph structure only changes with the topology, so the layout stays put while live data updates colors.
  const data = useMemo(() => ({
    nodes: graph.nodes.map((n) => {
      const p = position(n._id).abs || position(n._id);
      return { id: n._id, type: n.type, fx: p.x - 460, fy: -(p.y - 400), fz: n.type === "power" || n.type === "gas" ? 0 : 60 };
    }),
    links: graph.edges.map((e) => ({ source: e.source, target: e.target, relation: e.relation })),
  }), [graph]);

  const byId = Object.fromEntries((live?.nodes || []).map((n) => [n.id, n]));
  const active = activeEdges(live);
  const key = (l) => `${l.source.id ?? l.source}>${l.target.id ?? l.target}`;

  return (
    <div ref={box} style={{ position: "absolute", inset: 0 }}>
      <ForceGraph3D
        graphData={data} width={size.width} height={size.height} key={theme} backgroundColor={cssVar("--ward")}
        nodeLabel={(n) => `${n.id}: risk ${(byId[n.id]?.p ?? 0).toFixed(2)}`}
        nodeColor={(n) => stateColor(nodeState(byId[n.id]))} nodeRelSize={6}
        linkColor={(l) => (active.has(key(l)) ? stateColor("alarm") : relationColor(l.relation))}
        linkWidth={(l) => (active.has(key(l)) ? 2.5 : 0.6)}
        linkDirectionalParticles={(l) => (active.has(key(l)) ? 4 : 0)}
        linkDirectionalParticleColor={() => stateColor("alarm")}
        linkDirectionalParticleWidth={2.5}
        onNodeClick={(n) => onSelect(n.id)}
      />
    </div>
  );
}
