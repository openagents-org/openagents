"""
Plugin registry for agent types.

Provides a pluggable system for agent adapters. Agent definitions are loaded
from YAML files in ``openagents/registry/``. Third-party agents can register
via Python entry_points under the group ``openagents.plugins``.

Usage::

    from openagents.client.plugin_registry import registry

    # List all known plugins
    for plugin in registry.list_plugins():
        print(plugin.name, plugin.is_installed())

    # Create an adapter
    adapter = plugin.create_adapter(workspace_id=..., ...)
"""

import importlib.metadata
import json
import logging
import os
import shutil
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


class AgentPlugin(ABC):
    """Base class for agent plugins.

    Subclass this to add a new agent type to OpenAgents.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Short identifier, e.g. 'claude', 'aider'."""

    @property
    @abstractmethod
    def label(self) -> str:
        """Human-readable name, e.g. 'Claude Code CLI'."""

    @property
    @abstractmethod
    def install_command(self) -> str:
        """Shell command or instructions to install, e.g. 'pip install aider-chat'."""

    @abstractmethod
    def is_installed(self) -> bool:
        """Return True if the agent runtime is available on this machine."""

    def which(self) -> Optional[str]:
        """Return path/description of the installed runtime, or None."""
        return None

    @abstractmethod
    def create_adapter(
        self,
        workspace_id: str,
        channel_name: str,
        token: str,
        agent_name: str,
        endpoint: str,
        options: Optional[dict] = None,
        working_dir: Optional[str] = None,
    ) -> object:
        """Create and return an adapter instance with an async .run() method."""

    def check_ready(self) -> tuple[bool, str]:
        """Check if the agent is ready to run (credentials, config, etc.).

        Returns (is_ready, message). Message explains what's missing if not ready,
        or confirms readiness if ready.
        """
        if not self.is_installed():
            return False, f"Not installed. Run: openagents install {self.name}"
        return True, "Ready"

    def get_launch_command(self, agent_name: str, path: Optional[str] = None) -> Optional[list[str]]:
        """Return the command to launch this agent as a subprocess.

        Returns None if this agent type doesn't support local process management.
        Override in subclasses to provide agent-specific launch commands.
        """
        return None

    def get_version(self) -> Optional[str]:
        """Return the installed version string, or None if unavailable."""
        binary = self.which()
        if not binary or not self.is_installed():
            return None
        try:
            import subprocess
            import platform as _plat
            # On Windows, use shell=True if binary is a .cmd wrapper,
            # since .cmd files can't be exec'd directly without a shell.
            use_shell = (
                _plat.system() == "Windows"
                and binary.lower().endswith(".cmd")
            )
            result = subprocess.run(
                [binary, "--version"],
                capture_output=True, text=True, timeout=5,
                shell=use_shell,
            )
            output = (result.stdout or result.stderr or "").strip()
            return output.split("\n")[0].strip() if output else None
        except (OSError, subprocess.TimeoutExpired):
            # OSError includes [WinError 193] for non-Win32 executables
            return None
        except Exception:
            return None

    def required_env_vars(self) -> list[dict]:
        """Return list of config fields this agent may need.

        Each entry: {"name": "VAR_NAME", "description": "...", "required": bool,
                     "password": bool, "placeholder": str}
        """
        return []

    def resolve_env_sources(self) -> list[str]:
        """Return source var names from resolve_env rules.

        Used by the daemon to pull these vars from os.environ
        before calling resolve_env().
        """
        return []

    def resolve_env(self, saved: dict) -> dict:
        """Translate saved config fields to actual environment variables.

        Override in subclasses to map generic config names (e.g. LLM_API_KEY)
        to the env vars the agent process actually reads.
        Default: pass through as-is.
        """
        return saved

    def login_command(self) -> Optional[str]:
        """Return a shell command to authenticate/login, or None if not applicable."""
        return None

    def health_check(self) -> bool:
        """Optional deeper health check beyond is_installed()."""
        return self.is_installed()


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

@dataclass
class PluginInfo:
    """Metadata about a registered plugin (for search/display)."""
    name: str
    label: str
    install_command: str
    description: str = ""
    homepage: str = ""
    tags: list[str] = field(default_factory=list)
    builtin: bool = False
    requires: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Remote catalog
# ---------------------------------------------------------------------------

REGISTRY_URL = "https://endpoint.openagents.org/v1/agent-registry"
CACHE_DIR = Path.home() / ".openagents"
CACHE_PATH = CACHE_DIR / "agent_catalog.json"
CACHE_TTL = 86400  # 24 hours


def _fetch_remote_catalog() -> list[PluginInfo]:
    """Fetch agent catalog from remote registry with 24h cache + offline fallback."""
    if CACHE_PATH.exists():
        try:
            age = time.time() - CACHE_PATH.stat().st_mtime
            if age < CACHE_TTL:
                return _parse_cached()
        except Exception:
            pass

    try:
        import requests
        resp = requests.get(REGISTRY_URL, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            entries = data.get("data", data) if isinstance(data, dict) else data
            if isinstance(entries, list):
                CACHE_DIR.mkdir(parents=True, exist_ok=True)
                CACHE_PATH.write_text(json.dumps(entries))
                return [_entry_to_plugin_info(e) for e in entries]
    except Exception as e:
        logger.debug(f"Remote catalog fetch failed: {e}")

    if CACHE_PATH.exists():
        try:
            return _parse_cached()
        except Exception:
            pass

    return []


def _parse_cached() -> list[PluginInfo]:
    """Parse cached catalog JSON file."""
    data = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    return [_entry_to_plugin_info(e) for e in data]


def _entry_to_plugin_info(entry: dict) -> PluginInfo:
    """Convert a registry API entry dict to a PluginInfo."""
    return PluginInfo(
        name=entry.get("name", ""),
        label=entry.get("label", ""),
        install_command=entry.get("install_command", ""),
        description=entry.get("description", ""),
        homepage=entry.get("homepage", ""),
        tags=entry.get("tags", []),
        builtin=entry.get("builtin", False),
    )


class PluginRegistry:
    """Central registry of agent plugins."""

    def __init__(self):
        self._plugins: dict[str, AgentPlugin] = {}
        self._catalog: dict[str, PluginInfo] = {}
        self._loaded_entry_points = False
        self._loaded_remote_catalog = False

    def register(self, plugin: AgentPlugin, builtin: bool = False) -> None:
        """Register a plugin instance."""
        self._plugins[plugin.name] = plugin
        if plugin.name not in self._catalog:
            self._catalog[plugin.name] = PluginInfo(
                name=plugin.name,
                label=plugin.label,
                install_command=plugin.install_command,
                builtin=builtin,
            )

    def get(self, name: str) -> Optional[AgentPlugin]:
        """Get a plugin by name. Loads entry_points on first access."""
        self._ensure_entry_points()
        return self._plugins.get(name)

    def list_plugins(self) -> list[AgentPlugin]:
        """Return all registered plugins."""
        self._ensure_entry_points()
        return list(self._plugins.values())

    def list_names(self) -> list[str]:
        """Return all registered plugin names."""
        self._ensure_entry_points()
        return list(self._plugins.keys())

    def detect_runtimes(self) -> dict[str, dict]:
        """Detect installed agent runtimes (backward-compatible with old API)."""
        self._ensure_entry_points()
        results = {}
        for name, plugin in self._plugins.items():
            installed = plugin.is_installed()
            results[name] = {
                "installed": installed,
                "label": plugin.label,
                "install": plugin.install_command,
                "path": plugin.which() if installed else None,
            }
        return results

    def scan_agents(self) -> list[dict]:
        """Scan machine for all known agents with readiness status."""
        self._ensure_entry_points()
        results = []
        for name, plugin in self._plugins.items():
            installed = plugin.is_installed()
            ready, message = plugin.check_ready()
            results.append({
                "name": name,
                "label": plugin.label,
                "installed": installed,
                "ready": ready,
                "message": message,
                "path": plugin.which() if installed else None,
                "install_command": plugin.install_command,
            })
        return results

    def add_catalog_entry(self, info: PluginInfo) -> None:
        """Add a catalog entry for an agent that may not be installed yet."""
        self._catalog[info.name] = info

    def get_catalog(self) -> dict[str, PluginInfo]:
        """Return the full catalog (installed + known-available + remote)."""
        self._ensure_entry_points()
        self._ensure_remote_catalog()
        return dict(self._catalog)

    def search_catalog(self, query: str) -> list[PluginInfo]:
        """Search catalog entries by name/label/tags."""
        self._ensure_entry_points()
        self._ensure_remote_catalog()
        q = query.lower()
        results = []
        for info in self._catalog.values():
            if (q in info.name.lower()
                or q in info.label.lower()
                or q in info.description.lower()
                or any(q in t.lower() for t in info.tags)):
                results.append(info)
        return results

    def _ensure_entry_points(self):
        """Load third-party plugins from entry_points (once)."""
        if self._loaded_entry_points:
            return
        self._loaded_entry_points = True
        try:
            eps = importlib.metadata.entry_points()
            if hasattr(eps, "select"):
                group = eps.select(group="openagents.plugins")
            else:
                group = eps.get("openagents.plugins", [])
            for ep in group:
                try:
                    plugin_cls = ep.load()
                    plugin = plugin_cls() if isinstance(plugin_cls, type) else plugin_cls
                    if isinstance(plugin, AgentPlugin) and plugin.name not in self._plugins:
                        self.register(plugin)
                        logger.debug(f"Loaded plugin '{plugin.name}' from entry_point")
                except Exception as e:
                    logger.debug(f"Failed to load plugin entry_point '{ep.name}': {e}")
        except Exception as e:
            logger.debug(f"Failed to scan entry_points: {e}")

    def _ensure_remote_catalog(self):
        """Fetch remote agent catalog (once per process)."""
        if self._loaded_remote_catalog:
            return
        self._loaded_remote_catalog = True
        try:
            remote_entries = _fetch_remote_catalog()
            for info in remote_entries:
                if info.name and info.name not in self._catalog:
                    self._catalog[info.name] = info
                    logger.debug(f"Added remote catalog entry: {info.name}")
                elif info.name and info.name in self._catalog:
                    existing = self._catalog[info.name]
                    if not existing.description and info.description:
                        existing.description = info.description
                    if not existing.homepage and info.homepage:
                        existing.homepage = info.homepage
                    if not existing.tags and info.tags:
                        existing.tags = info.tags
        except Exception as e:
            logger.debug(f"Failed to load remote catalog: {e}")


# ---------------------------------------------------------------------------
# Load agent definitions from YAML registry files
# ---------------------------------------------------------------------------

def _load_from_yaml_registry(reg: PluginRegistry) -> None:
    """Load all YAML definitions from openagents/registry/ into the registry."""
    from openagents.registry.loader import load_registry_yamls, _make_plugin_from_yaml

    for data in load_registry_yamls():
        name = data["name"]
        install = data.get("install", {})
        is_builtin = data.get("builtin", False)

        # Create catalog entry for every YAML file
        from openagents.registry.loader import get_install_command
        info = PluginInfo(
            name=name,
            label=data.get("label", name),
            install_command=get_install_command(install),
            description=data.get("description", ""),
            homepage=data.get("homepage", ""),
            tags=data.get("tags", []),
            builtin=is_builtin,
            requires=install.get("requires", []),
        )
        reg.add_catalog_entry(info)

        # Create full plugin for builtin agents (those with adapter config)
        plugin = _make_plugin_from_yaml(data)
        if plugin:
            reg.register(plugin, builtin=is_builtin)


# ---------------------------------------------------------------------------
# Global registry — loaded from YAML files
# ---------------------------------------------------------------------------

registry = PluginRegistry()
_load_from_yaml_registry(registry)
