"""Blitzwing Discovery Service — updatable mother registry keyed by model."""

from __future__ import annotations

import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Generator, List, Optional
from urllib.parse import unquote

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

DB_PATH = Path(os.getenv("DISCOVERY_DB_PATH", str(Path.home() / ".blitzwing" / "discovery.db")))
ADMIN_TOKEN = os.getenv("DISCOVERY_ADMIN_TOKEN", "")


class MotherCreate(BaseModel):
    model: str = Field(..., min_length=1)
    mother_url: str = Field(..., min_length=1)
    total_layers: int = Field(..., ge=1)


class MotherUpdate(BaseModel):
    mother_url: Optional[str] = None
    total_layers: Optional[int] = Field(default=None, ge=1)


class MotherRecord(BaseModel):
    model: str
    mother_url: str
    total_layers: int
    updated_at: int


def _init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS mothers (
                model TEXT PRIMARY KEY,
                mother_url TEXT NOT NULL,
                total_layers INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )


@contextmanager
def _connect() -> Generator[sqlite3.Connection, None, None]:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def require_admin(authorization: Optional[str] = Header(default=None)) -> None:
    if not ADMIN_TOKEN:
        raise HTTPException(
            status_code=500,
            detail="DISCOVERY_ADMIN_TOKEN is not configured on the discovery service",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    if token != ADMIN_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid admin token")


app = FastAPI(title="Blitzwing Discovery Service", version="0.1.0")


@app.on_event("startup")
def startup() -> None:
    _init_db()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "discovery"}


@app.get("/v1/mothers", response_model=List[MotherRecord])
def list_mothers() -> List[MotherRecord]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT model, mother_url, total_layers, updated_at FROM mothers ORDER BY model"
        ).fetchall()
    return [MotherRecord(**dict(r)) for r in rows]


@app.get("/v1/mothers/{model:path}", response_model=MotherRecord)
def get_mother(model: str) -> MotherRecord:
    model = unquote(model)
    with _connect() as conn:
        row = conn.execute(
            "SELECT model, mother_url, total_layers, updated_at FROM mothers WHERE model = ?",
            (model,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"No mother registered for model '{model}'")
    return MotherRecord(**dict(row))


@app.post("/v1/mothers/register", response_model=MotherRecord, dependencies=[Depends(require_admin)])
def register_mother(body: MotherCreate) -> MotherRecord:
    now = int(time.time())
    with _connect() as conn:
        existing = conn.execute("SELECT 1 FROM mothers WHERE model = ?", (body.model,)).fetchone()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Model '{body.model}' already registered. Use PUT to update mother_url.",
            )
        conn.execute(
            "INSERT INTO mothers (model, mother_url, total_layers, updated_at) VALUES (?, ?, ?, ?)",
            (body.model, body.mother_url.rstrip("/"), body.total_layers, now),
        )
    return MotherRecord(
        model=body.model,
        mother_url=body.mother_url.rstrip("/"),
        total_layers=body.total_layers,
        updated_at=now,
    )


@app.put("/v1/mothers/{model:path}", response_model=MotherRecord, dependencies=[Depends(require_admin)])
def update_mother(model: str, body: MotherUpdate) -> MotherRecord:
    model = unquote(model)
    if body.mother_url is None and body.total_layers is None:
        raise HTTPException(status_code=400, detail="Provide mother_url and/or total_layers")
    with _connect() as conn:
        row = conn.execute(
            "SELECT model, mother_url, total_layers, updated_at FROM mothers WHERE model = ?",
            (model,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"No mother registered for model '{model}'")
        mother_url = body.mother_url.rstrip("/") if body.mother_url else row["mother_url"]
        total_layers = body.total_layers if body.total_layers is not None else row["total_layers"]
        now = int(time.time())
        conn.execute(
            "UPDATE mothers SET mother_url = ?, total_layers = ?, updated_at = ? WHERE model = ?",
            (mother_url, total_layers, now, model),
        )
    return MotherRecord(model=model, mother_url=mother_url, total_layers=total_layers, updated_at=now)


@app.delete("/v1/mothers/{model:path}", dependencies=[Depends(require_admin)])
def delete_mother(model: str) -> dict:
    model = unquote(model)
    with _connect() as conn:
        cur = conn.execute("DELETE FROM mothers WHERE model = ?", (model,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"No mother registered for model '{model}'")
    return {"deleted": model}
