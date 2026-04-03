"""
Load agent definitions from YAML files in the registry directory.

Each YAML file produces:
- A PluginInfo (catalog metadata for display/search)
- For builtin agents: a concrete AgentPlugin subclass with full adapter/launch support
- For catalog-only agents: just the PluginInfo for the install screen
"""

import importlib
import json
import logging
import os
import platform
import shutil
import sys
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_INSTALLED_MARKERS_PATH = Path.home() / ".openagents" / "installed_agents.json"


def _load_installed_markers() -> set:
    """Load the set of agent names that have been explicitly installed."""
    try:
        if _INSTALLED_MARKERS_PATH.exists():
            data = json.loads(_INSTALLED_MARKERS_PATH.read_text(encoding="utf-8"))
            return set(data) if isinstance(data, list) else set()
    except Exception:
        pass
    return set()


def _is_marked_installed(agent_name: str) -> bool:
    if agent_name in _load_installed_markers():
        return True
    # Fallback: check per-agent marker file
    try:
        marker = _INSTALLED_MARKERS_PATH.parent / "installed" / agent_name
        return marker.exists()
    except Exception:
        return False


def mark_installed(agent_name: str) -> None:
    """Persist an install marker for an agent.

    Writes to ~/.openagents/installed_agents.json.
    Also writes to a per-agent marker file as a fallback in case the
    JSON file has issues (permissions, corruption, etc.).
    """
    markers = _load_installed_markers()
    markers.add(agent_name)
    try:
        _INSTALLED_MARKERS_PATH.parent.mkdir(parents=True, exist_ok=True)
        _INSTALLED_MARKERS_PATH.write_text(json.dumps(sorted(markers)), encoding="utf-8")
    except Exception as e:
        logger.warning("Failed to save install marker JSON for %s: %s", agent_name, e)

    # Also write a per-agent marker file as fallback
    try:
        marker_dir = _INSTALLED_MARKERS_PATH.parent / "installed"
        marker_dir.mkdir(parents=True, exist_ok=True)
        (marker_dir / agent_name).write_text("")
    except Exception as e:
        logger.warning("Failed to save install marker file for %s: %s", agent_name, e)


def get_current_platform() -> str:
    """Return the current platform key: 'macos', 'linux', or 'windows'."""
    system = platform.system().lower()
    if system == "darwin":
        return "macos"
    if system == "windows":
        return "windows"
    return "linux"


def get_install_command(install_cfg: dict) -> str:
    """Resolve the install command for the current platform.

    Checks for platform-specific keys (macos, linux, windows) first,
    then falls back to the generic 'command' key.
    """
    plat = get_current_platform()
    return install_cfg.get(plat, install_cfg.get("command", ""))

# Directory containing the YAML files (same dir as this module)
REGISTRY_DIR = Path(__file__).parent


def _load_yaml(path: Path) -> dict:
    """Load a YAML file, falling back to a simple parser if PyYAML isn't available."""
    try:
        import yaml
        with open(path, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except ImportError:
        return _simple_yaml_parse(path)


def _simple_yaml_parse(path: Path) -> dict:
    """Minimal YAML-subset parser for when PyYAML isn't installed.

    Handles flat keys, strings, booleans, lists (inline [...] and block - item),
    and simple nested dicts (one level of indentation).
    """
    data: dict = {}
    current_key: Optional[str] = None
    current_list: Optional[list] = None
    current_dict: Optional[dict] = None
    indent_level = 0

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        # Skip comments and blank lines
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        line_indent = len(raw_line) - len(raw_line.lstrip())

        # If we were collecting a block list and indent dropped, close it
        if current_list is not None and line_indent <= indent_level and not stripped.startswith("-"):
            data[current_key] = current_list
            current_list = None
            current_key = None

        # If we were collecting a nested dict and indent dropped, close it
        if current_dict is not None and line_indent <= indent_level and ":" in stripped:
            data[current_key] = current_dict
            current_dict = None
            current_key = None

        # Block list item
        if stripped.startswith("- ") and current_list is not None:
            val = _parse_value(stripped[2:].strip())
            current_list.append(val)
            continue

        if ":" not in stripped:
            continue

        key, _, rest = stripped.partition(":")
        key = key.strip()
        rest = rest.strip()

        if not rest:
            # Could be start of a nested dict or block list
            current_key = key
            indent_level = line_indent
            # Peek: we don't know yet, will be resolved by next line
            current_list = []
            current_dict = {}
            continue

        # Inline value
        val = _parse_value(rest)

        if current_dict is not None and line_indent > indent_level:
            current_dict[key] = val
        else:
            # Close any open nested structure
            if current_list is not None:
                if current_dict:
                    data[current_key] = current_dict
                else:
                    data[current_key] = current_list
                current_list = None
                current_dict = None
                current_key = None
            data[key] = val

    # Close any remaining open structures
    if current_list is not None and current_key:
        if current_dict and not current_list:
            data[current_key] = current_dict
        else:
            data[current_key] = current_list
    elif current_dict is not None and current_key:
        data[current_key] = current_dict

    return data


def _parse_value(s: str):
    """Parse a simple YAML value."""
    if not s:
        return ""
    # Inline list: [a, b, c]
    if s.startswith("[") and s.endswith("]"):
        items = s[1:-1].split(",")
        return [_parse_value(i.strip()) for i in items if i.strip()]
    # Quoted string
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        return s[1:-1]
    # Boolean
    if s.lower() == "true":
        return True
    if s.lower() == "false":
        return False
    # Integer
    try:
        return int(s)
    except ValueError:
        pass
    return s


def load_single_yaml(path: Path) -> dict:
    """Load and return raw dict from a single YAML file."""
    return _load_yaml(path)


def load_registry_yamls() -> list[dict]:
    """Load all .yaml files from the registry directory.

    Returns list of raw dicts, one per agent definition file.
    """
    results = []
    for yaml_path in sorted(REGISTRY_DIR.glob("*.yaml")):
        try:
            data = _load_yaml(yaml_path)
            if data and data.get("name"):
                results.append(data)
        except Exception as e:
            logger.warning(f"Failed to load registry file {yaml_path.name}: {e}")
    return results


# ---------------------------------------------------------------------------
# Build AgentPlugin instances from YAML data
# ---------------------------------------------------------------------------

def _make_plugin_from_yaml(data: dict):
    """Create an AgentPlugin subclass instance from YAML data.

    Only creates full plugins for builtin agents (those with adapter config).
    Returns None for catalog-only entries.
    """
    from openagents.client.plugin_registry import AgentPlugin

    if not data.get("builtin"):
        return None

    install = data.get("install", {})
    binary = install.get("binary", data["name"])
    adapter_cfg = data.get("adapter", {})
    launch_cfg = data.get("launch", {})
    env_config = data.get("env_config", [])
    resolve_rules = data.get("resolve_env", {}).get("rules", [])
    check_cfg = data.get("check_ready", {})

    class YamlPlugin(AgentPlugin):
        name = data["name"]
        label = data.get("label", data["name"])
        install_command = get_install_command(install)

        def _which_binary(self) -> Optional[str]:
            """Find the binary, preferring .cmd/.exe on Windows."""
            if platform.system() == "Windows":
                # On Windows, npm-installed packages create .cmd wrappers.
                # The bare name may resolve to a non-executable shell script,
                # so prefer .cmd/.exe and only fall back to bare name with
                # validation that it's actually executable by Windows.
                path = shutil.which(binary + ".cmd") or shutil.which(binary + ".exe")
                if path:
                    return path
                # Bare name fallback — shutil.which checks PATHEXT,
                # so if it returns something it should be executable
                bare = shutil.which(binary)
                if bare:
                    # Validate it has a Windows-executable extension
                    ext = Path(bare).suffix.lower()
                    win_exts = {e.lower() for e in os.environ.get("PATHEXT", ".COM;.EXE;.BAT;.CMD").split(";")}
                    if ext in win_exts:
                        return bare
                return None
            found = shutil.which(binary)
            if found:
                return found
            # nvm
            home = Path.home()
            nvm_dir = Path(os.environ.get("NVM_DIR", home / ".nvm"))
            node_versions = nvm_dir / "versions" / "node"
            if node_versions.is_dir():
                for d in sorted(node_versions.iterdir(), reverse=True):
                    c = d / "bin" / binary
                    if c.is_file() and os.access(c, os.X_OK):
                        return str(c)
            # fnm
            fnm_dir = home / ".local" / "share" / "fnm" / "node-versions"
            if fnm_dir.is_dir():
                for d in sorted(fnm_dir.iterdir(), reverse=True):
                    c = d / "installation" / "bin" / binary
                    if c.is_file() and os.access(c, os.X_OK):
                        return str(c)
            # volta
            volta_bin = home / ".volta" / "bin" / binary
            if volta_bin.is_file() and os.access(volta_bin, os.X_OK):
                return str(volta_bin)
            return None

        def is_installed(self) -> bool:
            if self._which_binary() is not None:
                return True
            # Check persistent install marker (covers API-only agents and
            # cases where the binary isn't on PATH yet after install)
            return _is_marked_installed(data["name"])

        def which(self) -> Optional[str]:
            return self._which_binary()

        def required_env_vars(self) -> list[dict]:
            return env_config

        def resolve_env_sources(self) -> list[str]:
            """Return source var names from resolve_env rules."""
            return [r.get("from", "") for r in resolve_rules if r.get("from")]

        def resolve_env(self, saved: dict) -> dict:
            if not resolve_rules:
                return saved
            env = {}
            base_url = saved.get("LLM_BASE_URL", "").lower()
            for rule in resolve_rules:
                src = rule.get("from", "")
                dst = rule.get("to", "")
                val = saved.get(src, "")
                if not val:
                    continue
                # Conditional rules
                if rule.get("if_base_url_contains"):
                    if rule["if_base_url_contains"] not in base_url:
                        continue
                if rule.get("unless_base_url_contains"):
                    if rule["unless_base_url_contains"] in base_url:
                        continue
                if dst not in env:  # first match wins
                    env[dst] = val
            return env

        def check_ready(self) -> tuple[bool, str]:
            if not self.is_installed():
                return False, f"Not installed. Run: openagents install {data['name']}"
            # If no readiness checks are configured, being installed is enough
            has_checks = (
                check_cfg.get('env_vars')
                or check_cfg.get('saved_env_key')
                or check_cfg.get('creds_file')
                or check_cfg.get('keychain_service')
            )
            if not has_checks:
                return True, 'Ready'
            # Check env vars (resolved names like OPENAI_API_KEY)
            for var in check_cfg.get("env_vars", []):
                if os.environ.get(var):
                    return True, f"Ready (API key set)"
            # Check source env vars from env_config (e.g. LLM_API_KEY)
            saved_key = check_cfg.get("saved_env_key")
            if saved_key and os.environ.get(saved_key):
                return True, f"Ready (API key set)"
            # Check saved env config
            if saved_key:
                from openagents.client.daemon_config import load_agent_env
                saved = load_agent_env(data["name"])
                if saved.get(saved_key):
                    model = saved.get("LLM_MODEL", "default")
                    return True, f"Ready ({model})"
            # Check credentials file
            creds_file = check_cfg.get("creds_file")
            if creds_file:
                creds_path = Path(os.path.expanduser(creds_file))
                if creds_path.exists():
                    try:
                        creds = json.loads(creds_path.read_text(encoding="utf-8"))
                        creds_key = check_cfg.get("creds_key")
                        if creds_key and creds.get(creds_key):
                            return True, "Ready (logged in)"
                    except Exception:
                        pass
            # Check macOS Keychain
            keychain_svc = check_cfg.get("keychain_service")
            if keychain_svc and platform.system() == "Darwin":
                try:
                    import subprocess
                    result = subprocess.run(
                        ["security", "find-generic-password",
                         "-s", keychain_svc, "-w"],
                        capture_output=True, text=True, timeout=5,
                    )
                    if result.returncode == 0 and result.stdout.strip():
                        creds_key = check_cfg.get("creds_key")
                        if creds_key:
                            creds = json.loads(result.stdout.strip())
                            if creds.get(creds_key):
                                return True, "Ready (logged in)"
                        else:
                            return True, "Ready (logged in)"
                except Exception:
                    pass
            msg = check_cfg.get("not_ready_message", "Not ready")
            return False, msg

        def login_command(self) -> Optional[str]:
            return check_cfg.get("login_command")

        def get_launch_command(self, agent_name: str, path: Optional[str] = None) -> Optional[list[str]]:
            if not launch_cfg:
                return None
            bin_path = self._which_binary()
            if not bin_path:
                return None
            args = []
            for arg in launch_cfg.get("args", []):
                args.append(arg.replace("{agent_name}", agent_name))
            return [bin_path] + args

        def create_adapter(self, workspace_id, channel_name, token, agent_name, endpoint, options=None, working_dir=None):
            mod = importlib.import_module(adapter_cfg["module"])
            cls = getattr(mod, adapter_cfg["class"])
            opts = options or {}
            # Merge default options from YAML
            default_opts = adapter_cfg.get("options", {})
            merged = {**default_opts, **opts}
            # Build kwargs — adapter classes have different signatures,
            # so pass standard params + any extra options
            kwargs = dict(
                workspace_id=workspace_id,
                channel_name=channel_name,
                token=token,
                agent_name=agent_name,
                endpoint=endpoint,
            )
            if working_dir:
                kwargs["working_dir"] = working_dir
            # Add adapter-specific options
            for k, v in merged.items():
                kwargs[k] = v
            return cls(**kwargs)

    # Give the class a meaningful name for debugging
    YamlPlugin.__name__ = f"{data['name'].title()}Plugin"
    YamlPlugin.__qualname__ = YamlPlugin.__name__

    return YamlPlugin()
