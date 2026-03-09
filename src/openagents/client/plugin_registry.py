"""
Plugin registry for agent types.

Provides a pluggable system for agent adapters. Built-in agents (claude,
openclaw, codex) are registered by default. Third-party agents can register
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
import sys
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

    def health_check(self) -> bool:
        """Optional deeper health check beyond is_installed()."""
        return self.is_installed()


# ---------------------------------------------------------------------------
# Built-in plugins
# ---------------------------------------------------------------------------

class ClaudePlugin(AgentPlugin):
    name = "claude"
    label = "Claude Code CLI"
    install_command = "npm install -g @anthropic-ai/claude-code"

    def is_installed(self) -> bool:
        return shutil.which("claude") is not None

    def which(self) -> Optional[str]:
        return shutil.which("claude")

    def check_ready(self) -> tuple[bool, str]:
        if not self.is_installed():
            return False, "Not installed. Run: openagents install claude"
        # Check for Claude credentials
        # Claude Code stores OAuth at ~/.claude/.credentials.json
        # or can use ANTHROPIC_API_KEY env var
        if os.environ.get("ANTHROPIC_API_KEY"):
            return True, "Ready (API key set)"
        creds_path = Path.home() / ".claude" / ".credentials.json"
        if creds_path.exists():
            try:
                creds = json.loads(creds_path.read_text())
                if creds.get("claudeAiOauth"):
                    return True, "Ready (logged in)"
            except Exception:
                pass
        return False, "Not logged in. Run: claude login"

    def get_launch_command(self, agent_name: str, path: Optional[str] = None) -> Optional[list[str]]:
        binary = shutil.which("claude")
        if not binary:
            return None
        return [binary, "--name", agent_name]

    def create_adapter(self, workspace_id, channel_name, token, agent_name, endpoint, options=None):
        from openagents.adapters.claude import ClaudeAdapter
        opts = options or {}
        disabled_modules: set = set()
        if opts.get("disable_files"):
            disabled_modules.add("files")
        if opts.get("disable_browser"):
            disabled_modules.add("browser")
        return ClaudeAdapter(
            workspace_id=workspace_id,
            channel_name=channel_name,
            token=token,
            agent_name=agent_name,
            endpoint=endpoint,
            disabled_modules=disabled_modules or None,
        )


class OpenClawPlugin(AgentPlugin):
    name = "openclaw"
    label = "OpenClaw"
    install_command = "pip install openclaw"

    def is_installed(self) -> bool:
        try:
            __import__("openclaw")
            return True
        except ImportError:
            return False

    def which(self) -> Optional[str]:
        return "python module" if self.is_installed() else None

    def check_ready(self) -> tuple[bool, str]:
        if not self.is_installed():
            return False, "Not installed. Run: openagents install openclaw"
        # OpenClaw needs ANTHROPIC_API_KEY or its own config
        if os.environ.get("ANTHROPIC_API_KEY"):
            return True, "Ready (API key set)"
        return False, "No API key. Run: export ANTHROPIC_API_KEY=sk-ant-..."

    def create_adapter(self, workspace_id, channel_name, token, agent_name, endpoint, options=None):
        from openagents.adapters.openclaw import OpenClawAdapter
        opts = options or {}
        return OpenClawAdapter(
            workspace_id=workspace_id,
            channel_name=channel_name,
            token=token,
            agent_name=agent_name,
            endpoint=endpoint,
            openclaw_host=opts.get("openclaw_host", "127.0.0.1"),
            openclaw_port=opts.get("openclaw_port", 18789),
            openclaw_token=opts.get("openclaw_token"),
            openclaw_agent_id=opts.get("openclaw_agent_id", "main"),
        )


class YamlAgentPlugin(AgentPlugin):
    """Plugin for YAML-defined agents (Layer 3 SDK agents).

    Agents are defined in YAML config files and launched via
    ``openagents agent start <config.yaml>``.  The daemon manages them
    as local subprocesses — the ``path`` field in :class:`AgentEntry`
    should point to the YAML config file.
    """

    name = "yaml-agent"
    label = "YAML-defined Agent"
    install_command = "pip install openagents"

    def is_installed(self) -> bool:
        return True  # built-in

    def which(self) -> Optional[str]:
        return "built-in"

    def check_ready(self) -> tuple[bool, str]:
        return True, "Ready (built-in)"

    def get_launch_command(self, agent_name: str, path: Optional[str] = None) -> Optional[list[str]]:
        if not path:
            return None
        config_path = Path(path)
        if not config_path.exists():
            return None
        return [sys.executable, "-m", "openagents", "agent", "start", str(config_path)]

    def create_adapter(self, workspace_id, channel_name, token, agent_name, endpoint, options=None):
        raise NotImplementedError(
            "YAML agents use gRPC (Layer 3), not HTTP adapters. "
            "Use get_launch_command() for subprocess management instead."
        )


class CodexPlugin(AgentPlugin):
    name = "codex"
    label = "OpenAI Codex CLI"
    install_command = "npm install -g @openai/codex"

    def is_installed(self) -> bool:
        return shutil.which("codex") is not None

    def which(self) -> Optional[str]:
        return shutil.which("codex")

    def check_ready(self) -> tuple[bool, str]:
        if not self.is_installed():
            return False, "Not installed. Run: openagents install codex"
        if os.environ.get("OPENAI_API_KEY"):
            return True, "Ready (API key set)"
        return False, "No API key. Run: export OPENAI_API_KEY=sk-..."

    def get_launch_command(self, agent_name: str, path: Optional[str] = None) -> Optional[list[str]]:
        binary = shutil.which("codex")
        if not binary:
            return None
        return [binary]

    def create_adapter(self, workspace_id, channel_name, token, agent_name, endpoint, options=None):
        from openagents.adapters.codex import CodexAdapter
        return CodexAdapter(
            workspace_id=workspace_id,
            channel_name=channel_name,
            token=token,
            agent_name=agent_name,
            endpoint=endpoint,
        )


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


# ---------------------------------------------------------------------------
# Remote catalog
# ---------------------------------------------------------------------------

REGISTRY_URL = "https://endpoint.openagents.org/v1/agent-registry"
CACHE_DIR = Path.home() / ".openagents"
CACHE_PATH = CACHE_DIR / "agent_catalog.json"
CACHE_TTL = 86400  # 24 hours


def _fetch_remote_catalog() -> list[PluginInfo]:
    """Fetch agent catalog from remote registry with 24h cache + offline fallback.

    Returns remote entries on success, cached entries if offline, empty list on cold start.
    """
    # Check cache first
    if CACHE_PATH.exists():
        try:
            age = time.time() - CACHE_PATH.stat().st_mtime
            if age < CACHE_TTL:
                return _parse_cached()
        except Exception:
            pass

    # Try remote fetch
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

    # Offline fallback: use stale cache if available
    if CACHE_PATH.exists():
        try:
            return _parse_cached()
        except Exception:
            pass

    return []  # No cache, no remote — caller will use bundled _KNOWN_AGENTS


def _parse_cached() -> list[PluginInfo]:
    """Parse cached catalog JSON file."""
    data = json.loads(CACHE_PATH.read_text())
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
        """Scan machine for all known agents with readiness status.

        Returns list of dicts with: name, label, installed, ready, message, path.
        """
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
            # Python 3.12+ returns a SelectableGroups, 3.9+ has .select()
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
                    # Update description/homepage/tags from remote if local is sparse
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
# Global registry with built-in plugins pre-registered
# ---------------------------------------------------------------------------

registry = PluginRegistry()
registry.register(ClaudePlugin(), builtin=True)
registry.register(OpenClawPlugin(), builtin=True)
registry.register(CodexPlugin(), builtin=True)
registry.register(YamlAgentPlugin(), builtin=True)

# Known agents catalog (available for `openagents search` even if not installed)
_KNOWN_AGENTS = [
    PluginInfo(
        name="aider",
        label="Aider",
        install_command="pip install aider-chat",
        description="AI pair programming in your terminal",
        homepage="https://aider.chat",
        tags=["coding", "pair-programming", "open-source"],
    ),
    PluginInfo(
        name="goose",
        label="Goose",
        install_command="pip install goose-ai",
        description="An open-source AI developer agent",
        homepage="https://github.com/block/goose",
        tags=["coding", "developer", "open-source"],
    ),
    PluginInfo(
        name="cline",
        label="Cline",
        install_command="npm install -g cline",
        description="Autonomous coding agent for VS Code",
        homepage="https://github.com/cline/cline",
        tags=["coding", "vscode", "autonomous"],
    ),
    PluginInfo(
        name="swebench",
        label="SWE-bench Agent",
        install_command="pip install swe-agent",
        description="Language model agent for software engineering tasks",
        homepage="https://swe-agent.com",
        tags=["coding", "benchmarks", "research"],
    ),
]

for _info in _KNOWN_AGENTS:
    registry.add_catalog_entry(_info)

# Also add built-in agents to catalog
for _p in [ClaudePlugin(), OpenClawPlugin(), CodexPlugin(), YamlAgentPlugin()]:
    registry.add_catalog_entry(PluginInfo(
        name=_p.name,
        label=_p.label,
        install_command=_p.install_command,
        builtin=True,
    ))
