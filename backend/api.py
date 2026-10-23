"""VitalGrid API. Run (from repo root): uvicorn backend.api:app --reload"""
import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.db import get_db
from backend.live import LiveEngine
from sim.simulator import FAULTS, METRICS, NODE_TYPE, NODES

engine = LiveEngine()


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(engine.run())
    yield
    task.cancel()


app = FastAPI(title="VitalGrid API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def mark_active(request: Request, call_next):
    if request.url.path != "/health":  # Render's health checks must not keep the simulator running
        engine.touch()
    return await call_next(request)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/graph")
def graph():
    db = get_db()
    return {"nodes": list(db.nodes.find()), "edges": list(db.edges.find({}, {"_id": 0}))}


@app.get("/faults")
def faults():
    return {k: v for k, v in FAULTS.items() if k != "normal"}


@app.get("/nodes/{node_id}/telemetry")
def telemetry(node_id: str, seconds: int = Query(300, ge=10, le=3600)):
    if node_id not in NODES:
        raise HTTPException(404, "unknown node")
    since = datetime.now(timezone.utc) - timedelta(seconds=seconds)
    cur = get_db().telemetry_live.find({"meta.scenario_id": "live", "meta.node_id": node_id, "ts": {"$gte": since}},
                                       {"_id": 0, "meta": 0}).sort("ts", 1)
    return {"node_id": node_id, "metrics": METRICS[NODE_TYPE[node_id]], "points": list(cur)}


@app.get("/results/latest")
def latest():
    return engine.latest


class Injection(BaseModel):
    fault_type: Literal[tuple(k for k in FAULTS if k != "normal")]
    node_id: str
    severity: float = Field(0.8, ge=0, le=1)


@app.post("/inject")
def inject(body: Injection):
    if body.node_id not in FAULTS[body.fault_type]:
        raise HTTPException(422, f"{body.fault_type} cannot start at {body.node_id}")
    engine.sim.restore()  # one fault at a time keeps the demo readable
    engine.sim.inject(body.fault_type, body.node_id, body.severity)
    return {"fault": engine.sim.fault}


@app.post("/reset")
def reset():
    engine.sim.restore()
    return {"fault": None}


@app.get("/metrics")
def metrics():
    return list(get_db().metrics.find({}, {"_id": 0}))


@app.websocket("/live")
async def live(ws: WebSocket):
    await ws.accept()
    engine.clients.add(ws)
    engine.touch()
    try:
        await ws.send_json(engine.latest)
        while True:
            await ws.receive_text()  # keeps the socket open; the client sends nothing meaningful
    except WebSocketDisconnect:
        pass
    finally:
        engine.clients.discard(ws)
