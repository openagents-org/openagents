"""
Daemon manager — runs multiple agent adapters with auto-restart.

Works on Linux, macOS, and Windows.

Usage:
    from openagents.client.daemon import DaemonManager
    from openagents.client.daemon_config import load_config

    config = load_config()
    manager = DaemonManager(config)
    asyncio.run(manager.start())
"""

import asyncio
import json
import logging
import os
import platform
import signal
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from openagents.client.agent_setup import setup_agent
from openagents.client.daemon_config import (
    AgentEntry,
    CMD_PATH,
    DaemonConfig,
    NetworkEntry,
    PID_PATH,
    LOG_PATH,
    STATUS_PATH,
    get_agent_network,
    load_config,
    write_status,
)

logger = logging.getLogger(__name__)

IS_WINDOWS = sys.platform == "win32"


def _ensure_windows_path():
    """On Windows, ensure common tool directories are on PATH.

    Windows SSH sessions, services, and background processes often have
    incomplete PATH variables missing directories like 'C:\\Program Files\\nodejs'.
    This adds common locations if they exist and contain executables.
    """
    if not IS_WINDOWS:
        return

    current_path = os.environ.get("PATH", "")
    path_dirs = [d.lower() for d in current_path.split(";")]

    # Common directories that should be on PATH for agent runtimes
    candidates = [
        os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "nodejs"),
        os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "nodejs"),
        os.path.join(os.environ.get("APPDATA", ""), "npm"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "nodejs"),
    ]

    added = []
    for candidate in candidates:
        if candidate and os.path.isdir(candidate) and candidate.lower() not in path_dirs:
            added.append(candidate)

    if added:
        os.environ["PATH"] = current_path + ";" + ";".join(added)
        logger.debug(f"Added to PATH: {added}")


# ---------------------------------------------------------------------------
# Agent status tracking
# ---------------------------------------------------------------------------

@dataclass
class AgentStatus:
    name: str
    type: str
    network: str  # network slug or "(local)"
    path: Optional[str] = None  # working directory
    state: str = "starting"  # starting, online, running, reconnecting, stopped, error
    started_at: Optional[str] = None
    restarts: int = 0
    last_error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "type": self.type,
            "network": self.network,
            # Keep "workspace" key for backward compat with status readers
            "workspace": self.network,
            "path": self.path,
            "state": self.state,
            "started_at": self.started_at,
            "restarts": self.restarts,
            "last_error": self.last_error,
        }


# ---------------------------------------------------------------------------
# Daemon manager
# ---------------------------------------------------------------------------

class DaemonManager:
    """Manages multiple agent adapters in a single asyncio event loop."""

    def __init__(self, config: DaemonConfig, config_path=None):
        self.config = config
        self.config_path = config_path
        self.tasks: dict[str, asyncio.Task] = {}
        self.agent_status: dict[str, AgentStatus] = {}
        self._stopped_agents: set[str] = set()  # agents stopped via command
        self._shutting_down = False
        self._shutdown_event = asyncio.Event()
        self._reload_pending = False

    async def start(self):
        """Start all configured agents and block until shutdown."""
        _ensure_windows_path()

        for agent_cfg in self.config.agents:
            net = get_agent_network(agent_cfg, self.config)
            self._launch_agent(agent_cfg, net)

        logger.info(f"Started {len(self.config.agents)} agent(s)")

        # Install signal handlers
        loop = asyncio.get_running_loop()
        if IS_WINDOWS:
            def _sig_handler(*_args):
                loop.call_soon_threadsafe(self._handle_signal)
            signal.signal(signal.SIGINT, _sig_handler)
            signal.signal(signal.SIGTERM, _sig_handler)
        else:
            for sig in (signal.SIGTERM, signal.SIGINT):
                loop.add_signal_handler(sig, self._handle_signal)
            if hasattr(signal, "SIGHUP"):
                loop.add_signal_handler(signal.SIGHUP, self._handle_reload)

        # Periodically write status file
        status_task = asyncio.create_task(self._status_loop())

        # Wait for shutdown signal
        await self._shutdown_event.wait()

        # Cleanup
        status_task.cancel()
        await self._cancel_all()
        self._write_status()
        logger.info("Daemon stopped")

    def _handle_signal(self):
        """Signal handler — trigger graceful shutdown."""
        if not self._shutting_down:
            logger.info("Shutdown signal received")
            self._shutting_down = True
            self._shutdown_event.set()

    def _handle_reload(self):
        """SIGHUP handler — schedule immediate config reload."""
        logger.info("SIGHUP received — scheduling config reload")
        loop = asyncio.get_running_loop()
        loop.create_task(self._do_reload())

    async def _do_reload(self):
        """Re-read config and start/stop agents as needed."""
        self._reload_pending = False
        try:
            new_config = load_config(self.config_path)
        except Exception as e:
            logger.error(f"Failed to reload config: {e}")
            return

        old_names = {a.name for a in self.config.agents}
        new_names = {a.name for a in new_config.agents}

        old_agent_map = {a.name: a for a in self.config.agents}
        new_agent_map = {a.name: a for a in new_config.agents}

        # Stop removed agents
        for name in old_names - new_names:
            self._stop_agent(name)
            logger.info(f"Reload: stopped removed agent '{name}'")

        # Start new agents
        for name in new_names - old_names:
            agent_cfg = new_agent_map[name]
            net = get_agent_network(agent_cfg, new_config)
            self._launch_agent(agent_cfg, net)
            logger.info(f"Reload: started new agent '{name}'")

        # Restart agents whose network changed
        for name in old_names & new_names:
            old_net = old_agent_map[name].network
            new_net = new_agent_map[name].network
            if old_net != new_net:
                self._stop_agent(name)
                agent_cfg = new_agent_map[name]
                net = get_agent_network(agent_cfg, new_config)
                self._launch_agent(agent_cfg, net)
                logger.info(f"Reload: reconnected '{name}' ({old_net} → {new_net})")

        self.config = new_config
        self._write_status()
        logger.info(f"Config reloaded: {len(new_config.agents)} agent(s)")

    def _launch_agent(self, agent_cfg: AgentEntry, net: Optional[NetworkEntry]):
        """Create status entry and launch agent task."""
        self._stopped_agents.discard(agent_cfg.name)
        network_label = net.slug if net else "(local)"
        status = AgentStatus(
            name=agent_cfg.name,
            type=agent_cfg.type,
            network=network_label,
            path=agent_cfg.path,
        )
        self.agent_status[agent_cfg.name] = status

        if net:
            self.tasks[agent_cfg.name] = asyncio.create_task(
                self._run_network_agent(agent_cfg, net, status)
            )
        else:
            self.tasks[agent_cfg.name] = asyncio.create_task(
                self._run_local_agent(agent_cfg, status)
            )

    async def _run_network_agent(
        self,
        agent_cfg: AgentEntry,
        net: NetworkEntry,
        status: AgentStatus,
    ):
        """Run a network-connected adapter with exponential backoff on crash."""
        # Inject type-level + per-agent env vars into the process environment.
        # Merge saved config with process env vars so that CI/export-based
        # env vars (e.g. LLM_API_KEY) are also picked up and resolved.
        from openagents.client.daemon_config import load_agent_env
        from openagents.client.plugin_registry import registry as _reg
        type_env = load_agent_env(agent_cfg.type)
        _plugin = _reg.get(agent_cfg.type)
        if _plugin:
            # Also check process env for source keys from env_config
            for var_def in _plugin.required_env_vars():
                var_name = var_def.get("name", "")
                if var_name and var_name not in type_env and os.environ.get(var_name):
                    type_env[var_name] = os.environ[var_name]
            # Also check process env for resolve_env source vars (e.g. LLM_API_KEY)
            for src_name in _plugin.resolve_env_sources():
                if src_name not in type_env and os.environ.get(src_name):
                    type_env[src_name] = os.environ[src_name]
            resolved = _plugin.resolve_env(type_env)
        else:
            resolved = type_env
        for k, v in {**resolved, **agent_cfg.env}.items():
            os.environ[k] = v

        backoff = 2
        while not self._shutting_down:
            try:
                status.state = "starting"
                self._write_status()

                # Auto-start required services (e.g. OpenClaw gateway)
                await self._ensure_agent_services(agent_cfg)

                adapter = await setup_agent(
                    agent_type=agent_cfg.type,
                    agent_name=agent_cfg.name,
                    workspace_id=net.id,
                    token=net.token,
                    endpoint=net.endpoint,
                    role=agent_cfg.role,
                    options=agent_cfg.options,
                    quiet=True,
                    working_dir=agent_cfg.path,
                )

                status.state = "online"
                status.started_at = datetime.now(timezone.utc).isoformat()
                self._write_status()
                logger.info(f"{agent_cfg.name} is online → {net.slug}")

                await adapter.run()
                # Check if agent was stopped or removed during run()
                # (adapter.run() swallows CancelledError internally)
                if agent_cfg.name in self._stopped_agents:
                    logger.info(f"{agent_cfg.name} was stopped, not restarting")
                    break
                if agent_cfg.name not in {a.name for a in self.config.agents}:
                    logger.info(f"{agent_cfg.name} removed from config, stopping")
                    break
                logger.info(f"{agent_cfg.name} exited cleanly, restarting")
                # Don't break — restart the adapter so the agent stays online
                backoff = 2
                await asyncio.sleep(backoff)

            except asyncio.CancelledError:
                logger.debug(f"{agent_cfg.name} cancelled")
                break

            except Exception as e:
                # Check if agent was stopped/removed before restarting
                if agent_cfg.name in self._stopped_agents:
                    logger.info(f"{agent_cfg.name} was stopped, not restarting")
                    break
                if agent_cfg.name not in {a.name for a in self.config.agents}:
                    logger.info(f"{agent_cfg.name} removed from config, stopping")
                    break
                status.restarts += 1
                status.state = "reconnecting"
                status.last_error = str(e)[:200]
                self._write_status()
                logger.warning(
                    f"{agent_cfg.name} crashed: {e}, "
                    f"restarting in {backoff}s (attempt {status.restarts})"
                )
                try:
                    await asyncio.sleep(backoff)
                except asyncio.CancelledError:
                    break
                backoff = min(backoff * 2, 60)

        status.state = "stopped"

    async def _ensure_agent_services(self, agent_cfg: AgentEntry):
        """Ensure required setup for an agent type before starting.

        For OpenClaw: ensures the binary is on PATH and runs onboard if needed.
        The adapter uses CLI mode (openclaw agent --local) which doesn't need
        a running gateway — it runs the agent locally with full tool support.
        """
        if agent_cfg.type != "openclaw":
            return

        import shutil

        # Ensure openclaw binary is on PATH
        binary = shutil.which("openclaw") or shutil.which("openclaw.cmd")
        if not binary:
            npm_dirs = []
            if platform.system() == "Windows":
                appdata = os.environ.get("APPDATA", "")
                if appdata:
                    npm_dirs.append(os.path.join(appdata, "npm"))
                userprofile = os.environ.get("USERPROFILE", "")
                if userprofile:
                    npm_dirs.append(os.path.join(userprofile, "AppData", "Roaming", "npm"))
            else:
                home = os.path.expanduser("~")
                npm_dirs.extend([
                    os.path.join(home, ".npm-global", "bin"),
                    "/usr/local/bin",
                ])
            for d in npm_dirs:
                for name in ["openclaw.cmd", "openclaw"]:
                    candidate = os.path.join(d, name)
                    if os.path.isfile(candidate):
                        binary = candidate
                        os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
                        logger.info("Found openclaw at %s (added to PATH)", candidate)
                        break
                if binary:
                    break

        if not binary:
            logger.warning("OpenClaw binary not found on PATH or npm global dirs")
            return

        # Run onboard to initialize workspace and config if needed
        openclaw_dir = Path.home() / ".openclaw"
        if not (openclaw_dir / "openclaw.json").exists():
            logger.info("Running OpenClaw onboard...")
            try:
                use_shell = platform.system() == "Windows"
                subprocess.run(
                    [binary, "onboard", "--non-interactive", "--accept-risk"],
                    capture_output=True, text=True, timeout=30,
                    shell=use_shell,
                )
                logger.info("OpenClaw onboard completed")
            except Exception as e:
                logger.warning("OpenClaw onboard failed: %s", e)

        # Configure model provider from OpenAgents env vars
        self._configure_openclaw_model()

    def _configure_openclaw_model(self):
        """Write model provider config into openclaw.json from env vars.

        OpenClaw's --local mode reads API keys from its own config, not
        from environment variables. This syncs the OpenAgents LLM config
        (OPENAI_API_KEY, OPENAI_BASE_URL, OPENCLAW_MODEL) into OpenClaw's
        models.providers section.
        """
        import json

        api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY", "")
        base_url = os.environ.get("OPENAI_BASE_URL", "").rstrip("/")
        model = os.environ.get("OPENCLAW_MODEL", "")

        if not api_key:
            return

        openclaw_config = Path.home() / ".openclaw" / "openclaw.json"
        if not openclaw_config.exists():
            return

        try:
            config_data = json.loads(openclaw_config.read_text(encoding="utf-8"))
        except Exception:
            return

        # Determine API format from base URL
        is_anthropic = "anthropic" in base_url.lower() if base_url else bool(os.environ.get("ANTHROPIC_API_KEY"))
        api_format = "anthropic-messages" if is_anthropic else "openai-completions"

        # Build provider config
        provider_id = "openagents-llm"
        provider_config = {
            "apiKey": api_key,
            "api": api_format,
        }
        if base_url:
            provider_config["baseUrl"] = base_url

        model_id = model or ("claude-sonnet-4-6" if is_anthropic else "gpt-4o")
        provider_config["models"] = [{
            "id": model_id,
            "name": model_id,
            "contextWindow": 200000,
            "maxTokens": 16384,
        }]

        # Update config
        if "models" not in config_data:
            config_data["models"] = {}
        if "providers" not in config_data["models"]:
            config_data["models"]["providers"] = {}
        config_data["models"]["providers"][provider_id] = provider_config

        # Set as default model for agents
        if "agents" not in config_data:
            config_data["agents"] = {}
        if "defaults" not in config_data["agents"]:
            config_data["agents"]["defaults"] = {}
        config_data["agents"]["defaults"]["model"] = {
            "primary": f"{provider_id}/{model_id}",
            "fallbacks": [],
        }

        try:
            openclaw_config.write_text(json.dumps(config_data, indent=2), encoding="utf-8")
            logger.info("Configured OpenClaw model: %s/%s", provider_id, model_id)
        except Exception as e:
            logger.warning("Failed to write OpenClaw model config: %s", e)

    async def _ensure_openclaw_identity(self, binary: str):
        """Ensure OpenClaw device identity exists via non-interactive onboard."""
        identity_dir = Path.home() / ".openclaw" / "identity"
        if (identity_dir / "device.json").exists() and (identity_dir / "device-auth.json").exists():
            return

        logger.info("Running OpenClaw onboard to generate device identity...")
        try:
            use_shell = platform.system() == "Windows"
            result = subprocess.run(
                [binary, "onboard", "--non-interactive", "--accept-risk"],
                capture_output=True, text=True, timeout=30,
                shell=use_shell,
            )
            if result.returncode == 0:
                logger.info("OpenClaw onboard completed")
            else:
                logger.warning("OpenClaw onboard exited %d: %s", result.returncode, result.stderr[:200])
        except Exception as e:
            logger.error("OpenClaw onboard failed: %s", e)

    async def _ensure_openclaw_pairing(self, binary: str, host: str, port: int):
        """Auto-pair the device with the local OpenClaw gateway.

        After onboard creates the device identity, the first WS connection
        triggers a PAIRING_REQUIRED challenge. We approve it via the CLI,
        then reconnect to get a fresh token saved to device-auth.json.
        """
        import json
        import aiohttp

        identity_dir = Path.home() / ".openclaw" / "identity"
        if not (identity_dir / "device.json").exists():
            return

        # Check if already paired
        paired_file = Path.home() / ".openclaw" / "devices" / "paired.json"
        if paired_file.exists():
            try:
                paired = json.loads(paired_file.read_text(encoding="utf-8"))
                device = json.loads((identity_dir / "device.json").read_text(encoding="utf-8"))
                if device.get("deviceId") in paired:
                    logger.debug("OpenClaw device already paired")
                    return
            except Exception:
                pass

        logger.info("Auto-pairing OpenClaw device with gateway...")
        try:
            # Step 1: Connect to gateway — triggers PAIRING_REQUIRED
            async with aiohttp.ClientSession() as session:
                async with session.ws_connect(
                    f"ws://{host}:{port}",
                    headers={"Origin": f"http://localhost:{port}"},
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as ws:
                    # Read challenge
                    raw = await asyncio.wait_for(ws.receive(), timeout=5)
                    challenge = json.loads(raw.data)
                    nonce = challenge.get("payload", {}).get("nonce", "")

                    # Sign and send connect
                    from openagents.adapters.openclaw import _load_openclaw_device_identity, _sign_ws_challenge
                    device_info = _load_openclaw_device_identity()
                    if not device_info:
                        logger.warning("No device identity for pairing")
                        return

                    params = _sign_ws_challenge(device_info, nonce)
                    if not params:
                        logger.warning("Failed to sign pairing challenge")
                        return

                    await ws.send_json({"type": "req", "id": "pair1", "method": "connect", "params": params})
                    raw2 = await asyncio.wait_for(ws.receive(), timeout=5)
                    res = json.loads(raw2.data)

                    if res.get("ok"):
                        logger.info("OpenClaw device already connected")
                        return

                    error = res.get("error", {})
                    request_id = error.get("details", {}).get("requestId")
                    if not request_id:
                        logger.warning("Pairing failed without requestId: %s", error)
                        return

            # Step 2: Approve the pairing request via CLI
            logger.info("Approving pairing request %s...", request_id)
            use_shell = platform.system() == "Windows"
            result = subprocess.run(
                [binary, "devices", "approve", request_id],
                capture_output=True, text=True, timeout=15,
                shell=use_shell,
            )
            if "Approved" in result.stdout or result.returncode == 0:
                logger.info("Pairing approved")
            else:
                logger.warning("Pairing approval may have failed: %s", result.stderr[:200])

            # Step 3: Sync the device token from the gateway's paired.json
            # After approval, the gateway has a new token for this device but
            # device-auth.json still has the old one. Read the correct token
            # from the gateway's records and update device-auth.json.
            await asyncio.sleep(1)
            self._sync_openclaw_device_token()

        except Exception as e:
            logger.error("Auto-pairing failed: %s", e)

    def _sync_openclaw_device_token(self):
        """Sync the device token from gateway's paired.json to device-auth.json.

        After pairing approval, the gateway stores the correct token in its
        paired.json but device-auth.json may have a stale token from the
        initial onboard. This reads the paired token and updates device-auth.json.
        """
        import json

        identity_dir = Path.home() / ".openclaw" / "identity"
        paired_file = Path.home() / ".openclaw" / "devices" / "paired.json"
        auth_file = identity_dir / "device-auth.json"
        device_file = identity_dir / "device.json"

        if not paired_file.exists() or not device_file.exists():
            return

        try:
            device = json.loads(device_file.read_text(encoding="utf-8"))
            paired = json.loads(paired_file.read_text(encoding="utf-8"))
            device_id = device.get("deviceId", "")

            if device_id not in paired:
                return

            paired_info = paired[device_id]
            paired_tokens = paired_info.get("tokens", {})

            if not paired_tokens:
                return

            # Build updated auth data
            auth_data = {"tokens": {}}
            for role, token_info in paired_tokens.items():
                if isinstance(token_info, dict):
                    auth_data["tokens"][role] = token_info
                else:
                    auth_data["tokens"][role] = {"token": token_info, "scopes": paired_info.get("scopes", [])}

            auth_file.write_text(json.dumps(auth_data, indent=2), encoding="utf-8")
            logger.info("Synced device token from gateway paired.json")
        except Exception as e:
            logger.warning("Failed to sync device token: %s", e)

    # Keep _sync_openclaw_device_token for potential future gateway mode use

    async def _run_local_agent(
        self,
        agent_cfg: AgentEntry,
        status: AgentStatus,
    ):
        """Run a local-only agent as a managed subprocess (no network)."""
        from openagents.client.plugin_registry import registry

        plugin = registry.get(agent_cfg.type)
        cmd = plugin.get_launch_command(
            agent_name=agent_cfg.name,
            path=agent_cfg.path,
        ) if plugin else None

        if not cmd:
            # No launch command — keep agent registered but idle
            status.state = "running"
            status.started_at = datetime.now(timezone.utc).isoformat()
            self._write_status()
            logger.info(f"{agent_cfg.name} registered (no launch command for {agent_cfg.type})")
            try:
                while not self._shutting_down:
                    await asyncio.sleep(5)
            except asyncio.CancelledError:
                pass
            status.state = "stopped"
            return

        cwd = agent_cfg.path or None
        backoff = 2

        # Merge type-level and per-agent env vars into the current environment
        from openagents.client.daemon_config import load_agent_env
        from openagents.client.plugin_registry import registry as _reg
        type_env = load_agent_env(agent_cfg.type)
        _plugin = _reg.get(agent_cfg.type)
        if _plugin:
            # Also check process env for required + resolve_env source vars
            for var_def in _plugin.required_env_vars():
                var_name = var_def.get("name", "")
                if var_name and var_name not in type_env and os.environ.get(var_name):
                    type_env[var_name] = os.environ[var_name]
            for src_name in _plugin.resolve_env_sources():
                if src_name not in type_env and os.environ.get(src_name):
                    type_env[src_name] = os.environ[src_name]
        resolved = _plugin.resolve_env(type_env) if _plugin else type_env
        merged_env = {**resolved, **agent_cfg.env}
        agent_env = {**os.environ, **merged_env} if merged_env else None

        while not self._shutting_down:
            try:
                status.state = "starting"
                self._write_status()

                logger.info(f"{agent_cfg.name} launching: {' '.join(cmd)}"
                            + (f" (cwd={cwd})" if cwd else ""))

                # On Windows, .cmd wrappers can't be launched via exec —
                # they need a shell.  Use create_subprocess_shell for .cmd.
                import platform as _plat
                if _plat.system() == "Windows" and cmd[0].lower().endswith(".cmd"):
                    shell_cmd = subprocess.list2cmdline(cmd)
                    proc = await asyncio.create_subprocess_shell(
                        shell_cmd,
                        cwd=cwd,
                        env=agent_env,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.STDOUT,
                    )
                else:
                    proc = await asyncio.create_subprocess_exec(
                        *cmd,
                        cwd=cwd,
                        env=agent_env,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.STDOUT,
                    )

                status.state = "running"
                status.started_at = datetime.now(timezone.utc).isoformat()
                self._write_status()
                logger.info(f"{agent_cfg.name} running (PID {proc.pid})")

                # Stream output to daemon log
                assert proc.stdout is not None
                async for line in proc.stdout:
                    logger.info(f"[{agent_cfg.name}] {line.decode(errors='replace').rstrip()}")

                returncode = await proc.wait()

                # Check if agent was stopped via command
                if agent_cfg.name in self._stopped_agents:
                    logger.info(f"{agent_cfg.name} was stopped, not restarting")
                    break
                if returncode == 0:
                    logger.info(f"{agent_cfg.name} exited cleanly")
                    break
                else:
                    raise RuntimeError(f"Process exited with code {returncode}")

            except asyncio.CancelledError:
                # Daemon shutting down — terminate the subprocess
                if proc and proc.returncode is None:
                    proc.terminate()
                    try:
                        await asyncio.wait_for(proc.wait(), timeout=5)
                    except asyncio.TimeoutError:
                        proc.kill()
                break

            except Exception as e:
                # Check if agent was stopped/removed before restarting
                if agent_cfg.name in self._stopped_agents:
                    logger.info(f"{agent_cfg.name} was stopped, not restarting")
                    break
                if agent_cfg.name not in {a.name for a in self.config.agents}:
                    logger.info(f"{agent_cfg.name} removed from config, stopping")
                    break
                status.restarts += 1
                status.state = "error"
                status.last_error = str(e)[:200]
                self._write_status()
                logger.warning(
                    f"{agent_cfg.name} crashed: {e}, "
                    f"restarting in {backoff}s (attempt {status.restarts})"
                )
                try:
                    await asyncio.sleep(backoff)
                except asyncio.CancelledError:
                    break
                backoff = min(backoff * 2, 60)

        status.state = "stopped"

    async def _cancel_all(self):
        """Cancel all running agent tasks."""
        for name, task in self.tasks.items():
            if not task.done():
                task.cancel()
        if self.tasks:
            await asyncio.gather(*self.tasks.values(), return_exceptions=True)

    async def _status_loop(self):
        """Periodically write status file, check for commands, and handle reloads."""
        try:
            while True:
                self._write_status()
                self._process_commands()
                if self._reload_pending:
                    await self._do_reload()
                await asyncio.sleep(5)
        except asyncio.CancelledError:
            pass

    def _process_commands(self):
        """Check for and process commands from daemon.cmd file."""
        if not CMD_PATH.exists():
            return
        try:
            raw = CMD_PATH.read_text().strip()
            CMD_PATH.unlink(missing_ok=True)
            if not raw:
                return
            for line in raw.splitlines():
                line = line.strip()
                if line.startswith("stop:"):
                    agent_name = line[5:].strip()
                    self._stop_agent(agent_name)
                elif line.startswith("restart:"):
                    agent_name = line[8:].strip()
                    self._restart_agent(agent_name)
                elif line == "reload":
                    self._reload_pending = True
                else:
                    logger.warning(f"Unknown daemon command: {line}")
        except Exception as e:
            logger.debug(f"Failed to process commands: {e}")

    def _stop_agent(self, agent_name: str):
        """Stop a single agent by cancelling its task."""
        task = self.tasks.get(agent_name)
        if task and not task.done():
            logger.info(f"Stopping agent: {agent_name}")
            self._stopped_agents.add(agent_name)
            task.cancel()
            status = self.agent_status.get(agent_name)
            if status:
                status.state = "stopped"
            self._write_status()
        else:
            logger.warning(f"Cannot stop agent '{agent_name}': not running")

    def _restart_agent(self, agent_name: str):
        """Restart a single agent: stop it, reload config, then relaunch."""
        # Stop if running
        task = self.tasks.get(agent_name)
        if task and not task.done():
            logger.info(f"Stopping agent: {agent_name}")
            self._stopped_agents.add(agent_name)
            task.cancel()

        # Reload config from disk to pick up any changes (e.g. connect/disconnect)
        self.config = load_config(self.config_path)

        # Find agent in refreshed config and relaunch
        agent_cfg = None
        for a in self.config.agents:
            if a.name == agent_name:
                agent_cfg = a
                break
        if agent_cfg is None:
            logger.warning(f"Cannot restart '{agent_name}': not in config")
            return

        net = get_agent_network(agent_cfg, self.config)
        self._launch_agent(agent_cfg, net)
        logger.info(f"Restarted agent: {agent_name}")

    def _write_status(self):
        """Write current agent statuses to disk."""
        try:
            statuses = {
                name: s.to_dict()
                for name, s in self.agent_status.items()
            }
            write_status(statuses, os.getpid())
        except Exception as e:
            logger.debug(f"Failed to write status: {e}")


# ---------------------------------------------------------------------------
# Daemonization helpers (cross-platform)
# ---------------------------------------------------------------------------

def _is_process_alive(pid: int) -> bool:
    """Check if a process is alive. Works on all platforms."""
    if IS_WINDOWS:
        try:
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                capture_output=True, text=True, timeout=5,
            )
            return str(pid) in result.stdout
        except Exception:
            return False
    else:
        try:
            os.kill(pid, 0)
            return True
        except (ProcessLookupError, PermissionError):
            return False


def daemonize():
    """Start the daemon in the background.

    On Unix: double-fork + setsid (classic daemon pattern).
    On Windows: re-launch as a detached subprocess.

    In both cases, writes PID file and redirects output to log.
    Call this BEFORE asyncio.run() in the parent process.
    """
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    PID_PATH.parent.mkdir(parents=True, exist_ok=True)

    if IS_WINDOWS:
        _daemonize_windows()
    else:
        _daemonize_unix()


def _daemonize_unix():
    """Unix double-fork daemon."""
    # First fork
    pid = os.fork()
    if pid > 0:
        print(f"Daemon started (PID {pid})")
        print(f"Logs: {LOG_PATH}")
        print(f"Stop: openagents down")
        sys.exit(0)

    # Child — create new session
    os.setsid()

    # Second fork (prevent terminal reacquisition)
    pid = os.fork()
    if pid > 0:
        sys.exit(0)

    # Redirect stdio to log file
    log_fd = open(LOG_PATH, "a")
    os.dup2(log_fd.fileno(), sys.stdout.fileno())
    os.dup2(log_fd.fileno(), sys.stderr.fileno())
    devnull = open(os.devnull, "r")
    os.dup2(devnull.fileno(), sys.stdin.fileno())

    # Write PID file
    PID_PATH.write_text(str(os.getpid()))

    # Setup logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=log_fd,
    )


def _daemonize_windows():
    """Windows: re-launch this command as a detached subprocess."""
    import shutil

    # Ensure common tool directories are on PATH before spawning daemon
    _ensure_windows_path()

    # Find the openagents CLI entry point
    openagents_bin = shutil.which("openagents")
    if openagents_bin:
        args = [openagents_bin, "up", "--foreground"]
    else:
        args = [sys.executable, "-m", "openagents", "up", "--foreground"]

    # Pass through --config if it was provided
    for i, a in enumerate(sys.argv):
        if a in ("--config", "-c") and i + 1 < len(sys.argv):
            args.extend(["--config", sys.argv[i + 1]])
            break

    log_file = open(LOG_PATH, "a")
    # CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS detaches from parent console
    creation_flags = (
        getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        | getattr(subprocess, "DETACHED_PROCESS", 0)
    )
    proc = subprocess.Popen(
        args,
        stdout=log_file,
        stderr=log_file,
        stdin=subprocess.DEVNULL,
        creationflags=creation_flags,
    )

    PID_PATH.write_text(str(proc.pid))
    print(f"Daemon started (PID {proc.pid})")
    print(f"Logs: {LOG_PATH}")
    print(f"Stop: openagents down")
    sys.exit(0)


def read_daemon_pid() -> Optional[int]:
    """Read PID from pid file. Returns None if not running."""
    if not PID_PATH.exists():
        return None
    try:
        pid = int(PID_PATH.read_text().strip())
        if _is_process_alive(pid):
            return pid
        # Stale PID file
        PID_PATH.unlink(missing_ok=True)
        return None
    except (ValueError, OSError):
        PID_PATH.unlink(missing_ok=True)
        return None


def stop_daemon() -> bool:
    """Stop running daemon. Returns True if stopped."""
    pid = read_daemon_pid()
    if pid is None:
        return False

    import time

    if IS_WINDOWS:
        subprocess.run(
            ["taskkill", "/PID", str(pid)],
            capture_output=True, timeout=5,
        )
        for _ in range(20):
            if not _is_process_alive(pid):
                PID_PATH.unlink(missing_ok=True)
                STATUS_PATH.unlink(missing_ok=True)
                return True
            time.sleep(0.5)
        subprocess.run(
            ["taskkill", "/F", "/PID", str(pid)],
            capture_output=True, timeout=5,
        )
    else:
        os.kill(pid, signal.SIGTERM)
        for _ in range(20):
            if not _is_process_alive(pid):
                PID_PATH.unlink(missing_ok=True)
                STATUS_PATH.unlink(missing_ok=True)
                return True
            time.sleep(0.5)
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    PID_PATH.unlink(missing_ok=True)
    STATUS_PATH.unlink(missing_ok=True)
    return True
