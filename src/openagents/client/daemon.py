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


# ---------------------------------------------------------------------------
# Agent status tracking
# ---------------------------------------------------------------------------

@dataclass
class AgentStatus:
    name: str
    type: str
    network: str  # network slug or "(local)"
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
        self._shutting_down = False
        self._shutdown_event = asyncio.Event()
        self._reload_pending = False

    async def start(self):
        """Start all configured agents and block until shutdown."""
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
        """SIGHUP handler — flag config reload for next status loop iteration."""
        logger.info("SIGHUP received — scheduling config reload")
        self._reload_pending = True

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

        # Stop removed agents
        for name in old_names - new_names:
            self._stop_agent(name)
            logger.info(f"Reload: stopped removed agent '{name}'")

        # Start new agents
        new_agent_map = {a.name: a for a in new_config.agents}
        for name in new_names - old_names:
            agent_cfg = new_agent_map[name]
            net = get_agent_network(agent_cfg, new_config)
            self._launch_agent(agent_cfg, net)
            logger.info(f"Reload: started new agent '{name}'")

        self.config = new_config
        self._write_status()
        logger.info(f"Config reloaded: {len(new_config.agents)} agent(s)")

    def _launch_agent(self, agent_cfg: AgentEntry, net: Optional[NetworkEntry]):
        """Create status entry and launch agent task."""
        network_label = net.slug if net else "(local)"
        status = AgentStatus(
            name=agent_cfg.name,
            type=agent_cfg.type,
            network=network_label,
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
        backoff = 2
        while not self._shutting_down:
            try:
                status.state = "starting"
                self._write_status()

                adapter = await setup_agent(
                    agent_type=agent_cfg.type,
                    agent_name=agent_cfg.name,
                    workspace_id=net.id,
                    token=net.token,
                    endpoint=net.endpoint,
                    role=agent_cfg.role,
                    options=agent_cfg.options,
                    quiet=True,
                )

                status.state = "online"
                status.started_at = datetime.now(timezone.utc).isoformat()
                self._write_status()
                logger.info(f"{agent_cfg.name} is online → {net.slug}")

                await adapter.run()
                logger.info(f"{agent_cfg.name} exited cleanly")
                break

            except asyncio.CancelledError:
                logger.debug(f"{agent_cfg.name} cancelled")
                break

            except Exception as e:
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

        while not self._shutting_down:
            try:
                status.state = "starting"
                self._write_status()

                logger.info(f"{agent_cfg.name} launching: {' '.join(cmd)}"
                            + (f" (cwd={cwd})" if cwd else ""))

                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    cwd=cwd,
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
            task.cancel()
            status = self.agent_status.get(agent_name)
            if status:
                status.state = "stopped"
            self._write_status()
        else:
            logger.warning(f"Cannot stop agent '{agent_name}': not running")

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
