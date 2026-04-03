# -*- coding: utf-8 -*-
"""
OpenAgents Workspace Backend — FastAPI entry point.

A workspace is an ONM network with workspace-specific mods loaded.
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.config import config
from app.database import get_db
from app.routers import browser, events, files, network, workspaces

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auto-create tables for SQLite (dev mode) — production uses Alembic.
    from app.database import engine, Base, _is_sqlite
    if _is_sqlite:
        from app import models  # noqa: F401 — ensure all models are registered
        Base.metadata.create_all(bind=engine, checkfirst=True)
        logger.info("SQLite: auto-created tables")
    yield
    # Shutdown: close Playwright browser
    from app.browser import BrowserManager
    await BrowserManager.get().shutdown()


app = FastAPI(
    title="OpenAgents Workspace",
    description="Managed agent collaboration environment built on the OpenAgents Network Model",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
origins = [o.strip() for o in config.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(browser.router)
app.include_router(events.router)
app.include_router(files.router)
app.include_router(network.router)
app.include_router(workspaces.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/health")
async def api_health(db: Session = Depends(get_db)):
    """Network stats endpoint expected by the OpenAgents SDK agent launcher."""
    from app.models import Workspace
    from sqlalchemy import select
    workspace = db.execute(
        select(Workspace).where(Workspace.status != "deleted")
        .order_by(Workspace.created_at.desc()).limit(1)
    ).scalar_one_or_none()
    return {
        "success": True,
        "network_id": str(workspace.id) if workspace else "unknown",
        "network_name": workspace.name if workspace else "OpenAgents Workspace",
        "is_running": True,
        "uptime_seconds": 0,
        "topology_mode": "centralized",
        "transports": [
            {"type": "workspace", "config": {}},
        ],
        "agents": {},
        "mods": [
            {"name": "openagents.mods.workspace.messaging", "enabled": True, "config": {}},
        ],
    }


@app.get("/.well-known/openagents.json")
async def network_manifest():
    """ONM network manifest — standard discovery endpoint."""
    base_url = os.environ.get(
        "WORKSPACE_ENDPOINT",
        f"http://{config.HOST}:{config.PORT}",
    )
    return {
        "onm_version": "1.0",
        "name": "OpenAgents Workspace",
        "transports": [
            {"type": "http", "url": f"{base_url}/v1"},
        ],
        "auth": {
            "methods": ["token"],
        },
        "capabilities": ["channels", "files", "events", "presence"],
        "mods": ["messaging", "file_storage", "browser"],
    }
