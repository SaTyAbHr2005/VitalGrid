"""Expands topology.yaml into flat node and edge lists. Run directly to self-check."""
from pathlib import Path

import yaml

TOPOLOGY_PATH = Path(__file__).with_name("topology.yaml")


def load(path=TOPOLOGY_PATH):
    spec = yaml.safe_load(Path(path).read_text())
    nodes = [{**n, "room": None} for n in spec["shared_nodes"]]
    edges = [tuple(e) for e in spec["shared_edges"]]
    for r in spec["rooms"]:
        nodes += [{**n, "id": n["id"].format(r=r), "room": r} for n in spec["room_nodes"]]
        edges += [tuple(x.format(r=r) for x in e) for e in spec["room_edges"]]

    ids = [n["id"] for n in nodes]
    assert len(ids) == len(set(ids)), "duplicate node id"
    for n in nodes:
        assert n["type"] in spec["node_types"], f"unknown type {n['type']} on {n['id']}"
    for s, rel, t in edges:
        assert s in ids and t in ids, f"edge {s}->{t} references unknown node"
        assert rel in spec["relations"], f"unknown relation {rel}"
    assert len(edges) == len(set(edges)), "duplicate edge"

    return {
        "nodes": nodes,
        "edges": [{"source": s, "relation": rel, "target": t} for s, rel, t in edges],
        "relations": spec["relations"],
        "node_types": spec["node_types"],
    }


if __name__ == "__main__":
    g = load()
    assert len(g["nodes"]) == 28, len(g["nodes"])
    assert len(g["edges"]) == 53, len(g["edges"])
    print(f"ok: {len(g['nodes'])} nodes, {len(g['edges'])} edges")
