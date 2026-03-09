# -*- coding: utf-8 -*-
"""
OpenAgents Workspace Backend — FastAPI entry point.

A workspace is an ONM network with workspace-specific mods loaded.
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import config
from app.routers import browser, events, files, network, workspaces

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
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
    allow_credentials=True,
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
