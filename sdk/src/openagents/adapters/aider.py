"""
Aider adapter for OpenAgents workspace.

Bridges `Aider <https://aider.chat>`_ to an OpenAgents workspace by running the
CLI in its official non-interactive *scripting* mode:

    aider --message-file <tmp> --yes-always --no-pretty --no-stream \
          --no-auto-commits --no-dirty-commits --no-gitignore \
          --chat-history-file <per-channel> --input-history-file <per-channel> \
          [--restore-chat-history] [--model <model>]

Why this shape (and how it differs from the Amp adapter):

* **Prompt delivery.** Aider has no stdin "execute" mode and no JSON event
  protocol. The workspace task is written to a private temp *message file*
  (``--message-file``) so an arbitrarily long prompt never hits ARG_MAX, shell
  quoting, or Windows command-length limits, and is never built by string
  concatenation. The file lives outside the project, is unique per task, is
  deleted afterwards, and its contents never appear in a filename, log, or
  error.
* **Output.** Aider emits plain terminal text, not structured events, so we do
  NOT fabricate ``tool_use``/``thinking`` semantics. ANSI/pretty output is
  disabled, stdout and stderr are drained concurrently and incrementally (no
  pipe deadlock, no blocking on large output), notable progress lines are
  relayed as ``status``, and the cleaned transcript is sent once as the final
  answer. Success/failure is decided by the **exit code** — a non-zero exit is
  never reported as success even if stdout had content.
* **Sessions.** Per (workspace, agent, channel) Aider keeps its own
  ``--chat-history-file``; follow-up turns pass ``--restore-chat-history`` so
  the model resumes that channel's conversation. History lives under
  ``~/.openagents/sessions/aider/`` — never in the user's project — and a
  corrupt history file degrades to a fresh session instead of wedging.
* **Git.** Aider auto-commits by default; OpenAgents does NOT. We force
  ``--no-auto-commits --no-dirty-commits --no-gitignore`` so the agent only
  edits working-tree files, never commits the user's pre-existing changes, and
  never rewrites the tracked ``.gitignore``. Auto-commit is an explicit opt-in
  (``AIDER_AUTO_COMMITS=true``). Aider's local cache is excluded via
  ``.git/info/exclude`` (local-only, never committed).
* **Auth.** Aider is multi-provider (LiteLLM). A single generic ``LLM_API_KEY``
  is mapped to the correct provider env var from the model string; keys travel
  only through the environment, never on the command line or in logs.

Reuses all shared connectivity / dispatch / state machinery in
:class:`~openagents.adapters.base.BaseAdapter`; only the Aider-specific
subprocess invocation, output handling, and session storage live here.

Mirrors the Node adapter: packages/agent-connector/src/adapters/aider.js
"""

import asyncio
import logging
import os
import platform
import re
import shutil
import signal
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from openagents.adapters.base import BaseAdapter
from openagents.adapters.utils import format_attachments_for_prompt
from openagents.workspace_client import DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)

# Per-read timeout while draining Aider's stdout. A turn can pause for a while
# (model latency on a long edit), so we tolerate many idle reads before
# treating the process as wedged.
_READ_TIMEOUT = 15.0
# After this many consecutive idle reads (~10 min) with the process still alive
# and producing nothing, assume it is hung and terminate it. Resets on ANY
# output, so a slow-but-progressing task is never killed.
_MAX_IDLE_READS = 40

# Strip ANSI escape sequences defensively (we already pass --no-pretty).
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
# Collapse 3+ consecutive blank lines down to a single blank line.
_BLANKS_RE = re.compile(r"\n{3,}")

# Lines worth surfacing as live progress. These are stable Aider status
# prefixes (file edits / commits / shell runs), NOT a guess at the model's
# natural-language intent.
_PROGRESS_RE = re.compile(
    r"^(Applied edit|Edited |Wrote |Created |Added |Removed |Committing|Commit |"
    r"Running |Scanning |Repo-map|Reformatting|Skipped |Renamed )",
    re.IGNORECASE,
)
# Cap status updates so a huge edit can't flood the channel.
_MAX_STATUS_UPDATES = 60

# Error signatures → human-readable diagnostics. Matched case-insensitively
# against combined stderr+stdout. Order matters (first hit wins).
_ERROR_SIGNATURES = [
    (("authenticationerror", "invalid api key", "incorrect api key",
      "no api key", "missing these environment variables", "api key not found",
      "401", "unauthorized", "permission denied to access model"),
     "Authentication failed — check the API key for the selected model/provider."),
    (("notfounderror", "model_not_found", "does not exist", "unknown model",
      "could not find model", "you do not have access to model"),
     "Model not found or not accessible — check the model name and that your key has access."),
    (("rate limit", "ratelimiterror", "429", "quota", "insufficient_quota"),
     "Rate-limited or out of quota at the model provider — try again later."),
    (("connectionerror", "timeout", "could not connect", "getaddrinfo",
      "temporary failure in name resolution", "network is unreachable",
      "failed to establish a new connection"),
     "Network error reaching the model provider — check connectivity and the base URL."),
    (("permission denied", "eacces", "read-only file system", "operation not permitted"),
     "File permission error in the working directory."),
    (("gitcommanderror", "fatal: not a git repository", "git failed", "not a git repo"),
     "Git error while applying changes."),
]


def _aider_install_hint() -> str:
    """Platform-appropriate Aider install command for 'not found' messages."""
    if platform.system() == "Windows":
        return 'powershell -NoProfile -Command "irm https://aider.chat/install.ps1 | iex"'
    return "curl -LsSf https://aider.chat/install.sh | sh"


# ---------------------------------------------------------------------------
# Provider resolution
#
# Aider routes through LiteLLM, so a single generic LLM_API_KEY must be injected
# into the provider-specific env var the model expects. The provider is chosen
# DETERMINISTICALLY and IDENTICALLY in the Python and Node adapters:
#
#   1. explicit AIDER_PROVIDER (anything but ``auto``) wins outright;
#   2. otherwise (``auto``/blank) infer from an unambiguous model name;
#   3. if a key is set but the provider can't be determined → config error
#      (we never silently dump the key into OPENAI_API_KEY);
#   4. no key → leave the inherited/native provider env untouched (auto mode).
#
# The provider→env-var names below were verified against aider's official docs
# and `aider --help` (GEMINI_API_KEY, DEEPSEEK_API_KEY, OPENAI_API_BASE, and the
# `openai/<model>` prefix for OpenAI-compatible endpoints).
# ---------------------------------------------------------------------------

from collections import namedtuple  # noqa: E402

ProviderResolution = namedtuple("ProviderResolution", ["env", "model", "error"])

_VALID_PROVIDERS = (
    "auto", "openai", "anthropic", "openrouter", "requesty", "gemini", "deepseek",
    "openai-compatible",
)
# provider -> the API-key env var aider/LiteLLM reads for it.
_PROVIDER_KEY_VAR = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "requesty": "REQUESTY_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "openai-compatible": "OPENAI_API_KEY",
}


def _explicit_prefix_provider(model: str):
    """Return the provider implied by an UNAMBIGUOUS ``provider/`` model prefix,
    or None. Used for conflict detection against an explicit AIDER_PROVIDER."""
    m = (model or "").strip().lower()
    if m.startswith("openrouter/"):
        return "openrouter"
    if m.startswith("requesty/"):
        return "requesty"
    if m.startswith("anthropic/"):
        return "anthropic"
    if m.startswith("openai/"):
        return "openai"
    if m.startswith("gemini/") or m.startswith("google/"):
        return "gemini"
    if m.startswith("deepseek/"):
        return "deepseek"
    return None


def _infer_provider_from_model(model: str):
    """Best-effort, case-insensitive provider inference from a model name.

    Returns a provider key, or None when the name is empty/ambiguous (an unknown
    model is NOT assumed to be OpenAI)."""
    m = (model or "").strip().lower()
    if not m:
        return None
    prefixed = _explicit_prefix_provider(m)
    if prefixed:
        return prefixed
    # Bare names / aliases (aider exposes sonnet/opus/haiku as Claude shortcuts).
    if "claude" in m or "sonnet" in m or "opus" in m or "haiku" in m:
        return "anthropic"
    if "deepseek" in m:
        return "deepseek"
    if "gemini" in m:
        return "gemini"
    if (m.startswith("gpt") or m.startswith("o1") or m.startswith("o3")
            or m.startswith("o4-") or m.startswith("chatgpt") or "gpt-" in m):
        return "openai"
    return None


def _normalize_openai_model(model: str) -> str:
    """Ensure an OpenAI-compatible model carries the required ``openai/`` prefix
    (added once, never duplicated)."""
    m = (model or "").strip()
    if not m:
        return m
    if m.lower().startswith("openai/"):
        return m
    return "openai/" + m


def resolve_aider_provider(provider: str, model: str, api_key: str,
                           base_url: str) -> ProviderResolution:
    """Deterministically resolve the provider env vars (and any model
    normalization) for a generic LLM_API_KEY. Returns ``env`` (the provider vars
    to inject), the possibly-normalized ``model``, and an ``error`` string when
    the configuration is invalid/ambiguous (in which case Aider must NOT start).
    """
    provider = (provider or "").strip().lower()
    model = (model or "").strip()
    api_key = (api_key or "").strip()
    base_url = (base_url or "").strip()

    if provider and provider not in _VALID_PROVIDERS:
        return ProviderResolution(
            {}, model,
            f"Unknown AIDER_PROVIDER '{provider}'. Valid values: "
            "auto, openai, anthropic, openrouter, requesty, gemini, deepseek, "
            "openai-compatible.",
        )
    if not provider:
        provider = "auto"

    # ---- No generic key: auto mode — never fabricate/override provider keys ---
    if not api_key:
        if provider == "openai-compatible":
            if not base_url:
                return ProviderResolution(
                    {}, model,
                    "AIDER_PROVIDER=openai-compatible requires LLM_BASE_URL "
                    "(the OpenAI-compatible endpoint URL).",
                )
            # Point aider at the endpoint and normalize the model, but inject no
            # key (none was supplied — rely on the inherited env if the endpoint
            # needs one).
            return ProviderResolution(
                {"OPENAI_API_BASE": base_url}, _normalize_openai_model(model), None,
            )
        # Native env / project .env / aider config select the model+key.
        return ProviderResolution({}, model, None)

    # ---- Generic key present: a concrete provider is required ---------------
    if provider == "auto":
        inferred = _infer_provider_from_model(model)
        if inferred is None:
            return ProviderResolution(
                {}, model,
                "Could not determine the model provider for LLM_API_KEY. Set "
                "AIDER_PROVIDER (openai, anthropic, openrouter, requesty, gemini, deepseek, "
                "or openai-compatible), use an AIDER_MODEL whose name identifies "
                "the provider, or set the native provider key directly.",
            )
        resolved = inferred
    else:
        resolved = provider
        # Explicit provider wins, but a clearly-conflicting model prefix is a
        # configuration mistake — fail loudly rather than silently override.
        prefix_prov = _explicit_prefix_provider(model)
        effective = "openai" if resolved == "openai-compatible" else resolved
        if prefix_prov and prefix_prov != effective:
            return ProviderResolution(
                {}, model,
                f"AIDER_PROVIDER={provider} conflicts with AIDER_MODEL '{model}' "
                f"(which targets {prefix_prov}). Fix the provider or the model.",
            )

    if resolved == "openai-compatible":
        if not base_url:
            return ProviderResolution(
                {}, model,
                "AIDER_PROVIDER=openai-compatible requires LLM_BASE_URL "
                "(the OpenAI-compatible endpoint URL).",
            )
        return ProviderResolution(
            {"OPENAI_API_KEY": api_key, "OPENAI_API_BASE": base_url},
            _normalize_openai_model(model), None,
        )

    env = {_PROVIDER_KEY_VAR[resolved]: api_key}
    # A base URL only belongs to the OpenAI variable family; never write it into
    # an unrelated provider's env.
    if base_url and resolved == "openai":
        env["OPENAI_API_BASE"] = base_url
    return ProviderResolution(env, model, None)


def _clean_output(text: str) -> str:
    """Strip ANSI and squeeze blank lines from captured Aider output."""
    text = _ANSI_RE.sub("", text or "")
    text = _BLANKS_RE.sub("\n\n", text)
    return text.strip()


def _classify_error(stderr: str, stdout: str) -> Optional[str]:
    """Map known failure signatures to a friendly message, or None."""
    blob = f"{stderr}\n{stdout}".lower()
    for needles, message in _ERROR_SIGNATURES:
        if any(n in blob for n in needles):
            return message
    return None


def _is_truthy(value: Optional[str]) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes", "on")


class AiderAdapter(BaseAdapter):
    """Connects the Aider CLI to an OpenAgents workspace."""

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
        super().__init__(workspace_id, channel_name, token, agent_name, endpoint)
        self.disabled_modules = disabled_modules or set()
        self.working_dir = working_dir

        # channel -> running subprocess (for stop / cleanup)
        self._channel_processes: dict[str, asyncio.subprocess.Process] = {}
        # channels the user explicitly stopped (suppress "no response" noise)
        self._stopping_channels: set[str] = set()
        # git repos we've already added the local Aider exclude to (once each)
        self._git_exclude_done: set[str] = set()

        # Per-(workspace, agent) session dir holds the per-channel chat history
        # and the transient message files. NEVER inside the user's project.
        self._sessions_dir = (
            Path.home() / ".openagents" / "sessions" / "aider"
            / f"{workspace_id}_{agent_name}"
        )

        self._aider_binary = self._find_aider_binary()
        if self._aider_binary:
            logger.info("Using Aider CLI: %s", self._aider_binary)
        else:
            logger.warning(
                "Aider binary not found. Install with: %s", _aider_install_hint()
            )

    # ------------------------------------------------------------------
    # Binary resolution (cross-platform)
    # ------------------------------------------------------------------

    @staticmethod
    def _aider_bin_dirs() -> list[Path]:
        """Directories where the Aider executable can land, in the SAME priority
        the official installer (``uv tool install``) uses, so detection matches
        reality: ``$XDG_BIN_HOME`` → ``$XDG_DATA_HOME/../bin`` → ``~/.local/bin``
        → the uv tools venv for ``aider-chat`` (which always contains the
        executable after a successful install, even if the bin-dir copy/PATH
        edit didn't happen). Mirrors ``aiderBinDirs()`` in the Node paths.js."""
        home = Path.home()
        dirs: list[Path] = []
        if os.environ.get("XDG_BIN_HOME"):
            dirs.append(Path(os.environ["XDG_BIN_HOME"]))
        if os.environ.get("XDG_DATA_HOME"):
            dirs.append(Path(os.environ["XDG_DATA_HOME"]).parent / "bin")
        dirs.append(home / ".local" / "bin")
        if platform.system() == "Windows":
            app_data = os.environ.get("APPDATA", str(home / "AppData" / "Roaming"))
            uv_tools = os.environ.get("UV_TOOL_DIR", str(Path(app_data) / "uv" / "tools"))
            dirs.append(Path(uv_tools) / "aider-chat" / "Scripts")
            dirs.append(home / "bin")
        else:
            uv_tools = os.environ.get(
                "UV_TOOL_DIR", str(home / ".local" / "share" / "uv" / "tools")
            )
            dirs.append(Path(uv_tools) / "aider-chat" / "bin")
            dirs += [home / "bin", Path("/usr/local/bin"), Path("/opt/homebrew/bin")]
        return dirs

    @staticmethod
    def _find_aider_binary() -> Optional[str]:
        """Locate the ``aider`` executable across platforms.

        Detection order: PATH (preferring Windows ``.exe``/``.cmd`` shims) →
        every real install dir the official installer (uv tool), pipx, and ``pip
        install --user`` can target but that a GUI/daemon process may not have on
        PATH. This is what makes detection work when the launcher didn't inherit
        the interactive shell PATH — the "installed but not found" case.
        """
        is_windows = platform.system() == "Windows"
        if is_windows:
            found = (
                shutil.which("aider.exe")
                or shutil.which("aider.cmd")
                or shutil.which("aider")
            )
            names = ("aider.exe", "aider.cmd", "aider")
        else:
            found = shutil.which("aider")
            names = ("aider",)
        if found:
            return found

        for directory in AiderAdapter._aider_bin_dirs():
            for name in names:
                candidate = directory / name
                try:
                    if not candidate.is_file():
                        continue
                    if is_windows or os.access(candidate, os.X_OK):
                        return str(candidate)
                except OSError:
                    continue
        return None

    @staticmethod
    def is_real_aider(binary: str) -> bool:
        """Best-effort check that ``binary`` is the Aider CLI, not a same-named
        unrelated executable. Runs ``--version`` and looks for an Aider marker.
        Returns True on a positive match; False only on a confident mismatch.
        A flaky/blocked ``--version`` is treated as inconclusive → True, so we
        never block a real install on a transient probe failure.
        """
        if not binary:
            return False
        try:
            use_shell = (
                platform.system() == "Windows" and binary.lower().endswith(".cmd")
            )
            result = subprocess.run(
                [binary, "--version"],
                capture_output=True, text=True, timeout=8, shell=use_shell,
            )
            out = f"{result.stdout}\n{result.stderr}".lower()
            if not out.strip():
                return True  # inconclusive — don't reject
            return "aider" in out
        except (OSError, subprocess.TimeoutExpired):
            return True  # inconclusive
        except Exception:
            return True

    # ------------------------------------------------------------------
    # Per-channel session storage
    # ------------------------------------------------------------------

    @staticmethod
    def _safe_channel_id(channel: str) -> str:
        """Sanitize a channel name into a filesystem-safe slug (no traversal).

        Any character outside ``[A-Za-z0-9._-]`` becomes ``_``; leading dots are
        stripped so the result can't escape the sessions dir or be a dotfile.
        Empty input falls back to ``general``.
        """
        slug = re.sub(r"[^A-Za-z0-9._-]", "_", channel or "")
        slug = slug.lstrip(".")
        return slug or "general"

    def _chat_history_file(self, channel: str) -> Path:
        return self._sessions_dir / f"{self._safe_channel_id(channel)}.chat.history.md"

    def _input_history_file(self, channel: str) -> Path:
        return self._sessions_dir / f"{self._safe_channel_id(channel)}.input.history"

    def _has_history(self, channel: str) -> bool:
        """A channel has resumable history when its chat-history file exists and
        is non-empty and readable. A corrupt/unreadable file degrades to a fresh
        session (we move it aside) rather than wedging restore forever."""
        path = self._chat_history_file(channel)
        try:
            if not path.exists() or path.stat().st_size == 0:
                return False
            path.read_text(encoding="utf-8", errors="strict")
            return True
        except (OSError, UnicodeDecodeError):
            logger.warning(
                "Aider chat history for channel %s is unreadable — starting fresh",
                self._safe_channel_id(channel),
            )
            try:
                path.rename(path.with_suffix(path.suffix + ".corrupt"))
            except OSError:
                pass
            return False

    def reset_channel_session(self, channel: str):
        """Forget a single channel's Aider conversation history."""
        for path in (self._chat_history_file(channel), self._input_history_file(channel)):
            try:
                if path.exists():
                    path.unlink()
            except OSError:
                pass

    def clear_all_sessions(self):
        """Remove all stored Aider session state for this agent (used when the
        agent is deleted or fully reset)."""
        try:
            if self._sessions_dir.exists():
                shutil.rmtree(self._sessions_dir, ignore_errors=True)
        except OSError:
            pass

    # ------------------------------------------------------------------
    # Git hygiene — keep Aider's local cache out of `git status` WITHOUT
    # touching the user's tracked .gitignore.
    # ------------------------------------------------------------------

    def _ensure_local_git_exclude(self, working_dir: Optional[str]):
        """Append ``.aider*`` to ``.git/info/exclude`` (local-only, never
        committed) so Aider's tags cache doesn't show up in ``git status``.
        We pass ``--no-gitignore`` so Aider won't edit the tracked .gitignore;
        this is the clean alternative. Best-effort and idempotent."""
        if not working_dir:
            return
        if working_dir in self._git_exclude_done:
            return
        self._git_exclude_done.add(working_dir)
        try:
            git_dir = Path(working_dir) / ".git"
            if not git_dir.is_dir():
                return  # not a git repo root — nothing to exclude
            info_dir = git_dir / "info"
            info_dir.mkdir(parents=True, exist_ok=True)
            exclude = info_dir / "exclude"
            existing = exclude.read_text(encoding="utf-8") if exclude.exists() else ""
            if ".aider" not in existing:
                sep = "" if existing.endswith("\n") or not existing else "\n"
                exclude.write_text(
                    existing + sep + "# Added by OpenAgents Aider agent\n.aider*\n",
                    encoding="utf-8",
                )
        except OSError:
            pass

    # ------------------------------------------------------------------
    # Command + environment construction
    # ------------------------------------------------------------------

    def _build_aider_cmd(self, channel: str, msg_file: str, restore: bool) -> list[str]:
        """Build the Aider argv for a channel (prompt comes from ``msg_file``)."""
        aider_bin = self._aider_binary or self._find_aider_binary()
        if aider_bin:
            self._aider_binary = aider_bin
        if not aider_bin:
            raise FileNotFoundError(
                f"aider CLI not found. Install with: {_aider_install_hint()}"
            )

        auto_commit = _is_truthy(self.agent_env_value("AIDER_AUTO_COMMITS"))
        cmd = [
            aider_bin,
            "--message-file", msg_file,
            "--yes-always",          # non-interactive: auto-confirm prompts
            "--no-pretty",           # plain output (no ANSI / live UI)
            "--no-stream",           # capture a clean, complete final block
            "--no-check-update",     # no PyPI version probe on every run
            "--no-gitignore",        # never rewrite the user's tracked .gitignore
            "--no-dirty-commits",    # never commit the user's pre-existing changes
            "--chat-history-file", str(self._chat_history_file(channel)),
            "--input-history-file", str(self._input_history_file(channel)),
        ]
        # OpenAgents default: edit files but do NOT auto-commit. Opt-in only.
        cmd.append("--auto-commits" if auto_commit else "--no-auto-commits")
        if restore:
            cmd.append("--restore-chat-history")
        # Use the resolved (possibly openai/-normalized) model, not the raw value.
        model = self._resolve_config().model
        if model:
            cmd += ["--model", model]
        return cmd

    def agent_env_value(self, name: str) -> str:
        """Read a config/env value (os.environ is the source for the Python
        connect path; subclass-friendly indirection for tests)."""
        return os.environ.get(name, "")

    def _model(self) -> str:
        return (self.agent_env_value("AIDER_MODEL")
                or self.agent_env_value("LLM_MODEL")).strip()

    def _resolve_config(self) -> ProviderResolution:
        """Deterministically resolve provider env + model from the agent config.

        Pure/deterministic, so it can be called from the command builder, the
        env builder, and the pre-flight gate without divergence."""
        return resolve_aider_provider(
            self.agent_env_value("AIDER_PROVIDER"),
            self._model(),
            self.agent_env_value("LLM_API_KEY"),
            self.agent_env_value("LLM_BASE_URL") or self.agent_env_value("OPENAI_API_BASE"),
        )

    def _build_subprocess_env(self) -> dict:
        """Inherited env + the resolved provider key/base (never logged)."""
        base = dict(os.environ)
        # Make output prompt+unbuffered and colourless regardless of TTY.
        base.setdefault("NO_COLOR", "1")
        base["PYTHONUNBUFFERED"] = "1"
        base.update(self._resolve_config().env)
        return base

    # ------------------------------------------------------------------
    # Control actions (stop / reset)
    # ------------------------------------------------------------------

    async def _on_control_action(self, action: Optional[str], payload: dict):
        if action == "stop":
            await self._stop_all_processes()
        elif action in ("reset_session", "clear_session"):
            channel = (payload or {}).get("channel") or self.channel_name
            self.reset_channel_session(channel)

    async def _stop_all_processes(self):
        """Terminate any running Aider subprocess (stop button)."""
        for channel, proc in list(self._channel_processes.items()):
            self._stopping_channels.add(channel)
            await self._stop_process(proc)
            self._channel_processes.pop(channel, None)
            self._channel_queues.pop(channel, None)
            await self._send_status(channel, "Execution stopped by user")

    async def _stop_process(self, proc: asyncio.subprocess.Process):
        """Kill a single Aider subprocess and its child process group."""
        if not proc or proc.returncode is not None:
            return
        try:
            if platform.system() == "Windows":
                try:
                    killer = await asyncio.create_subprocess_exec(
                        "taskkill", "/F", "/T", "/PID", str(proc.pid),
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL,
                    )
                    await asyncio.wait_for(killer.wait(), timeout=5)
                except Exception:
                    proc.kill()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=2)
                except asyncio.TimeoutError:
                    proc.kill()
                    await proc.wait()
                return

            # POSIX: kill the whole process group so any child the CLI spawned
            # (started with start_new_session=True) is reaped too.
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except (ProcessLookupError, PermissionError, OSError):
                proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=2)
            except asyncio.TimeoutError:
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except (ProcessLookupError, PermissionError, OSError):
                    proc.kill()
                await proc.wait()
        except ProcessLookupError:
            pass

    # ------------------------------------------------------------------
    # Message handler
    # ------------------------------------------------------------------

    async def _handle_message(self, msg: dict):
        content = (msg.get("content") or "").strip()
        attachments = msg.get("attachments", [])
        att_text = format_attachments_for_prompt(attachments)
        if att_text:
            content = (content + att_text) if content else att_text.strip()
        if not content:
            return

        msg_channel = msg.get("sessionId") or self.channel_name
        sender = msg.get("senderName") or msg.get("senderType", "user")
        logger.info(
            "Processing message from %s in channel %s: %d chars",
            sender, msg_channel, len(content),
        )

        if not self._aider_binary:
            self._aider_binary = self._find_aider_binary()
        if not self._aider_binary:
            await self._send_error(
                msg_channel,
                f"Aider CLI not found. Install with: {_aider_install_hint()}",
            )
            return

        # Pre-flight: resolve the provider/key BEFORE starting Aider so a
        # misconfiguration returns a crisp, actionable error (and never silently
        # injects the key into the wrong provider).
        resolution = self._resolve_config()
        if resolution.error:
            await self._send_error(msg_channel, f"Configuration error: {resolution.error}")
            return

        await self._auto_title_channel(msg_channel, content)
        self._stopping_channels.discard(msg_channel)
        self._ensure_local_git_exclude(self.working_dir)
        await self._send_status(msg_channel, "Aider is working...")

        try:
            text, error = await self._run_aider(content, msg_channel)
        except FileNotFoundError as e:
            await self._send_error(msg_channel, str(e))
            return
        except Exception as e:
            logger.exception("Error handling message: %s", e)
            await self._send_error(msg_channel, f"Error processing message: {e}")
            return

        if msg_channel in self._stopping_channels:
            self._stopping_channels.discard(msg_channel)
            return

        if error:
            await self._send_error(msg_channel, error)
        elif text:
            await self._send_response(msg_channel, text)
        else:
            await self._send_response(
                msg_channel,
                "Aider finished with no textual output (any file changes were applied "
                "to the working directory).",
            )

    # ------------------------------------------------------------------
    # Subprocess execution
    # ------------------------------------------------------------------

    async def _run_aider(self, content: str, msg_channel: str) -> tuple[str, Optional[str]]:
        """Write the message file, run Aider once, return (final_text, error)."""
        # Defensive re-check (the primary gate is in _handle_message): never
        # spawn Aider — nor create a temp file — on an invalid configuration.
        resolution = self._resolve_config()
        if resolution.error:
            return "", f"Configuration error: {resolution.error}"

        self._sessions_dir.mkdir(parents=True, exist_ok=True)
        restore = self._has_history(msg_channel)

        # Private, per-task message file outside the project. The prompt body is
        # never placed on the command line or echoed into a filename/log.
        fd, msg_path = tempfile.mkstemp(
            prefix="aider-msg-", suffix=".txt", dir=str(self._sessions_dir)
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(content)

            cmd = self._build_aider_cmd(msg_channel, msg_path, restore=restore)
            return await self._spawn_aider(cmd, msg_channel)
        finally:
            # Windows-safe cleanup: the process has exited by the time we get
            # here, so the file is no longer open.
            try:
                os.unlink(msg_path)
            except OSError:
                pass

    async def _spawn_aider(self, cmd: list[str], msg_channel: str) -> tuple[str, Optional[str]]:
        """Spawn Aider, drain stdout/stderr concurrently and incrementally, and
        return (final_text, error_message). Exit code is authoritative for
        success: a non-zero exit yields an error even if stdout had content."""
        env = self._build_subprocess_env()

        is_windows = platform.system() == "Windows"
        spawn_cmd = list(cmd)
        if is_windows and spawn_cmd[0].lower().endswith(".cmd"):
            spawn_cmd = ["cmd.exe", "/c"] + spawn_cmd

        process = await asyncio.create_subprocess_exec(
            *spawn_cmd,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=self.working_dir,
            env=env,
            limit=10 * 1024 * 1024,  # 10 MB line buffer for large edits
            start_new_session=not is_windows,
        )
        self._channel_processes[msg_channel] = process

        stdout_chunks: list[str] = []
        stderr_chunks: list[str] = []
        status_count = 0

        async def drain_stderr():
            while True:
                line = await process.stderr.readline()
                if not line:
                    break
                stderr_chunks.append(line.decode("utf-8", errors="replace"))

        stderr_task = asyncio.create_task(drain_stderr())

        try:
            idle_reads = 0
            while True:
                try:
                    line = await asyncio.wait_for(
                        process.stdout.readline(), timeout=_READ_TIMEOUT
                    )
                    idle_reads = 0
                except asyncio.TimeoutError:
                    idle_reads += 1
                    if process.returncode is not None:
                        break
                    if idle_reads > _MAX_IDLE_READS:
                        logger.warning(
                            "Aider produced no output for ~%ds — terminating",
                            int(_MAX_IDLE_READS * _READ_TIMEOUT),
                        )
                        await self._stop_process(process)
                        break
                    continue

                if not line:
                    break
                decoded = line.decode("utf-8", errors="replace")
                stdout_chunks.append(decoded)

                stripped = _ANSI_RE.sub("", decoded).strip()
                if (stripped and status_count < _MAX_STATUS_UPDATES
                        and _PROGRESS_RE.match(stripped)):
                    status_count += 1
                    await self._send_status(msg_channel, stripped[:300])

            await process.wait()
        finally:
            self._channel_processes.pop(msg_channel, None)
            try:
                await asyncio.wait_for(stderr_task, timeout=5)
            except (asyncio.TimeoutError, Exception):
                stderr_task.cancel()

        if msg_channel in self._stopping_channels:
            return "", None

        exit_code = process.returncode or 0
        stdout_text = _clean_output("".join(stdout_chunks))
        stderr_text = _clean_output("".join(stderr_chunks))
        if stderr_text:
            # stderr may carry secrets in provider error bodies — never log it
            # verbatim; log only its length.
            logger.debug("Aider stderr: %d chars", len(stderr_text))

        if exit_code != 0:
            diagnostic = _classify_error(stderr_text, stdout_text)
            if not diagnostic:
                tail = (stderr_text or stdout_text).splitlines()
                detail = tail[-1] if tail else ""
                diagnostic = (
                    f"Aider exited with code {exit_code}."
                    + (f" {detail}" if detail else "")
                )
            return "", diagnostic

        # Exit 0 → success. Surface a clear auth/model diagnostic only if Aider
        # printed a hard provider error without producing any answer.
        if not stdout_text:
            diagnostic = _classify_error(stderr_text, stdout_text)
            if diagnostic:
                return "", diagnostic
        return stdout_text, None
