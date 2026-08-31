"""
Kimi adapter for OpenAgents workspace — drives Moonshot's Kimi Code CLI
(npm ``@moonshot-ai/kimi-code``) in print mode, with a direct-API fallback.

Mirrors packages/agent-connector/src/adapters/kimi.js:

  - CLI mode (preferred): ``kimi -p <prompt> --output-format stream-json``,
    JSONL-parsed via :mod:`openagents.adapters.kimi_stream`, with real session
    continuity per channel via ``-S <session_id>``.
  - auth: the saved KIMI_API_KEY / KIMI_BASE_URL / KIMI_MODEL are mapped onto
    the CLI's env-provider contract (KIMI_MODEL_API_KEY / KIMI_MODEL_BASE_URL /
    KIMI_MODEL_NAME); with no key configured the CLI's own ``kimi login``
    credentials apply.
  - direct-API fallback: when the CLI is not installed (or the wrong product,
    the legacy Python ``kimi-cli`` 1.x, is on PATH) the adapter falls back to
    the OpenAI-compatible chat-completions path it has always used, so agents
    configured before CLI support keep working unchanged.

Priority for every value: UI-saved env > process env > default.

Deliberate difference from the Node port: no cross-turn channel recap is
prepended when starting a fresh session. The Python WorkspaceClient exposes no
recent-messages read, and no other Python adapter builds one either; session
resume (``-S``) carries the history in the normal case.
"""

import asyncio
import hashlib
import json
import logging
import os
import shutil
import signal
import subprocess
import time
from pathlib import Path
from typing import Optional

from openagents.adapters.kimi_stream import (
    DEFAULT_KIMI_MODEL,
    KimiStreamParser,
    build_kimi_args,
    build_kimi_env,
    classify_kimi_error,
    classify_kimi_version,
    interpret_kimi_message,
    redact_args,
    redact_secrets,
)
from openagents.adapters.llm_direct import LlmDirectAdapter
from openagents.adapters.utils import format_attachments_for_prompt
from openagents.workspace_client import DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)

IS_WINDOWS = os.name == "nt"

DEFAULT_BASE_URL = "https://api.moonshot.ai/v1"
DEFAULT_MODEL = DEFAULT_KIMI_MODEL

# Kill a run that has produced nothing for this long, nudging the channel once
# on the way. Kimi's provider retry backoff can reach ~1 min between attempts,
# so the ceiling is generous.
_WATCHDOG_INTERVAL = 15.0
_WATCHDOG_NUDGE_AT = 4      # ~60s of silence → "Still working..."
_WATCHDOG_MAX = 20          # ~5min of silence → treat as hung
_STDERR_CAP = 64 * 1024

# `kimi --version` costs a process spawn; cache the answer per resolved binary
# path with a TTL so repeated messages don't re-run it, yet an install/upgrade
# is still re-detected.
_VERSION_CACHE_TTL = 5 * 60.0
_version_cache: dict = {}


def find_kimi_binary() -> Optional[str]:
    """Locate the ``kimi`` CLI across platforms.

    Tiers mirror the Node adapter: the launcher's isolated runtime prefix first
    (so a launcher-managed install always wins over whatever is on PATH), then
    the package's own ``dist/main.mjs``, then PATH, then the well-known install
    locations a GUI/daemon PATH tends to miss — including ``~/.kimi-code/bin``,
    where the npm package's postinstall drops a native build.
    """
    home = Path.home()
    ext = ".cmd" if IS_WINDOWS else ""

    # Tier 0: launcher-managed prefixes.
    for root in (
        home / ".openagents" / "runtimes" / "kimi",
        home / ".openagents" / "nodejs",
    ):
        cand = root / "node_modules" / ".bin" / f"kimi{ext}"
        if cand.is_file():
            return str(cand)
        pkg_bin = root / "node_modules" / "@moonshot-ai" / "kimi-code" / "dist" / "main.mjs"
        if pkg_bin.is_file():
            return str(pkg_bin)

    # Tier 1: PATH.
    for name in (("kimi.cmd", "kimi.exe", "kimi") if IS_WINDOWS else ("kimi",)):
        found = shutil.which(name)
        if found:
            return found

    # Tier 2: common install locations.
    if IS_WINDOWS:
        candidates = [
            Path(os.environ.get("APPDATA", "")) / "npm" / "kimi.cmd",
            home / ".kimi-code" / "bin" / "kimi.exe",
        ]
    else:
        candidates = [
            home / ".kimi-code" / "bin" / "kimi",
            home / ".local" / "bin" / "kimi",
            home / ".npm-global" / "bin" / "kimi",
            Path("/opt/homebrew/bin/kimi"),
            Path("/usr/local/bin/kimi"),
        ]
    for cand in candidates:
        try:
            if cand.is_file() and (IS_WINDOWS or os.access(cand, os.X_OK)):
                return str(cand)
        except OSError:
            continue
    return None


def kimi_sessions_file(workspace_id: str, agent_name: str) -> Path:
    """Where this agent's channel→session map lives (same layout as the Node port)."""
    safe = hashlib.sha256(f"{workspace_id}|{agent_name}".encode("utf-8")).hexdigest()[:16]
    return Path.home() / ".openagents" / "sessions" / f"kimi_{safe}.json"


def clear_version_cache() -> None:
    """Drop the cached ``kimi --version`` answers (test hook; also after upgrade)."""
    _version_cache.clear()


class KimiAdapter(LlmDirectAdapter):
    """Kimi Code CLI adapter, falling back to Moonshot's OpenAI-compatible API."""

    def __init__(
        self,
        workspace_id: str,
        channel_name: str,
        token: str,
        agent_name: str,
        endpoint: str = DEFAULT_ENDPOINT,
        disabled_modules: set | None = None,
        working_dir: str | None = None,
    ):
        super().__init__(
            workspace_id,
            channel_name,
            token,
            agent_name,
            endpoint,
            disabled_modules,
            working_dir,
        )

        # LlmDirectAdapter accepts working_dir but does not keep it — the CLI
        # path needs it as the process cwd, so hold it here.
        self.working_dir = working_dir

        self._direct_api_key = (
            os.environ.get("KIMI_API_KEY")
            or os.environ.get("MOONSHOT_API_KEY")
            or os.environ.get("LLM_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
            or ""
        )
        self._direct_base_url = (
            os.environ.get("KIMI_BASE_URL")
            or os.environ.get("LLM_BASE_URL")
            or os.environ.get("OPENAI_BASE_URL")
            or DEFAULT_BASE_URL
        ).rstrip("/")
        self._direct_model = (
            os.environ.get("KIMI_MODEL")
            or os.environ.get("LLM_MODEL")
            or DEFAULT_MODEL
        )
        self._direct_mode = bool(self._direct_api_key and self._direct_base_url)

        # CLI-mode state.
        self._channel_sessions: dict = {}   # channel → {"session_id", "working_dir"}
        self._channel_processes: dict = {}  # channel → in-flight process
        self._stopping_channels: set = set()
        self._logged_fallback = False
        self._sessions_file = kimi_sessions_file(workspace_id, agent_name)
        self._load_sessions()

        if find_kimi_binary():
            logger.info("Kimi Code CLI detected — running in CLI mode")
        elif self._direct_mode:
            logger.info(
                "Kimi direct API mode: %s model=%s (install Kimi Code CLI for full "
                "agent mode: npm install -g @moonshot-ai/kimi-code)",
                self._direct_base_url, self._direct_model,
            )
        else:
            logger.warning(
                "Kimi adapter started without CLI or API key. Install the CLI "
                "(npm install -g @moonshot-ai/kimi-code) and/or set KIMI_API_KEY."
            )

    # ------------------------------------------------------------------
    # Session persistence (real Kimi session ids, bound to working dir)
    # ------------------------------------------------------------------

    def _load_sessions(self):
        try:
            if self._sessions_file.exists():
                data = json.loads(self._sessions_file.read_text())
                if isinstance(data, dict):
                    self._channel_sessions.update(
                        {k: v for k, v in data.items() if isinstance(v, dict)}
                    )
                    logger.info("Loaded %d Kimi session(s)", len(self._channel_sessions))
        except Exception:
            logger.debug("Could not load Kimi sessions file, starting fresh")

    def _save_sessions(self):
        try:
            self._sessions_file.parent.mkdir(parents=True, exist_ok=True)
            self._sessions_file.write_text(json.dumps(self._channel_sessions))
        except Exception:
            logger.debug("Could not save Kimi sessions file")

    def _resumable_session(self, channel: str, working_dir: str) -> Optional[str]:
        """A saved session id for this channel, or None.

        Only resume when the saved working dir matches the current one — a
        session carries the project it was started in, and crossing projects
        gives the model a history that does not describe the files it sees.
        """
        entry = self._channel_sessions.get(channel)
        if not isinstance(entry, dict):
            return None
        session_id = entry.get("session_id")
        if not session_id:
            return None
        saved_dir = entry.get("working_dir")
        if saved_dir and working_dir and saved_dir != working_dir:
            return None
        return session_id

    def _clear_session(self, channel: str):
        if channel in self._channel_sessions:
            del self._channel_sessions[channel]
            self._save_sessions()

    # ------------------------------------------------------------------
    # Version / product preflight (cached)
    # ------------------------------------------------------------------

    def _read_version_raw(self, kimi_bin: str) -> str:
        """Run ``kimi --version`` and return its raw output. Isolated for testing."""
        cmd = self._spawn_cmd(kimi_bin, ["--version"])
        return subprocess.run(
            cmd, capture_output=True, text=True, timeout=8,
        ).stdout.strip()

    def _check_version(self, kimi_bin: str):
        """Resolve the installed product identity, cached per binary path."""
        now = time.time()
        cached = _version_cache.get(kimi_bin)
        if cached and (now - cached[1]) < _VERSION_CACHE_TTL:
            return cached[0]
        try:
            result = classify_kimi_version(self._read_version_raw(kimi_bin))
        except Exception:
            # `kimi --version` failed → undetermined; proceed leniently.
            result = classify_kimi_version(None)
        _version_cache[kimi_bin] = (result, now)
        return result

    # ------------------------------------------------------------------
    # Spawn helpers
    # ------------------------------------------------------------------

    def _spawn_cmd(self, kimi_bin: str, args: list) -> list:
        """Resolve ``[cmd, *args]``, routing a bare ``.mjs``/``.js`` through node.

        Kimi Code's package bin IS ``dist/main.mjs``, so a path landing on one
        has to run under node rather than being exec'd directly.
        """
        if kimi_bin.endswith((".mjs", ".js")):
            return [self._node_bin(), kimi_bin, *args]
        if IS_WINDOWS and kimi_bin.lower().endswith(".cmd"):
            return ["cmd.exe", "/c", kimi_bin, *args]
        return [kimi_bin, *args]

    @staticmethod
    def _node_bin() -> str:
        """The launcher's portable node when present, else whatever is on PATH."""
        home = Path.home()
        candidates = (
            [home / ".openagents" / "nodejs" / "node.exe"]
            if IS_WINDOWS
            else [
                home / ".openagents" / "nodejs" / "node",
                home / ".openagents" / "nodejs" / "bin" / "node",
            ]
        )
        for c in candidates:
            if c.is_file():
                return str(c)
        return shutil.which("node") or "node"

    def _resolve_cwd(self) -> str:
        """The directory the CLI runs in. Never silently cross into another project."""
        if not self.working_dir:
            d = Path.home() / ".openagents" / "workspaces" / _safe_name(self.agent_name)
            d.mkdir(parents=True, exist_ok=True)
            return str(d)
        p = Path(self.working_dir)
        if not p.is_dir():
            raise NotADirectoryError(f"Working directory does not exist: {self.working_dir}")
        return str(p)

    # ------------------------------------------------------------------
    # Prompt assembly
    # ------------------------------------------------------------------

    def _context_header(self, channel: str) -> str:
        """A compact context header.

        Kimi Code keeps its own coding system prompt; we add only workspace
        identity and (soft) plan-mode framing — print mode cannot take the CLI's
        ``--plan`` flag.
        """
        lines = [
            f'[OpenAgents workspace] You are "{self.agent_name}", a coding agent '
            f'in workspace channel "{channel}".'
        ]
        if self._mode == "plan":
            lines.append(
                "You are in PLAN mode: investigate and propose a plan; do not modify files."
            )
        lines.append(
            "Work in the current working directory. Reply concisely. "
            "The user request follows:"
        )
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Control actions (stop / restart)
    # ------------------------------------------------------------------

    async def _on_control_action(self, action: Optional[str], payload: dict):
        channel = payload.get("channel") if isinstance(payload, dict) else None

        if action == "stop":
            if channel and channel in self._channel_processes:
                self._stopping_channels.add(channel)
                await self._stop_process(self._channel_processes.pop(channel))
                await self._send_response(channel, "Execution stopped by user.")
                return
            if self._channel_processes:
                await self._stop_all_processes("Execution stopped by user.")
                return
            # No CLI runs in flight — fall through to the direct-API stop.
            await super()._on_control_action(action, payload)
            return

        if action == "restart":
            if channel:
                proc = self._channel_processes.pop(channel, None)
                if proc:
                    await self._stop_process(proc)
                self._clear_session(channel)
                await self._send_status(
                    channel,
                    "Session restarted — next message starts a fresh Kimi session.",
                )
            else:
                self._channel_sessions = {}
                self._save_sessions()
                await self._stop_all_processes("Execution stopped.")
            return

        await super()._on_control_action(action, payload)

    async def _stop_all_processes(self, message: str = "Execution stopped."):
        entries = list(self._channel_processes.items())
        if not entries:
            return
        logger.info("Stopping %d running Kimi process(es)...", len(entries))
        for channel, proc in entries:
            self._stopping_channels.add(channel)
            await self._stop_process(proc)
            self._channel_processes.pop(channel, None)
            try:
                await self._send_response(channel, message)
            except Exception:
                pass

    async def _stop_process(self, proc):
        """Terminate a kimi process tree gracefully, then forcefully.

        POSIX: signal the whole process group (the CLI's shell tools share it
        because we spawn with ``start_new_session=True``). Windows:
        ``taskkill /F /T`` kills the tree.
        """
        if not proc or proc.returncode is not None:
            return
        if IS_WINDOWS:
            try:
                proc.send_signal(signal.SIGINT)
            except Exception:
                pass
            if await _exited(proc, 1.5):
                return
            try:
                killer = await asyncio.create_subprocess_exec(
                    "taskkill", "/F", "/T", "/PID", str(proc.pid),
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await asyncio.wait_for(killer.wait(), timeout=5)
            except Exception:
                _safe_kill(proc)
            await _exited(proc, 2)
            return

        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(os.getpgid(proc.pid), sig)
            except Exception:
                _safe_kill(proc)
            if await _exited(proc, 1.5):
                return

    # ------------------------------------------------------------------
    # Message handling
    # ------------------------------------------------------------------

    async def _handle_message(self, msg: dict):
        kimi_bin = find_kimi_binary()
        channel = msg.get("sessionId") or self.channel_name

        if not kimi_bin:
            # Legacy direct-API fallback: agents configured before CLI support
            # keep working exactly as they did.
            if self._direct_mode:
                self._log_fallback(
                    "Kimi Code CLI not found — using direct API fallback "
                    "(npm install -g @moonshot-ai/kimi-code for full agent mode)"
                )
                await super()._handle_message(msg)
                return
            await self._send_error(
                channel,
                "Kimi Code CLI not found. Install it with: "
                "npm install -g @moonshot-ai/kimi-code "
                "(or set KIMI_API_KEY for direct API mode).",
            )
            return

        ver = self._check_version(kimi_bin)
        if ver.product == "legacy":
            # Wrong product on PATH: the wound-down Python kimi-cli (1.x) has a
            # different headless interface.
            if self._direct_mode:
                self._log_fallback(
                    f"Legacy kimi-cli {ver.version} detected — using direct API "
                    "fallback. Install Kimi Code CLI: npm install -g @moonshot-ai/kimi-code"
                )
                await super()._handle_message(msg)
                return
            await self._send_error(
                channel,
                f"Found the legacy Python kimi-cli ({ver.version}), which is not "
                "supported. Install the real Kimi Code CLI with: "
                "npm install -g @moonshot-ai/kimi-code",
            )
            return

        await self._handle_message_cli(msg, kimi_bin)

    def _log_fallback(self, message: str):
        if not self._logged_fallback:
            self._logged_fallback = True
            logger.info(message)

    async def _handle_message_cli(self, msg: dict, kimi_bin: str):
        content = (msg.get("content") or "").strip()
        att_text = format_attachments_for_prompt(msg.get("attachments") or [])
        if att_text:
            content = f"{content}{att_text}" if content else att_text.strip()
        if not content:
            return

        channel = msg.get("sessionId") or self.channel_name
        self._stopping_channels.discard(channel)
        sender = msg.get("senderName") or msg.get("senderType") or "user"
        logger.info(
            "Processing message from %s in %s: %s...",
            sender, channel, redact_secrets(content[:80]),
        )

        try:
            working_dir = self._resolve_cwd()
        except NotADirectoryError as e:
            await self._send_error(channel, str(e))
            return

        await self._auto_title_channel(channel, content)
        await self._send_status(channel, "thinking...")

        # One retry: if resuming a stale session fails, retry once fresh.
        for attempt in range(2):
            resume_id = self._resumable_session(channel, working_dir) if attempt == 0 else None

            # Resuming → Kimi already has the history, send the bare turn.
            prompt = content if resume_id else f"{self._context_header(channel)}\n\n{content}"
            args = build_kimi_args(prompt, resume_id)
            result = await self._run_kimi(channel, kimi_bin, args, working_dir)

            if result["user_stopped"]:
                return

            # Stale-session handling: a resume that died with nothing useful →
            # clear it and retry fresh once.
            if resume_id and not result["ok"] and not result["any_output"] and attempt == 0:
                logger.info("Resume of session %s failed — retrying fresh", resume_id)
                self._clear_session(channel)
                continue

            if result["session_id"]:
                self._channel_sessions[channel] = {
                    "session_id": result["session_id"],
                    "working_dir": working_dir,
                }
                self._save_sessions()

            if result["ok"] and result["final_text"]:
                await self._send_response(channel, result["final_text"])
            elif not result["ok"]:
                await self._send_error(
                    channel,
                    classify_kimi_error(
                        code=result["exit_code"],
                        signal=result["exit_signal"],
                        stderr_text=result["stderr_text"],
                        retry_message=result["retry_message"],
                    ).user_message,
                )
            else:
                await self._send_response(
                    channel, "No response generated. Please try again."
                )
            return

    async def _run_kimi(self, channel: str, kimi_bin: str, args: list, working_dir: str) -> dict:
        """Spawn one ``kimi -p … --output-format stream-json`` run and summarize it.

        ``ok`` is exit code 0; ``final_text`` is the LAST assistant text of the turn.
        """
        env, _ = build_kimi_env(os.environ)
        cmd = self._spawn_cmd(kimi_bin, args)
        logger.info(
            "Spawning kimi in %s: %s",
            working_dir, " ".join(redact_args([kimi_bin, *args])),
        )

        state = {
            "ok": False,
            "final_text": "",
            "session_id": None,
            "any_output": False,
            "user_stopped": False,
            "exit_code": None,
            "exit_signal": None,
            "stderr_text": "",
            "retry_message": "",
        }

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=working_dir,
                env=env,
                limit=10 * 1024 * 1024,  # big tool output lines
                start_new_session=not IS_WINDOWS,  # own process group for tree kill
            )
        except Exception as e:
            state["stderr_text"] = f"error: failed to start Kimi Code CLI: {e}"
            return state

        self._channel_processes[channel] = proc
        loop = asyncio.get_running_loop()
        last_activity = loop.time()

        async def read_stdout():
            nonlocal last_activity
            parser = KimiStreamParser()
            while True:
                try:
                    chunk = await proc.stdout.read(65536)
                except Exception:
                    break
                if not chunk:
                    break
                last_activity = loop.time()
                for parsed in parser.push(chunk):
                    await self._dispatch_event(channel, parsed, state)
            for parsed in parser.flush():
                await self._dispatch_event(channel, parsed, state)

        async def read_stderr():
            nonlocal last_activity
            while True:
                try:
                    line = await proc.stderr.readline()
                except Exception:
                    break
                if not line:
                    break
                last_activity = loop.time()
                if len(state["stderr_text"]) < _STDERR_CAP:
                    state["stderr_text"] += line.decode("utf-8", errors="replace")

        async def watchdog():
            silences = 0
            while proc.returncode is None:
                await asyncio.sleep(_WATCHDOG_INTERVAL)
                if proc.returncode is not None:
                    return
                if loop.time() - last_activity < _WATCHDOG_INTERVAL:
                    silences = 0
                    continue
                silences += 1
                if silences == _WATCHDOG_NUDGE_AT:
                    await self._send_status(channel, "Still working...")
                if silences >= _WATCHDOG_MAX:
                    logger.warning("Watchdog: kimi silent on %s — killing", channel)
                    if not state["stderr_text"]:
                        state["stderr_text"] = (
                            "error: Kimi became unresponsive and was stopped."
                        )
                    await self._stop_process(proc)
                    return

        dog = asyncio.ensure_future(watchdog())
        try:
            await asyncio.gather(read_stdout(), read_stderr())
            await proc.wait()
        finally:
            dog.cancel()
            self._channel_processes.pop(channel, None)

        code = proc.returncode
        # A negative return code is POSIX shorthand for "killed by signal N".
        if code is not None and code < 0:
            state["exit_signal"] = signal.Signals(-code).name
        state["exit_code"] = code
        state["ok"] = code == 0
        if channel in self._stopping_channels:
            state["user_stopped"] = True
        return state

    async def _dispatch_event(self, channel: str, parsed: dict, state: dict):
        """Turn one parsed stream message into workspace activity + run state."""
        for e in interpret_kimi_message(parsed):
            kind = e["kind"]
            if kind == "text":
                state["any_output"] = True
                # The Python BaseAdapter has no separate "thinking" channel, so
                # interim prose is surfaced as transient status; the final text
                # is what gets posted as the reply.
                state["final_text"] = e["text"]
                await self._send_status(channel, e["text"])
            elif kind == "tool_start":
                state["any_output"] = True
                preview = e.get("preview")
                await self._send_status(
                    channel, f"{e['name']}: {preview}" if preview else e["name"]
                )
            elif kind == "session":
                state["session_id"] = e["session_id"]
            elif kind == "retrying":
                state["retry_message"] = e.get("message") or state["retry_message"]
                await self._send_status(
                    channel,
                    f"Provider error — retrying ({e['attempt']}/{e['max_attempts']})...",
                )


async def _exited(proc, timeout: float) -> bool:
    """Wait up to ``timeout`` for the process to exit; True when it did."""
    try:
        await asyncio.wait_for(proc.wait(), timeout=timeout)
        return True
    except asyncio.TimeoutError:
        return proc.returncode is not None


def _safe_kill(proc):
    try:
        proc.kill()
    except (ProcessLookupError, OSError):
        pass


def _safe_name(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in (name or "agent"))
