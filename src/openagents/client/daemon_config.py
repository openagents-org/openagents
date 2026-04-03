"""
Daemon configuration — YAML-based persistent config for agent connections.

Config file: ~/.openagents/daemon.yaml

Schema v2 separates agents from networks:
    agents:
      - name: my-bot
        type: claude
        network: my-workspace   # optional — null = local-only
        ...
    networks:
      - slug: my-workspace
        id: ws-123
        token: xxx
        ...

Schema v1 (legacy) nests agents inside workspaces. Migrated on load.
"""

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import yaml

logger = logging.getLogger(__name__)

CONFIG_DIR = Path.home() / ".openagents"
CONFIG_PATH = CONFIG_DIR / "daemon.yaml"
PID_PATH = CONFIG_DIR / "daemon.pid"
LOG_PATH = CONFIG_DIR / "daemon.log"
STATUS_PATH = CONFIG_DIR / "daemon.status.json"
CMD_PATH = CONFIG_DIR / "daemon.cmd"
ENV_DIR = CONFIG_DIR / "env"
AGENTS_DIR = CONFIG_DIR / "agents"

DEFAULT_ENDPOINT = "https://workspace-endpoint.openagents.org"


# ---------------------------------------------------------------------------
# Data classes (v2)
# ---------------------------------------------------------------------------

@dataclass
class AgentEntry:
    """A single agent managed by the daemon."""
    name: str
    type: str  # claude, openclaw, codex, etc.
    role: str = "worker"
    path: Optional[str] = None  # working directory
    network: Optional[str] = None  # network slug/id — None = local-only
    options: dict = field(default_factory=dict)
    env: dict = field(default_factory=dict)  # per-agent environment variables (e.g. API keys)


@dataclass
class NetworkEntry:
    """A remote network the client can connect agents to."""
    id: str
    slug: str
    name: str
    token: str
    endpoint: str = DEFAULT_ENDPOINT


@dataclass
class DaemonConfig:
    """Top-level daemon configuration (v2)."""
    version: int = 2
    agents: list[AgentEntry] = field(default_factory=list)
    networks: list[NetworkEntry] = field(default_factory=list)


# Legacy alias for backward compatibility with code that imports WorkspaceEntry
WorkspaceEntry = NetworkEntry


# ---------------------------------------------------------------------------
# Load / Save
# ---------------------------------------------------------------------------

def _migrate_v1(raw: dict) -> dict:
    """Migrate v1 config (agents nested in workspaces) to v2 (flat)."""
    agents = []
    networks = []
    for ws_raw in raw.get("workspaces", []):
        slug = ws_raw.get("slug", "")
        net = {
            "id": ws_raw["id"],
            "slug": slug,
            "name": ws_raw.get("name", ""),
            "token": ws_raw["token"],
            "endpoint": ws_raw.get("endpoint", DEFAULT_ENDPOINT),
        }
        networks.append(net)
        for a in ws_raw.get("agents", []):
            agents.append({
                "name": a["name"],
                "type": a["type"],
                "role": a.get("role", "worker"),
                "network": slug or ws_raw["id"],
                "options": a.get("options", {}),
            })
    return {"version": 2, "agents": agents, "networks": networks}


def load_config(path: Optional[Path] = None) -> DaemonConfig:
    """Load daemon config from YAML. Returns empty config if file missing."""
    p = Path(path) if path else CONFIG_PATH
    if not p.exists():
        return DaemonConfig()

    try:
        raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    except Exception as e:
        logger.warning(f"Failed to parse {p}: {e}")
        return DaemonConfig()

    # Auto-migrate v1 → v2
    version = raw.get("version", 1)
    if version < 2:
        raw = _migrate_v1(raw)
        # Save migrated config
        try:
            _save_raw(raw, p)
        except Exception as e:
            logger.warning(f"Failed to save migrated config: {e}")

    agents = [
        AgentEntry(
            name=a["name"],
            type=a["type"],
            role=a.get("role", "worker"),
            path=a.get("path"),
            network=a.get("network"),
            options=a.get("options", {}),
            env=a.get("env", {}),
        )
        for a in raw.get("agents", [])
    ]

    networks = [
        NetworkEntry(
            id=n["id"],
            slug=n.get("slug", ""),
            name=n.get("name", ""),
            token=n["token"],
            endpoint=n.get("endpoint", DEFAULT_ENDPOINT),
        )
        for n in raw.get("networks", [])
    ]

    return DaemonConfig(version=2, agents=agents, networks=networks)


def _save_raw(data: dict, p: Path) -> None:
    """Write raw dict to YAML."""
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(yaml.dump(data, default_flow_style=False, sort_keys=False), encoding="utf-8")
    try:
        p.chmod(0o600)
    except OSError:
        pass


def save_config(config: DaemonConfig, path: Optional[Path] = None) -> None:
    """Save daemon config to YAML."""
    p = Path(path) if path else CONFIG_PATH

    data = {
        "version": config.version,
        "agents": [
            {k: v for k, v in {
                "name": a.name,
                "type": a.type,
                "role": a.role,
                "path": a.path,
                "network": a.network,
                "options": a.options or None,
                "env": a.env or None,
            }.items() if v is not None}
            for a in config.agents
        ],
        "networks": [
            {k: v for k, v in {
                "id": n.id,
                "slug": n.slug,
                "name": n.name,
                "token": n.token,
                "endpoint": n.endpoint if n.endpoint != DEFAULT_ENDPOINT else None,
            }.items() if v is not None}
            for n in config.networks
        ],
    }

    _save_raw(data, p)


# ---------------------------------------------------------------------------
# Config manipulation helpers
# ---------------------------------------------------------------------------

def add_agent_to_config(
    agent: AgentEntry,
    path: Optional[Path] = None,
) -> None:
    """Add or update an agent in the config."""
    config = load_config(path)
    for i, a in enumerate(config.agents):
        if a.name == agent.name:
            config.agents[i] = agent
            save_config(config, path)
            return
    config.agents.append(agent)
    save_config(config, path)


def add_network_to_config(
    network: NetworkEntry,
    path: Optional[Path] = None,
) -> None:
    """Add a network to the config (or update if exists)."""
    config = load_config(path)
    for i, n in enumerate(config.networks):
        if n.id == network.id or n.slug == network.slug:
            config.networks[i] = network
            save_config(config, path)
            return
    config.networks.append(network)
    save_config(config, path)


# Backward-compat aliases
def add_workspace_to_config(workspace: NetworkEntry, path: Optional[Path] = None) -> None:
    """Backward-compat alias for add_network_to_config."""
    add_network_to_config(workspace, path)


def connect_agent_to_network(
    agent_name: str,
    network_slug: str,
    path: Optional[Path] = None,
) -> bool:
    """Set an agent's network field. Returns True if agent found."""
    config = load_config(path)
    for a in config.agents:
        if a.name == agent_name:
            a.network = network_slug
            save_config(config, path)
            return True
    return False


def disconnect_agent_from_network(
    agent_name: str,
    path: Optional[Path] = None,
) -> bool:
    """Clear an agent's network field (make it local-only). Returns True if found."""
    config = load_config(path)
    for a in config.agents:
        if a.name == agent_name:
            a.network = None
            save_config(config, path)
            return True
    return False


def remove_agent_from_config(
    agent_name: str,
    path: Optional[Path] = None,
) -> bool:
    """Remove an agent by name. Returns True if found and removed."""
    config = load_config(path)
    original_len = len(config.agents)
    config.agents = [a for a in config.agents if a.name != agent_name]
    if len(config.agents) < original_len:
        save_config(config, path)
        return True
    return False


def find_agent_in_config(
    agent_name: str,
    path: Optional[Path] = None,
) -> Optional[AgentEntry]:
    """Find an agent by name."""
    config = load_config(path)
    for a in config.agents:
        if a.name == agent_name:
            return a
    return None


def find_network_in_config(
    network_ref: str,
    path: Optional[Path] = None,
) -> Optional[NetworkEntry]:
    """Find a network by slug or id."""
    config = load_config(path)
    for n in config.networks:
        if n.slug == network_ref or n.id == network_ref:
            return n
    return None


def get_agent_network(
    agent: AgentEntry,
    config: DaemonConfig,
) -> Optional[NetworkEntry]:
    """Get the network entry for an agent, if connected."""
    if not agent.network:
        return None
    for n in config.networks:
        if n.slug == agent.network or n.id == agent.network:
            return n
    return None


# ---------------------------------------------------------------------------
# Status file (written by daemon, read by `openagents status`)
# ---------------------------------------------------------------------------

def write_status(statuses: dict, pid: int) -> None:
    """Write daemon status to JSON file."""
    STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "pid": pid,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "agents": statuses,
    }
    STATUS_PATH.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")


def read_status() -> Optional[dict]:
    """Read daemon status. Returns None if not available."""
    if not STATUS_PATH.exists():
        return None
    try:
        return json.loads(STATUS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Per-agent-type environment variables
# ---------------------------------------------------------------------------

def load_agent_env(agent_type: str) -> dict[str, str]:
    """Load saved env vars for an agent type from ~/.openagents/env/<type>.env."""
    env_file = ENV_DIR / f"{agent_type}.env"
    if not env_file.exists():
        return {}
    env = {}
    try:
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip()
    except Exception:
        return {}
    return env


def save_agent_env(agent_type: str, env: dict[str, str]) -> None:
    """Save env vars for an agent type to ~/.openagents/env/<type>.env."""
    ENV_DIR.mkdir(parents=True, exist_ok=True)
    env_file = ENV_DIR / f"{agent_type}.env"
    lines = [f"{k}={v}" for k, v in env.items() if v]
    env_file.write_text("\n".join(lines) + "\n" if lines else "", encoding="utf-8")
    try:
        env_file.chmod(0o600)
    except OSError:
        pass
