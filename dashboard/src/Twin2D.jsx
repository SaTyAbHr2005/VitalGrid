import { useMemo } from "react";
import { Background, Handle, Position, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { KIND_LABEL, RELATION_STYLE, ROOMS, ROOM_SIZE, activeEdges, cssVar, nodeState, position } from "./twin.js";

function TwinNode({ data }) {
  const { node, live, selected } = data;
  const state = nodeState(live);
  const risk = Math.max(live?.r ?? 0, live?.p ?? 0);
  return (
    <div className={`tnode ${state} ${selected ? "selected" : ""}`} title={`risk ${risk.toFixed(2)}`}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="id">{node._id}</div>
      <div className="kind">{KIND_LABEL[node.type]}</div>
      <div className="bar"><span style={{ width: `${Math.round(risk * 100)}%` }} /></div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

function RoomNode({ data }) {
  return <div className="room-label">ICU room {data.room}</div>;
}

const nodeTypes = { twin: TwinNode, room: RoomNode };

export default function Twin2D({ graph, live, selected, onSelect, theme }) {
  const byId = useMemo(() => Object.fromEntries((live?.nodes || []).map((n) => [n.id, n])), [live]);
  const active = useMemo(() => activeEdges(live), [live]);

  const nodes = useMemo(() => {
    const rooms = ROOMS.map(({ room, x, y }) => ({
      id: `room-${room}`, type: "room", position: { x, y }, data: { room }, selectable: false,
      style: { width: ROOM_SIZE[0], height: ROOM_SIZE[1], background: "var(--room-bg)",
        border: "1px solid var(--steel)", borderRadius: 10 },
    }));
    const twins = graph.nodes.map((node) => {
      const p = position(node._id);
      return {
        id: node._id, type: "twin", position: { x: p.x, y: p.y },
        ...(p.room ? { parentId: `room-${p.room}` } : {}),
        data: { node, live: byId[node._id], selected: selected === node._id },
      };
    });
    return [...rooms, ...twins];
  }, [graph, byId, selected]);

  const edges = useMemo(() => graph.edges.map((e) => {
    const key = `${e.source}>${e.target}`;
    const on = active.has(key);
    const s = RELATION_STYLE[e.relation];
    return {
      id: key, source: e.source, target: e.target, animated: on, zIndex: on ? 10 : 0,
      style: { stroke: on ? "var(--alarm)" : s.color, strokeWidth: on ? 2.6 : 1.2,
        strokeDasharray: on ? undefined : s.dash, opacity: on || active.size === 0 ? 0.9 : 0.25 },
    };
  }), [graph, active]);

  return (
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.3} colorMode={theme}
      nodesDraggable={false} nodesConnectable={false} edgesFocusable={false}
      onNodeClick={(_, n) => n.type === "twin" && onSelect(n.id)}
      proOptions={{ hideAttribution: true }}
    >
      <Background key={theme} gap={24} color={cssVar("--grid-dot")} bgColor={cssVar("--ward")} />
    </ReactFlow>
  );
}
