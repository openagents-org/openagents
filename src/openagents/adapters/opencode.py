"""
OpenCode adapter for OpenAgents workspace.

Bridges OpenCode (opencode-ai) to an OpenAgents workspace by running
``opencode run --format json`` as a subprocess.  OpenCode handles its own
model configuration, provider selection, and tool chain.
"""

import asyncio
import json
import logging
import platform
import shutil
from pathlib import Path
from typing import Optional

from openagents.adapters.base import BaseAdapter
from openagents.adapters.workspace_prompt import (
    build_opencode_skill_md,
    build_opencode_system_prompt,
)
from openagents.workspace_client import DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)


class OpenCodeAdapter(BaseAdapter):
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

        self._channel_sessions: dict[str, str] = {}
        self._sessions_file = (
            Path.home()
            / ".openagents"
            / "sessions"
            / f"{workspace_id}_{agent_name}_opencode.json"
        )
        self._load_sessions()

        self._opencode_binary = self._find_opencode_binary()
        if self._opencode_binary:
            logger.info("Using OpenCode subprocess mode: %s", self._opencode_binary)
        else:
            logger.warning(
                "OpenCode binary not found. "
                "Install opencode: npm install -g opencode-ai@latest"
            )

    def _load_sessions(self):
        try:
            if self._sessions_file.exists():
                data = json.loads(self._sessions_file.read_text())
                if isinstance(data, dict):
                    self._channel_sessions.update(data)
                    logger.info(
                        f"Loaded {len(data)} session(s) from {self._sessions_file.name}"
                    )
        except Exception:
            logger.debug("Could not load sessions file, starting fresh")

    def _save_sessions(self):
        try:
            self._sessions_file.parent.mkdir(parents=True, exist_ok=True)
            self._sessions_file.write_text(json.dumps(self._channel_sessions))
        except Exception:
            logger.debug("Could not save sessions file")

    def _ensure_workspace_skill(self, channel_name: str):
        if not self.working_dir:
            return
        skill_dir = Path(self.working_dir) / ".opencode" / "skills"
        skill_file = skill_dir / "openagents-workspace.md"
        try:
            content = build_opencode_skill_md(
                endpoint=self.endpoint,
                workspace_id=self.workspace_id,
                token=self.token,
                agent_name=self.agent_name,
                channel_name=channel_name,
                disabled_modules=self.disabled_modules,
            )
            skill_dir.mkdir(parents=True, exist_ok=True)
            skill_file.write_text(content, encoding="utf-8")
        except Exception:
            logger.debug("Could not write workspace skill to %s", skill_file)

    def _build_system_context(self, channel_name: str) -> str:
        return build_opencode_system_prompt(
            agent_name=self.agent_name,
            workspace_id=self.workspace_id,
            channel_name=channel_name,
            endpoint=self.endpoint,
            token=self.token,
            mode=self._mode,
            disabled_modules=self.disabled_modules,
        )

    # ------------------------------------------------------------------
    # Message handler
    # ------------------------------------------------------------------

    async def _handle_message(self, msg: dict):
        content = msg.get("content", "").strip()
        if not content:
            return

        msg_channel = msg.get("sessionId") or self.channel_name

        sender = msg.get("senderName") or msg.get("senderType", "user")
        logger.info(
            f"Processing message from {sender} in channel "
            f"{msg_channel}: {content[:80]}..."
        )

        await self._auto_title_channel(msg_channel, content)
        await self._send_status(msg_channel, "thinking...")

        try:
            response_text = await self._run_opencode_subprocess(
                content,
                msg_channel,
            )

            if response_text:
                await self._send_response(msg_channel, response_text)
            else:
                await self._send_response(
                    msg_channel,
                    "No response generated. Please try again.",
                )

        except Exception as e:
            logger.exception(f"Error handling message: {e}")
            await self._send_error(msg_channel, f"Error processing message: {e}")

    # ------------------------------------------------------------------
    # Subprocess mode
    # ------------------------------------------------------------------

    def _find_opencode_binary(self) -> Optional[str]:
        if platform.system() == "Windows":
            path = (
                shutil.which("opencode.cmd")
                or shutil.which("opencode.exe")
                or shutil.which("opencode")
            )
        else:
            path = shutil.which("opencode")
        return path

    @staticmethod
    def _split_json_objects(raw: str) -> list[dict]:
        """Split a string that may contain multiple concatenated JSON objects.

        Handles both newline-delimited and space-separated JSON objects,
        e.g. ``{"a":1} {"b":2}`` or ``{"a":1}\\n{"b":2}``.
        """
        decoder = json.JSONDecoder()
        objects: list[dict] = []
        raw = raw.strip()
        pos = 0
        while pos < len(raw):
            if raw[pos] in " \t\r\n":
                pos += 1
                continue
            try:
                obj, end = decoder.raw_decode(raw, pos)
                if isinstance(obj, dict):
                    objects.append(obj)
                pos = end
            except json.JSONDecodeError:
                pos += 1
        return objects

    @staticmethod
    def _extract_text_from_event(event: dict) -> str | None:
        """Return user-visible text from a single opencode JSON event, or None."""
        event_type = event.get("type", "")
        if event_type in ("step_start", "step_finish", "tool_use"):
            return None

        part = event.get("part")
        if isinstance(part, dict):
            text = part.get("text") or part.get("content") or ""
            if text:
                return text

        item = event.get("item", event)
        text = item.get("text") or item.get("content") or ""
        return text if text else None

    @classmethod
    def _extract_text_from_json(cls, raw: str) -> str:
        """Extract human-readable text from opencode ``--format json`` output.

        OpenCode emits JSON events that may be newline-delimited OR
        space-separated on a single line.  Each event has one of these shapes:

        - ``{"type":"text","part":{"text":"..."}}`` → extract ``part.text``
        - ``{"type":"step_start"|"step_finish"|"tool_use",...}`` → skip
        - ``{"text":"..."}`` / ``{"content":"..."}`` → extract directly
        - ``{"item":{"text":"..."}}`` → extract ``item.text``
        """
        events = cls._split_json_objects(raw)
        if not events:
            return raw.strip()

        texts: list[str] = []
        for event in events:
            text = cls._extract_text_from_event(event)
            if text:
                texts.append(text)

        return "\n".join(texts).strip() if texts else raw.strip()

    def _persist_session_id(self, channel: str, raw_output: str):
        """Extract session_id from OpenCode JSON events and persist it.

        Scans all JSON objects in the raw output for a ``sessionID`` field
        (OpenCode's actual key name).  The last occurrence wins (typically the
        final result/summary event).
        """
        events = self._split_json_objects(raw_output)
        session_id: str | None = None
        for event in events:
            sid = event.get("sessionID")
            if not sid and isinstance(event.get("session"), dict):
                sid = event["session"].get("id")
            if not sid and isinstance(event.get("part"), dict):
                sid = event["part"].get("sessionID")
            if sid and isinstance(sid, str):
                session_id = sid

        if session_id:
            prev = self._channel_sessions.get(channel)
            self._channel_sessions[channel] = session_id
            self._save_sessions()
            if prev != session_id:
                logger.info("OpenCode session for channel %s: %s", channel, session_id)

    async def _run_opencode_subprocess(
        self,
        content: str,
        msg_channel: str,
    ) -> str:
        opencode_bin = self._opencode_binary or self._find_opencode_binary()
        if opencode_bin:
            self._opencode_binary = opencode_bin
        if not opencode_bin:
            await self._send_error(
                msg_channel,
                "opencode CLI not found. Install with: "
                "npm install -g opencode-ai@latest",
            )
            return ""

        cmd = [opencode_bin, "run", "--format", "json"]

        session_id = self._channel_sessions.get(msg_channel)
        if session_id:
            # Resumed session already has conversation history; send only user message
            full_prompt = content
            cmd.extend(["--session", session_id])
        else:
            # New session: inject workspace skill and prepend system context
            self._ensure_workspace_skill(msg_channel)
            context = self._build_system_context(msg_channel)
            full_prompt = f"{context}\n\n---\n\n{content}"

        if platform.system() == "Windows" and cmd[0].lower().endswith(".cmd"):
            cmd = ["cmd.exe", "/c"] + cmd

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self.working_dir,
                limit=10 * 1024 * 1024,  # 10 MB line buffer
            )

            stdout, stderr = await asyncio.wait_for(
                process.communicate(input=full_prompt.encode("utf-8")),
                timeout=300,
            )

            stdout_text = stdout.decode("utf-8", errors="replace").strip()
            stderr_text = stderr.decode("utf-8", errors="replace").strip()

            if process.returncode != 0:
                logger.warning(
                    f"opencode exited with code {process.returncode}: "
                    f"{stderr_text[:300]}"
                )

            if stdout_text:
                self._persist_session_id(msg_channel, stdout_text)
                return self._extract_text_from_json(stdout_text)

            if stderr_text:
                logger.warning(f"opencode stderr: {stderr_text[:300]}")

        except asyncio.TimeoutError:
            logger.warning("opencode subprocess timed out after 300s")
            await self._send_error(
                msg_channel,
                "OpenCode timed out after 5 minutes.",
            )
        except Exception as e:
            logger.exception(f"Failed to run opencode: {e}")
            await self._send_error(
                msg_channel,
                f"Failed to run opencode: {e}",
            )

        return ""
