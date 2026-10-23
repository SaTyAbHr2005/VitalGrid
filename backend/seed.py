"""Creates collections and indexes, then (re)loads nodes and edges from graph/topology.yaml.

Safe to re-run: existing collections are kept, nodes/edges are replaced.
Usage (from repo root): python -m backend.seed
"""
from pymongo import ASCENDING, DESCENDING

from backend.db import get_db
from graph.topology import load

TIMESERIES = {"timeField": "ts", "metaField": "meta", "granularity": "seconds"}


def create_collections(db):
    existing = set(db.list_collection_names())
    if "telemetry" not in existing:
        db.create_collection("telemetry", timeseries=TIMESERIES)
    if "telemetry_live" not in existing:
        # Live demo data deletes itself after 1 h so it can't fill the 512 MB M0 tier.
        db.create_collection("telemetry_live", timeseries=TIMESERIES, expireAfterSeconds=3600)

    db.edges.create_index([("source", ASCENDING)])
    db.edges.create_index([("target", ASCENDING)])
    db.scenarios.create_index([("split", ASCENDING)])
    db.ground_truth.create_index([("scenario_id", ASCENDING), ("node_id", ASCENDING)], unique=True)
    db.results.create_index([("ts", DESCENDING)], expireAfterSeconds=86400)
    db.metrics.create_index([("method", ASCENDING)])


def seed_graph(db):
    g = load()
    db.nodes.delete_many({})
    db.nodes.insert_many(
        [{"_id": n["id"], "type": n["type"], "room": n["room"], "criticality": n["criticality"]} for n in g["nodes"]]
    )
    db.edges.delete_many({})
    db.edges.insert_many(
        [{"_id": f"{e['source']}|{e['relation']}|{e['target']}", **e} for e in g["edges"]]
    )
    return g


if __name__ == "__main__":
    db = get_db()
    create_collections(db)
    g = seed_graph(db)
    assert db.nodes.count_documents({}) == len(g["nodes"])
    assert db.edges.count_documents({}) == len(g["edges"])
    stats = db.command("dbStats")
    print(f"seeded {len(g['nodes'])} nodes, {len(g['edges'])} edges into '{db.name}'")
    print(f"collections: {sorted(db.list_collection_names())}")
    print(f"storage: {stats['storageSize'] / 1e6:.2f} MB")
