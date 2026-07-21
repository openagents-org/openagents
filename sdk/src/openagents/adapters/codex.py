"""
Codex adapter for OpenAgents workspace.

Bridges OpenAI Codex CLI to an OpenAgents workspace via:
- Polling loop for incoming messages
- Direct HTTP mode for OpenAI-compatible LLM APIs (when OPENAI_API_KEY set)
- Codex CLI subprocess (exec --json) as fallback when binary is available
- Response text captured and posted to workspace

Supports two modes:
1. **Direct mode** (preferred in CI / headless): When OPENAI_API_KEY and
   OPENAI_BASE_URL are set, calls the chat completions API directly via HTTP.
   No Codex binary needed.
2. **Subprocess mode**: When the `codex` binary is installed, runs
   `codex exec --json --full-auto` and parses JSONL events.

Note: MCP workspace tools are not used because the Python MCP server
uses NDJSON framing while Codex's Rust MCP client uses Content-Length
framing (LSP-style). The adapter posts responses directly instead.
"""

import asyncio
import json
import logging
import os
import platform
import re
import shutil
import time
from typing import Optional

import aiohttp

from openagents.adapters.base import BaseAdapter
from openagents.adapters.workspace_prompt import build_openclaw_system_prompt
from openagents.workspace_client import DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)

# Max conversation history entries to keep in memory
MAX_HISTORY_ENTRIES = 50

_REDACT_PATTERNS = [
    (re.compile(r"\bsk-[A-Za-z0-9_-]{6,}"), "sk-[REDACTED]"),
    (re.compile(r"\b(?:github_pat|gh[pousr])_[A-Za-z0-9_]{10,}"), "[REDACTED_TOKEN]"),
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{8,}"), "[REDACTED_TOKEN]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}"), "[REDACTED_JWT]"),
    (
        re.compile(
            r"(authorization|api[_-]?key|x-api-key|token|bearer|secret|password)"
            r"([\"'\s:=]+)([^\s\"',}]+)",
            re.IGNORECASE,
        ),
        r"\1\2[REDACTED]",
    ),
]


def _redact(text: str) -> str:
    """Redact secrets (keys, tokens, authorization values) from diagnostics."""
    out = str(text or "")
    for pattern, repl in _REDACT_PATTERNS:
        out = pattern.sub(repl, out)
    return out


class CodexAdapter(BaseAdapter):
    """Connects OpenAI Codex CLI (or direct API) to an OpenAgents workspace."""

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
        self._codex_thread_id: Optional[str] = None

        # Check for direct LLM API mode (bypasses Codex CLI)
        self._direct_api_key = os.environ.get("OPENAI_API_KEY", "")
        self._direct_base_url = os.environ.get("OPENAI_BASE_URL", "").rstrip("/")
        self._direct_model = os.environ.get("CODEX_MODEL", "") or os.environ.get("OPENCLAW_MODEL", "")
        self._direct_mode = bool(self._direct_api_key and self._direct_base_url)

        # Cached `codex login status` result (avoid spawning a subprocess per message)
        self._login_status_ok: Optional[bool] = None
        self._login_status_ts: float = 0.0

        if self._direct_mode:
            logger.info(
                f"Direct LLM mode: {self._direct_base_url} "
                f"model={self._direct_model or 'gpt-4o'}"
            )

        # Conversation history for multi-turn context
        self._conversation_history: list[dict] = []

    def _build_system_context(self, channel_name: str, browser_enabled: bool = False) -> str:
        """Build workspace context to prepend to prompts."""
        return build_openclaw_system_prompt(
            agent_name=self.agent_name,
            workspace_id=self.workspace_id,
            channel_name=channel_name,
            endpoint=self.endpoint,
            token=self.token,
            mode=self._mode,
            disabled_modules=self.disabled_modules,
            browser_enabled=browser_enabled,
        )

    # ------------------------------------------------------------------
    # Message handler (routes to direct API or subprocess)
    # ------------------------------------------------------------------

    async def _handle_message(self, msg: dict):
        """Process a single incoming message."""
        content = msg.get("content", "").strip()
        if not content:
            return

        msg_channel = msg.get("sessionId") or self.channel_name

        sender = msg.get("senderName") or msg.get("senderType", "user")
        logger.info(f"Processing message from {sender} in channel {msg_channel}: {content[:80]}...")

        await self._auto_title_channel(msg_channel, content)
        await self._send_status(msg_channel, "thinking...")

        try:
            if self._direct_mode:
                response_text = await self._call_completion_api(content, msg_channel)
            else:
                response_text = await self._run_codex_subprocess(content, msg_channel)

            if response_text:
                # Track conversation history
                self._conversation_history.append(
                    {"role": "user", "content": content}
                )
                self._conversation_history.append(
                    {"role": "assistant", "content": response_text}
                )
                if len(self._conversation_history) > MAX_HISTORY_ENTRIES * 2:
                    self._conversation_history = (
                        self._conversation_history[-MAX_HISTORY_ENTRIES * 2:]
                    )
                await self._send_response(msg_channel, response_text)
            else:
                await self._send_response(
                    msg_channel,
                    "⚠️ **Codex couldn't run** — Codex finished without "
                    "producing a reply. Please try again.",
                )

        except Exception as e:
            logger.exception(f"Error handling message: {e}")
            await self._send_error(
                msg_channel,
                f"⚠️ **Codex couldn't run** — {_redact(str(e))}",
            )

    # ------------------------------------------------------------------
    # Direct HTTP mode (OpenAI chat completions API)
    # ------------------------------------------------------------------

    async def _call_completion_api(self, user_message: str, channel: str) -> str:
        """Call OpenAI-compatible chat completions API directly.

        Used when OPENAI_API_KEY and OPENAI_BASE_URL are set.
        Streams the response and returns the full text.
        """
        browser_enabled = await self.get_browser_enabled()
        system_prompt = self._build_system_context(channel, browser_enabled=browser_enabled)

        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(self._conversation_history)
        messages.append({"role": "user", "content": user_message})

        url = f"{self._direct_base_url}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._direct_api_key}",
        }
        payload = {
            "model": self._direct_model or "gpt-4o",
            "messages": messages,
            "stream": True,
        }

        full_text = ""

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                headers=headers,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=300),
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    raise RuntimeError(
                        f"LLM API returned {resp.status}: {body[:300]}"
                    )

                async for line in resp.content:
                    line = line.decode("utf-8", errors="replace").strip()
                    if not line or not line.startswith("data: "):
                        continue

                    data = line[6:]
                    if data == "[DONE]":
                        break

                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue

                    choices = chunk.get("choices", [])
                    if not choices:
                        continue

                    delta = choices[0].get("delta", {})
                    text = delta.get("content")
                    if text:
                        full_text += text

        return full_text.strip()

    # ------------------------------------------------------------------
    # Subprocess mode (codex exec --json --full-auto)
    # ------------------------------------------------------------------

    def _build_codex_cmd(self, prompt: str, channel_name: str, browser_enabled: bool = False) -> list[str]:
        """Build the codex CLI command."""
        # On Windows, prefer .cmd/.exe wrappers over bare npm bash shims
        if platform.system() == "Windows":
            codex_bin = shutil.which("codex.cmd") or shutil.which("codex.exe") or shutil.which("codex")
        else:
            codex_bin = shutil.which("codex")
        # Fallback: check npm global prefix (handles custom prefix like D:\node\node_global)
        if not codex_bin:
            try:
                import subprocess as _sp
                npm_prefix = _sp.check_output(
                    ["npm", "config", "get", "prefix"],
                    text=True, timeout=5,
                ).strip()
                if npm_prefix:
                    ext = ".cmd" if platform.system() == "Windows" else ""
                    candidate = os.path.join(npm_prefix, f"codex{ext}")
                    if os.path.isfile(candidate):
                        codex_bin = candidate
            except Exception:
                pass
        if not codex_bin:
            raise FileNotFoundError(
                "codex CLI not found. Install with: "
                "npm install -g @openai/codex"
            )

        cmd = [codex_bin, "exec"]

        # Resume existing thread for context continuity
        if self._codex_thread_id:
            cmd.extend(["resume", self._codex_thread_id])

        cmd.extend([
            "--json",       # JSONL output to stdout
            "--full-auto",  # workspace-write sandbox + auto-approve
        ])

        # Prepend workspace context to the prompt so Codex knows
        # about shared resources and how to collaborate
        context = self._build_system_context(channel_name, browser_enabled=browser_enabled)
        full_prompt = f"{context}\n\n---\n\n{prompt}"
        cmd.append(full_prompt)
        return cmd

    async def _check_codex_login(self, ttl_seconds: float = 60.0) -> bool:
        """Return True if `codex login status` succeeds. Cached for TTL to avoid
        spawning a subprocess on every message. Non-blocking (asyncio subprocess)."""
        now = time.monotonic()
        if self._login_status_ok is not None and (now - self._login_status_ts) < ttl_seconds:
            return self._login_status_ok

        if platform.system() == "Windows":
            codex_bin = shutil.which("codex.cmd") or shutil.which("codex.exe") or shutil.which("codex")
        else:
            codex_bin = shutil.which("codex")

        ok = False
        if codex_bin:
            try:
                proc = await asyncio.create_subprocess_exec(
                    codex_bin, "login", "status",
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                try:
                    rc = await asyncio.wait_for(proc.wait(), timeout=10)
                    ok = (rc == 0)
                except asyncio.TimeoutError:
                    try:
                        proc.kill()
                    except ProcessLookupError:
                        pass
                    ok = False
            except Exception:
                ok = False

        self._login_status_ok = ok
        self._login_status_ts = now
        return ok

    async def _run_codex_subprocess(self, content: str, msg_channel: str) -> str:
        """Run a Codex CLI subprocess and collect the response."""
        browser_enabled = await self.get_browser_enabled()
        # FileNotFoundError (codex CLI missing) propagates to _handle_message,
        # which posts it as a single "Codex couldn't run" error.
        cmd = self._build_codex_cmd(content, msg_channel, browser_enabled=browser_enabled)

        if not self._direct_mode:
            if not await self._check_codex_login():
                raise RuntimeError(
                    "Codex CLI is not logged in. Run `codex login`, or configure OPENAI_API_KEY + OPENAI_BASE_URL."
                )

        # On Windows, .cmd files need cmd.exe to interpret them
        if platform.system() == "Windows" and cmd[0].lower().endswith(".cmd"):
            cmd = ["cmd.exe", "/c"] + cmd

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=10 * 1024 * 1024,  # 10 MB line buffer
        )

        response_texts = []
        error_message = ""

        # Read JSONL output line by line
        while True:
            line = await process.stdout.readline()
            if not line:
                break
            line = line.decode("utf-8", errors="replace").strip()
            if not line:
                continue

            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                logger.debug(f"Non-JSON line from CLI: {line[:100]}")
                continue

            event_type = event.get("type")

            if event_type == "thread.started":
                thread_id = event.get("thread_id")
                if thread_id:
                    self._codex_thread_id = thread_id
                logger.debug(f"Codex thread started: {thread_id}")

            elif event_type == "item.completed":
                item = event.get("item", {})
                item_type = item.get("type")

                if item_type == "agent_message":
                    text = item.get("text", "")
                    if text:
                        response_texts.append(text)

                elif item_type == "command_execution":
                    cmd_text = item.get("command", "")[:200]
                    await self._send_status(
                        msg_channel, f"**Running:** `{cmd_text}`",
                    )

                elif item_type == "file_change":
                    filename = item.get("filename", "")
                    await self._send_status(
                        msg_channel, f"**Editing:** `{filename}`",
                    )

            elif event_type == "item.started":
                item = event.get("item", {})
                logger.debug(
                    f"Item started: {item.get('type')} "
                    f"{item.get('id', '')}"
                )

            elif event_type == "turn.completed":
                usage = event.get("usage", {})
                logger.debug(
                    f"Turn completed — tokens: "
                    f"in={usage.get('input_tokens', '?')}, "
                    f"out={usage.get('output_tokens', '?')}"
                )

            elif event_type == "turn.failed":
                error = event.get("error", {})
                error_message = error.get("message") or str(error)
                logger.warning(f"Codex turn failed: {error_message}")

            elif event_type == "error":
                error_message = event.get("message") or str(event)
                logger.warning(f"Codex error: {error_message}")

            else:
                logger.debug(f"Skipping event type: {event_type}")

        await process.wait()

        stderr_text = ""
        if process.returncode != 0:
            stderr = await process.stderr.read()
            stderr_text = stderr.decode(
                "utf-8", errors="replace"
            ).strip()
            if stderr_text:
                logger.warning(f"CLI stderr: {stderr_text[:300]}")

        if response_texts:
            return "\n".join(response_texts).strip()

        # No reply — surface the actual reason (turn.failed / error event,
        # stderr, exit code) instead of letting the caller post a generic
        # "No response generated".
        detail = error_message.strip() or stderr_text
        if not detail and process.returncode:
            detail = f"codex exited with code {process.returncode}"
        if detail:
            raise RuntimeError(_redact(detail)[:500])
        return ""
