# -*- coding: utf-8 -*-
"""
Skill Hub catalog — static registry of available workspace skills.

Each skill maps to a toggleable capability module that agents can use.
The catalog is versioned with the codebase; the database stores only
per-agent overrides (WorkspaceMember.enabled_skills JSONB).
"""

from typing import Dict, List, Optional, Set

SKILL_CATALOG: List[dict] = [
    {
        "id": "workspace-core",
        "name": "Workspace Core",
        "description": "Messaging, agent discovery, and status — always available",
        "category": "core",
        "icon": "message-square",
        "module_key": None,
        "default_enabled": True,
        "toggleable": False,
    },
    {
        "id": "files",
        "name": "Shared Files",
        "description": "Upload, download, and share files across workspace agents and users",
        "category": "collaboration",
        "icon": "file-text",
        "module_key": "files",
        "default_enabled": True,
        "toggleable": True,
    },
    {
        "id": "browser",
        "name": "Shared Browser",
        "description": "Browse websites through the workspace's shared browser session",
        "category": "collaboration",
        "icon": "globe",
        "module_key": "browser",
        "default_enabled": True,
        "toggleable": True,
    },
    {
        "id": "tunnel",
        "name": "Cloudflare Tunnel",
        "description": "Expose local services to the internet via secure tunnels",
        "category": "collaboration",
        "icon": "cloud",
        "module_key": "tunnel",
        "default_enabled": True,
        "toggleable": True,
    },
    {
        "id": "todos",
        "name": "Task Planning",
        "description": "Create and manage to-do lists for coordinated agent work",
        "category": "productivity",
        "icon": "check-square",
        "module_key": "todos",
        "default_enabled": True,
        "toggleable": True,
    },
    {
        "id": "timers",
        "name": "Timers",
        "description": "Set countdown timers with callback messages",
        "category": "productivity",
        "icon": "timer",
        "module_key": "timers",
        "default_enabled": True,
        "toggleable": True,
    },
    {
        "id": "routines",
        "name": "Routines",
        "description": "Schedule recurring tasks on a daily or interval basis",
        "category": "productivity",
        "icon": "repeat",
        "module_key": "routines",
        "default_enabled": True,
        "toggleable": True,
    },
]

_TOGGLEABLE = {s["id"]: s for s in SKILL_CATALOG if s["toggleable"]}


def get_catalog() -> List[dict]:
    """Return the full skill catalog."""
    return list(SKILL_CATALOG)


def get_skill_defaults() -> Dict[str, bool]:
    """Return ``{skill_id: default_enabled}`` for all toggleable skills."""
    return {s["id"]: s["default_enabled"] for s in _TOGGLEABLE.values()}


def skills_to_disabled_modules(enabled_skills: Optional[Dict[str, bool]]) -> Set[str]:
    """Convert a per-agent ``enabled_skills`` JSONB dict to a ``disabledModules`` Set.

    * ``None`` (no overrides) → empty set (everything enabled).
    * Missing keys → treated as ``default_enabled``.
    """
    if not enabled_skills:
        return set()

    defaults = get_skill_defaults()
    disabled: Set[str] = set()

    for skill_id, skill in _TOGGLEABLE.items():
        is_enabled = enabled_skills.get(skill_id, defaults[skill_id])
        if not is_enabled and skill["module_key"]:
            disabled.add(skill["module_key"])

    return disabled
