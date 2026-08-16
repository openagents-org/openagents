# -*- coding: utf-8 -*-
"""Agent registry service + /v1/agent-catalog endpoints, and the repo-root ↔
backend copy drift guard."""

import json
from pathlib import Path

from app.services import agent_registry


BACKEND = Path(__file__).resolve().parents[1]
REPO_REGISTRY = BACKEND.parents[1] / "registry"
BACKEND_REGISTRY = BACKEND / "registry"


def test_registry_is_available():
    assert agent_registry.available(), "registry files should be present"


def test_listing_and_detail(client):
    listing = client.get("/v1/agent-catalog").json()["data"]
    assert isinstance(listing, list) and len(listing) > 5
    names = {a["name"] for a in listing}
    assert "claude" in names
    # Featured agents come first.
    assert listing[0]["featured"] is True

    detail = client.get("/v1/agent-catalog/claude").json()["data"]
    assert detail["name"] == "claude"
    assert detail["install"]["macos"]
    # models is a provider reference (anthropic) resolved to the live list.
    model_ids = [m["id"] for m in detail["models"]]
    assert any(m.startswith("claude-") for m in model_ids)
    assert "claude-opus-5" in model_ids  # current Claude 5 family from cloud_providers


def test_unknown_agent_404(client):
    assert client.get("/v1/agent-catalog/does-not-exist").status_code == 404


def test_full_registry_for_launcher(client):
    """/v1/agent-registry serves every entry with launcher runtime fields."""
    entries = client.get("/v1/agent-registry").json()["data"]
    names = {e["name"] for e in entries}
    # Includes catalog:false runtimes hidden from the workspace picker.
    assert {"claude", "mini-swe-agent", "pi"} <= names
    claude = next(e for e in entries if e["name"] == "claude")
    assert claude["adapter"] and claude["launch"] and claude["install"]["macos"]
    assert any(m["id"] == "claude-opus-5" for m in claude["models"])
    # resolve_env survives for agents that map generic LLM_* vars.
    codex = next(e for e in entries if e["name"] == "codex")
    assert codex.get("resolve_env", {}).get("rules")
    # Featured entries lead the list.
    assert entries[0]["featured"] is True


def test_backend_copy_matches_canonical():
    """The in-image copy must match the canonical repo-root registry — run
    workspace/backend/scripts/sync_registry.py after editing /registry."""
    if not REPO_REGISTRY.is_dir():
        return  # canonical dir not in this checkout (e.g. slim deploy) — skip
    src = {f.name: json.loads(f.read_text()) for f in REPO_REGISTRY.glob("*.json")}
    dst = {f.name: json.loads(f.read_text()) for f in BACKEND_REGISTRY.glob("*.json")}
    assert src == dst, "registry drift — run scripts/sync_registry.py"
