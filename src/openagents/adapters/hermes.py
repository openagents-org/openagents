"""
Hermes adapter for OpenAgents workspace.

Bridges Hermes Agent to an OpenAgents workspace via:
- Polling loop for incoming workspace messages
- Hermes CLI subprocesses in non-interactive single-query mode
- Per-channel Hermes session persistence for conversation continuity
- Workspace context injection (agent roster + recent history)

The adapter deliberately uses Hermes CLI subprocesses rather than importing the
Hermes Python runtime directly. That keeps profile isolation intact because each
subprocess can select its own Hermes profile (`hermes -p <profile> ...`) and
therefore its own HERMES_HOME, memory, config, and auth state.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
from pathlib import Path
from typing import Optional

from openagents.adapters.base import BaseAdapter
from openagents.adapters.utils import format_attachments_for_prompt
from openagents.adapters.workspace_prompt import (
    build_collaboration_prompt,
    build_mode_prompt,
    build_workspace_identity,
)
from openagents.workspace_client import DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)

SESSION_ID_RE = re.compile(r"session_id:\s*(\S+)")
MAX_HISTORY_MESSAGES = 12


class HermesAdapter(BaseAdapter):
    """Connects Hermes Agent to an OpenAgents workspace."""

    def __init__(
        self,
        workspace_id: str,
        channel_name: str,
        token: str,
        agent_name: str,
        endpoint: str = DEFAULT_ENDPOINT,
        hermes_profile: Optional[str] = None,
        hermes_binary: Optional[str] = None,
        hermes_source: str = "tool",
        max_turns: int = 60,
        yolo: bool = False,
        working_dir: str | None = None,
    ):
        super().__init__(workspace_id, channel_name, token, agent_name, endpoint)
        self.working_dir = working_dir
        self.hermes_profile = self._resolve_profile(hermes_profile, agent_name)
        self.hermes_binary = hermes_binary or self._find_hermes_binary()
        self.hermes_source = hermes_source
        self.max_turns = max_turns
        self.yolo = yolo
        self._channel_sessions: dict[str, str] = {}
        self._sessions_file = (
            Path.home() / ".openagents" / "sessions" / f"{workspace_id}_{agent_name}_hermes.json"
        )
        self._load_sessions()

    @staticmethod
    def _find_hermes_binary() -> Optional[str]:
        binary = shutil.which("hermes")
        if binary:
            return binary

        candidates = [
            Path.home() / ".local" / "bin" / "hermes",
            Path("/opt/homebrew/bin/hermes"),
            Path("/usr/local/bin/hermes"),
        ]
        for candidate in candidates:
            if candidate.exists():
                return str(candidate)
        return None

    @staticmethod
    def _resolve_profile(explicit_profile: Optional[str], agent_name: str) -> str:
        if explicit_profile and explicit_profile not in {"", "auto"}:
            return explicit_profile
        profile_path = Path.home() / ".hermes" / "profiles" / agent_name
        if profile_path.exists():
            return agent_name
        return "default"

    def _load_sessions(self):
        try:
            if self._sessions_file.exists():
                data = self._sessions_file.read_text()
                import json
                loaded = json.loads(data)
                if isinstance(loaded, dict):
                    self._channel_sessions.update(loaded)
        except Exception:
            logger.debug("Could not load Hermes session map", exc_info=True)

    def _save_sessions(self):
        try:
            import json
            self._sessions_file.parent.mkdir(parents=True, exist_ok=True)
            self._sessions_file.write_text(json.dumps(self._channel_sessions))
        except Exception:
            logger.debug("Could not save Hermes session map", exc_info=True)

    async def _get_recent_history_text(self, channel_name: str) -> str:
        try:
            messages = await self.client.poll_messages(
                workspace_id=self.workspace_id,
                channel_name=channel_name,
                token=self.token,
                limit=MAX_HISTORY_MESSAGES,
            )
            lines = []
            for msg in messages:
                if msg.get("messageType") == "status":
                    continue
                sender = msg.get("senderName") or msg.get("senderType", "unknown")
                content = (msg.get("content") or "").strip()
                if not content:
                    continue
                lines.append(f"- {sender}: {content[:400]}")
            if not lines:
                return ""
            return "## Recent Workspace Messages\n" + "\n".join(lines)
        except Exception:
            logger.debug("Failed to fetch workspace history", exc_info=True)
            return ""

    async def _get_agents_text(self) -> str:
        try:
            agents = await self.client.get_agents(self.workspace_id, self.token)
            if not agents:
                return ""
            names = []
            for agent in agents:
                name = agent.get("agentName")
                if not name:
                    continue
                role = agent.get("role", "member")
                status = agent.get("status", "unknown")
                names.append(f"- {name} ({role}, {status})")
            if not names:
                return ""
            return "## Available Workspace Agents\n" + "\n".join(names)
        except Exception:
            logger.debug("Failed to fetch workspace agents", exc_info=True)
            return ""

    def _build_context_prefix(
        self,
        channel_name: str,
        agents_text: str,
        history_text: str,
    ) -> str:
        parts = [
            build_workspace_identity(self.agent_name, self.workspace_id, channel_name, self._mode),
            build_collaboration_prompt(),
            build_mode_prompt(self._mode),
            (
                "\n## OpenAgents-specific Rules\n"
                "- Your final text response is posted back to the workspace automatically.\n"
                "- If you need to ask the user something, ask in normal text. Do not try to open an interactive prompt.\n"
                "- Do not reveal secrets, tokens, raw auth headers, or internal command lines.\n"
                "- Keep status concise. Focus on useful output over theatre.\n"
            ),
        ]
        if agents_text:
            parts.append("\n" + agents_text)
        if history_text:
            parts.append("\n" + history_text)
        return "\n".join(parts).strip()

    def _build_hermes_cmd(self, prompt: str, resume_session_id: Optional[str]) -> list[str]:
        if not self.hermes_binary:
            raise FileNotFoundError(
                "hermes CLI not found. Install/configure Hermes before using this adapter."
            )

        cmd = [self.hermes_binary]
        if self.hermes_profile and self.hermes_profile != "default":
            cmd.extend(["-p", self.hermes_profile])

        cmd.extend(
            [
                "chat",
                "-q",
                prompt,
                "-Q",
                "--source",
                self.hermes_source,
                "--max-turns",
                str(self.max_turns),
            ]
        )

        if resume_session_id:
            cmd.extend(["--resume", resume_session_id])
        if self.yolo:
            cmd.append("--yolo")
        return cmd

    @staticmethod
    def _parse_hermes_output(output: str) -> tuple[str, Optional[str]]:
        session_id = None
        match = SESSION_ID_RE.search(output)
        if match:
            session_id = match.group(1)
            output = SESSION_ID_RE.sub("", output)

        lines = []
        for raw_line in output.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("↻ Resumed session "):
                continue
            lines.append(raw_line)
        return "\n".join(lines).strip(), session_id

    async def _run_hermes(self, prompt: str, channel_name: str) -> str:
        resume_session_id = self._channel_sessions.get(channel_name)
        cmd = self._build_hermes_cmd(prompt, resume_session_id)
        logger.info("Running Hermes adapter in profile=%s channel=%s", self.hermes_profile, channel_name)

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=self.working_dir or os.getcwd(),
        )
        stdout, stderr = await process.communicate()
        stdout_text = stdout.decode("utf-8", errors="replace")
        stderr_text = stderr.decode("utf-8", errors="replace")

        if process.returncode != 0 and resume_session_id:
            logger.warning("Hermes resume failed for %s, retrying fresh session", channel_name)
            self._channel_sessions.pop(channel_name, None)
            self._save_sessions()
            return await self._run_hermes(prompt, channel_name)

        if process.returncode != 0:
            detail = (stderr_text or stdout_text).strip()[:600]
            raise RuntimeError(f"Hermes exited with code {process.returncode}: {detail}")

        response_text, session_id = self._parse_hermes_output(stdout_text)
        if session_id:
            self._channel_sessions[channel_name] = session_id
            self._save_sessions()
        return response_text

    async def _handle_message(self, msg: dict):
        content = (msg.get("content") or "").strip()
        attachments = msg.get("attachments", [])
        attachment_text = format_attachments_for_prompt(attachments)
        if attachment_text:
            content = (content + attachment_text) if content else attachment_text.strip()
        if not content:
            return

        channel_name = msg.get("sessionId") or self.channel_name
        sender = msg.get("senderName") or msg.get("senderType", "user")
        logger.info("Processing workspace message from %s in %s", sender, channel_name)

        await self._auto_title_channel(channel_name, content)
        await self._send_status(channel_name, "thinking...")

        try:
            agents_text, history_text = await asyncio.gather(
                self._get_agents_text(),
                self._get_recent_history_text(channel_name),
            )
            context = self._build_context_prefix(channel_name, agents_text, history_text)
            prompt = f"{context}\n\n---\n\nUser message:\n{content}" if context else content
            response_text = await self._run_hermes(prompt, channel_name)
            if response_text:
                await self._send_response(channel_name, response_text)
            else:
                await self._send_response(channel_name, "No response generated. Please try again.")
        except Exception as e:
            logger.exception("Hermes adapter failed: %s", e)
            await self._send_error(channel_name, f"Error processing message: {e}")
