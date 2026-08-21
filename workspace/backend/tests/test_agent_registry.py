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


def test_logo_endpoint(client):
    """Logos are served from /registry/icons — self-contained catalog."""
    r = client.get("/v1/agent-catalog/claude/logo")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/svg+xml")
    assert b"<svg" in r.content

    assert client.get("/v1/agent-catalog/does-not-exist/logo").status_code == 404

    # Every agent ships its own artwork — no default.svg fallbacks in practice.
    # (Adding an agent without an icon fails here: drop one in /registry/icons.)
    entries = client.get("/v1/agent-registry").json()["data"]
    for e in entries:
        key = (e.get("logo") or {}).get("key") or e["name"]
        icon = BACKEND_REGISTRY / "icons" / f"{key}.svg"
        assert icon.is_file(), f"missing /registry/icons/{key}.svg for agent {e['name']}"

    # Listing and detail point at the logo endpoint.
    listing = client.get("/v1/agent-catalog").json()["data"]
    claude = next(a for a in listing if a["name"] == "claude")
    assert claude["logo"]["url"] == "/v1/agent-catalog/claude/logo"
    detail = client.get("/v1/agent-catalog/claude").json()["data"]
    assert detail["logo"]["url"] == "/v1/agent-catalog/claude/logo"


def test_backend_copy_matches_canonical():
    """The in-image copy must match the canonical repo-root registry — run
    workspace/backend/scripts/sync_registry.py after editing /registry."""
    if not REPO_REGISTRY.is_dir():
        return  # canonical dir not in this checkout (e.g. slim deploy) — skip
    src = {f.name: json.loads(f.read_text()) for f in REPO_REGISTRY.glob("*.json")}
    dst = {f.name: json.loads(f.read_text()) for f in BACKEND_REGISTRY.glob("*.json")}
    assert src == dst, "registry drift — run scripts/sync_registry.py"
    src_icons = {f.name: f.read_bytes() for f in (REPO_REGISTRY / "icons").glob("*.svg")}
    dst_icons = {f.name: f.read_bytes() for f in (BACKEND_REGISTRY / "icons").glob("*.svg")}
    assert src_icons == dst_icons, "icon drift — run scripts/sync_registry.py"


def test_provider_catalog_copy_matches_canonical():
    """Same drift guard for the /cloud_providers JSON catalog."""
    repo_dir = BACKEND.parents[1] / "cloud_providers"
    backend_dir = BACKEND / "cloud_providers"
    if not repo_dir.is_dir():
        return  # canonical dir not in this checkout — skip
    src = {f.name: json.loads(f.read_text()) for f in repo_dir.glob("*.json")}
    dst = {f.name: json.loads(f.read_text()) for f in backend_dir.glob("*.json")}
    assert src == dst, "provider catalog drift — run scripts/sync_registry.py"


def test_providers_load_from_files():
    """PROVIDERS must come from the JSON catalog when the files are present."""
    from app.services.cloud_providers import PROVIDERS, _load_providers_from_files
    loaded = _load_providers_from_files()
    assert loaded, "cloud_providers/*.json should be present"
    assert set(PROVIDERS) == set(loaded)
    assert any(m.id == "claude-fable-5" for m in PROVIDERS["anthropic"].models)
