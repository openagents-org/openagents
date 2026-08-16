# -*- coding: utf-8 -*-
"""Agent-type catalog — single source of truth.

Per-agent JSON files live under the repo-root ``/registry/`` directory (one file
per agent type: logo, name, description, install/uninstall, readiness, and the
supported models). This service loads them and serves both a listing and a
per-agent detail via ``/v1/agent-catalog``. Every client — the workspace
frontend and the launcher — reads from that API rather than keeping its own
copy.

``models`` in a registry file is either an explicit list of ``{id,label}`` or a
provider reference ``{"provider": "anthropic"}`` that we resolve here against the
always-current cloud-provider catalog, so model lists never go stale in more
than one place.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Optional

from app.services.cloud_providers import PROVIDERS


def _registry_dir() -> Optional[Path]:
    """Locate the registry directory.

    Order: ``AGENT_REGISTRY_DIR`` env → a copy shipped inside the backend image
    (``workspace/backend/registry``) → the canonical repo-root ``/registry``
    (present in dev, CI and tests). Returns None if none exists, so callers can
    fall back to the legacy static catalog rather than 500.
    """
    env = os.environ.get("AGENT_REGISTRY_DIR")
    candidates = []
    if env:
        candidates.append(Path(env))
    here = Path(__file__).resolve()
    # .../workspace/backend/app/services/agent_registry.py
    candidates.append(here.parents[2] / "registry")   # workspace/backend/registry (in-image)
    candidates.append(here.parents[4] / "registry")   # <repo>/registry (dev/CI)
    for c in candidates:
        if c.is_dir() and any(c.glob("*.json")):
            return c
    return None


def _resolve_models(models) -> list[dict]:
    """Expand a provider reference to the live model list, or pass through an
    explicit list. Always returns a list of ``{id, label, category?}``."""
    if isinstance(models, dict) and models.get("provider"):
        prov = PROVIDERS.get(models["provider"])
        if not prov:
            return []
        return [{"id": m.id, "label": m.label, "category": m.category} for m in prov.models]
    if isinstance(models, list):
        out = []
        for m in models:
            if isinstance(m, dict) and m.get("id"):
                out.append({"id": m["id"], "label": m.get("label", m["id"]), "category": m.get("category", "chat")})
            elif isinstance(m, str):
                out.append({"id": m, "label": m, "category": "chat"})
        return out
    return []


@lru_cache(maxsize=1)
def _load_raw() -> dict[str, dict]:
    """Read every ``<name>.json`` (excluding index.json) into a name→entry map.
    Cached; ``reload()`` clears it."""
    d = _registry_dir()
    if not d:
        return {}
    entries: dict[str, dict] = {}
    for f in sorted(d.glob("*.json")):
        if f.name == "index.json":
            continue
        try:
            data = json.loads(f.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        name = data.get("name") or f.stem
        entries[name] = data
    return entries


def reload() -> None:
    _load_raw.cache_clear()


def available() -> bool:
    """Whether the file-based registry is present (else callers use the legacy catalog)."""
    return bool(_load_raw())


def _install_command(entry: dict) -> str:
    inst = entry.get("install") or {}
    return inst.get("macos") or inst.get("linux") or inst.get("windows") or ""


def _summary(entry: dict) -> dict:
    """Backward-compatible listing shape (matches the legacy /agent-catalog) plus
    logo. Full details (install/uninstall/models/readiness) come from the detail
    endpoint."""
    return {
        "name": entry.get("name"),
        "label": entry.get("label"),
        "description": entry.get("description", ""),
        "install_command": _install_command(entry),
        "homepage": entry.get("homepage") or "",
        "tags": entry.get("tags") or [],
        "builtin": bool(entry.get("builtin")),
        "featured": bool(entry.get("featured")),
        "order": entry.get("order", 999),
        "logo": entry.get("logo"),
    }


def _detail(entry: dict) -> dict:
    out = dict(entry)
    out["models"] = _resolve_models(entry.get("models"))
    out["install_command"] = _install_command(entry)
    return out


def list_agents() -> list[dict]:
    """Agent types shown in the picker as summaries, featured first then by
    order. Entries with ``"catalog": false`` (e.g. experimental runtimes) are
    excluded from the listing but remain fetchable by detail."""
    items = [_summary(e) for e in _load_raw().values() if e.get("catalog", True)]
    items.sort(key=lambda x: (not x["featured"], x["order"], x["name"] or ""))
    return items


def get_agent(name: str) -> Optional[dict]:
    """Full detail for one agent type (models resolved), or None if unknown."""
    entry = _load_raw().get(name)
    return _detail(entry) if entry else None
